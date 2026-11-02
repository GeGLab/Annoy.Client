// Renderer-only CDP validation. Production main-process inspector fuses stay disabled.
// Uses explicit disposable profiles; never installs/registers login items or publishes.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { globalAuthFixture } from "../tests/fixtures/global-auth.ts";
const executable = resolve(
  process.env.ANNOY_PACKAGED_EXECUTABLE || "dist/win-unpacked/Annoy.exe",
);
assert.ok(existsSync(executable), "Packaged executable is required");
const auth = await globalAuthFixture(),
  metadata = JSON.parse(await readFile("package.json", "utf8"));
const feedServer = createServer((request, response) => {
  if (request.url?.startsWith("/policy")) {
    response.setHeader("Content-Type", "application/json");
    response.end('{"advisories":[]}');
    return;
  }
  response.setHeader("Content-Type", "text/yaml");
  response.end(
    `version: ${metadata.version}\nfiles:\n  - url: fixture.exe\n    sha512: Zml4dHVyZQ==\npath: fixture.exe\nsha512: Zml4dHVyZQ==\n`,
  );
});
await new Promise((done) => feedServer.listen(0, "127.0.0.1", done));
const feed = `http://127.0.0.1:${feedServer.address().port}`;
try {
  for (const hardwareAcceleration of [true, false]) {
    const profile = await mkdtemp(join(tmpdir(), "annoy-packaged-"));
    await writeFile(
      join(profile, "desktop.json"),
      JSON.stringify({
        version: 1,
        values: {
          hardwareAcceleration,
          startAtLogin: false,
          startMinimized: false,
          closeToTray: false,
        },
      }),
    );
    await writeFile(
      join(profile, "updates.json"),
      JSON.stringify({ version: 1, values: { notifications: false } }),
    );
    const env = {
      ...process.env,
      ANNOY_GLOBAL_URL: auth.url,
      ANNOY_UPDATE_FEED: feed,
      ANNOY_UPDATE_POLICY_URL: feed + "/policy",
      APPIMAGE_EXTRACT_AND_RUN: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "--mute-audio",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        ...(process.env.CI && process.platform === "linux"
          ? ["--no-sandbox"]
          : []),
      ],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let browser,
      page,
      diagnostics = "";
    try {
      const endpoint = await new Promise((done, reject) => {
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Renderer CDP not available: " + diagnostics.slice(-1500),
              ),
            ),
          30000,
        );
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.stderr.on("data", (chunk) => {
          diagnostics += String(chunk);
          const match = diagnostics.match(
            /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/,
          );
          if (match) {
            clearTimeout(timeout);
            done(match[1]);
          }
        });
      });
      browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0];
      page = context.pages()[0] ?? (await context.waitForEvent("page"));
      await auth.keepAuthenticated(page);
      await page.locator(".welcome").waitFor();
      const status = await page.evaluate(() => window.distopic.desktop.get());
      assert.equal(status.applied.hardwareAcceleration, hardwareAcceleration);
      assert.equal(status.restartRequired, false);
      await page.evaluate(
        (saved) =>
          window.distopic.desktop.set({ ...saved, startMinimized: true }),
        status.saved,
      );
      assert.equal(
        JSON.parse(await readFile(join(profile, "desktop.json"), "utf8")).values
          .startMinimized,
        true,
      );
      assert.ok((await page.screenshot()).length > 0);
      const width = await page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        try {
          const video = document.createElement("video");
          video.srcObject = stream;
          await video.play();
          return video.videoWidth;
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
      });
      assert.ok(width > 0);
      assert.ok(
        (await page.evaluate(() => window.distopic.screen.sources())).length >
          0,
      );
      await page.evaluate(() => window.distopic.updates.check());
      const update = await page.evaluate(() => window.distopic.updates.get());
      assert.equal(update.currentVersion, metadata.version);
      assert.equal(update.status, "none");
      console.log(
        JSON.stringify({
          executable,
          hardwareAcceleration,
          isolatedProfile: true,
          rendering: true,
          video: true,
          screenCapture: true,
          persistence: true,
          mainInspectorEnabled: false,
        }),
      );
    } finally {
      await page
        ?.evaluate(() => window.distopic.window.close())
        .catch(() => {});
      await browser?.close().catch(() => {});
      if (child.exitCode === null) {
        child.kill();
        await new Promise((done) => {
          child.once("exit", done);
          setTimeout(done, 3000);
        });
      }
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 300,
      });
    }
  }
} finally {
  await new Promise((done) => feedServer.close(done));
  await auth.close();
}
