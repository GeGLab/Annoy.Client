// Run against the actual packaged executable with an isolated, explicit profile.
// No login registration, installation, release publication, or existing profile is touched.
import { _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const executable = resolve(
  process.env.ANNOY_PACKAGED_EXECUTABLE || "dist/win-unpacked/Annoy.exe",
);
assert.ok(existsSync(executable), "Packaged executable is required");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const server = createServer((request, response) => {
  if (request.url?.startsWith("/policy")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ advisories: [] }));
    return;
  }
  response.setHeader("Content-Type", "text/yaml");
  response.end(
    `version: ${version}\nfiles:\n  - url: fixture.exe\n    sha512: Zml4dHVyZQ==\npath: fixture.exe\nsha512: Zml4dHVyZQ==\n`,
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const feed = `http://127.0.0.1:${server.address().port}`;
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
      ANNOY_UPDATE_FEED: feed,
      ANNOY_UPDATE_POLICY_URL: feed + "/policy",
      APPIMAGE_EXTRACT_AND_RUN: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const app = await electron.launch({
      executablePath: executable,
      args: [
        `--user-data-dir=${profile}`,
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      env,
    });
    try {
      const page = await app.firstWindow();
      await page.locator(".welcome").waitFor();
      const native = await app.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        profile: app.getPath("userData"),
        acceleration: app.isHardwareAccelerationEnabled(),
        version: app.getVersion(),
      }));
      assert.equal(native.packaged, true);
      assert.equal(resolve(native.profile), resolve(profile));
      assert.equal(native.acceleration, hardwareAcceleration);
      assert.equal(
        native.version,
        JSON.parse(await readFile("package.json", "utf8")).version,
      );
      const status = await page.evaluate(() => window.distopic.desktop.get());
      assert.equal(status.applied.hardwareAcceleration, hardwareAcceleration);
      assert.equal(status.restartRequired, false);
      await page.evaluate(async (saved) => {
        await window.distopic.desktop.set({ ...saved, startMinimized: true });
      }, status.saved);
      assert.equal(
        JSON.parse(await readFile(join(profile, "desktop.json"), "utf8")).values
          .startMinimized,
        true,
      );
      const size = await app.evaluate(async ({ BrowserWindow }) =>
        (await BrowserWindow.getAllWindows()[0].capturePage()).getSize(),
      );
      assert.ok(size.width > 0 && size.height > 0);
      const media = await page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const video = document.createElement("video");
        video.srcObject = stream;
        await video.play();
        const width = video.videoWidth;
        stream.getTracks().forEach((track) => track.stop());
        return width;
      });
      assert.ok(media > 0);
      const sources = await page.evaluate(() =>
        window.distopic.screen.sources(),
      );
      assert.ok(sources.length > 0);
      await page.evaluate(() => window.distopic.updates.check());
      assert.equal(
        (await page.evaluate(() => window.distopic.updates.get())).status,
        "none",
      );
      console.log(
        JSON.stringify({
          executable,
          hardwareAcceleration,
          packaged: true,
          isolatedProfile: true,
          rendering: true,
          video: true,
          screenCapture: true,
          persistence: true,
        }),
      );
    } finally {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
        )
        .catch(() => {});
      await app.close();
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
} finally {
  await new Promise((done) => server.close(done));
}
