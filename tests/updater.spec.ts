import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
for (const critical of [false, true])
  test(`local updater feed: ${critical ? "critical policy" : "optional update"}, coalescing, notifications, recovery and checksum rejection`, async () => {
    const data = await mkdtemp(join(tmpdir(), "annoy-feed-"));
    const valid = Buffer.from("Synthetic installer fixture; never executed.");
    const digest = createHash("sha512").update(valid).digest("base64");
    let corrupt = true,
      offline = false,
      checks = 0;
    let policyEnabled = false;
    const server = createServer((request, response) => {
      const url = request.url ?? "";
      if (url.startsWith("/policy")) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            advisories:
              critical && policyEnabled
                ? [
                    {
                      id: "TEST-ONLY-CRITICAL",
                      severity: "critical",
                      fixedIn: "99.0.0",
                      summary: "Synthetic local policy",
                    },
                  ]
                : [],
          }),
        );
        return;
      }
      if (url.startsWith("/latest.yml")) {
        checks++;
        if (offline) {
          response.writeHead(503);
          response.end("offline");
          return;
        }
        response.setHeader("Content-Type", "text/yaml");
        response.end(
          `version: 99.0.0\nfiles:\n  - url: fixture.exe\n    sha512: ${digest}\n    size: ${valid.length}\npath: fixture.exe\nsha512: ${digest}\nreleaseDate: '2026-11-01T12:00:00.000Z'\n`,
        );
        return;
      }
      if (url.startsWith("/fixture.exe")) {
        const bytes = corrupt ? Buffer.from("Corrupted fixture") : valid;
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
        });
        response.end(bytes);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No feed port");
    const feed = `http://127.0.0.1:${address.port}`;
    const config = join(data, "dev-app-update.yml");
    await writeFile(
      config,
      `provider: generic\nurl: ${feed}\nupdaterCacheDirName: annoy-test-updater\n`,
    );
    const auth = await globalAuthFixture();
    const env = {
      ...process.env,
      ANNOY_TEST_DATA: data,
      ANNOY_GLOBAL_URL: auth.url,
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5178",
      ANNOY_UPDATE_FEED: feed,
      ANNOY_UPDATE_POLICY_URL: feed + "/policy",
      ANNOY_TEST_UPDATE_CONFIG: config,
      LOCALAPPDATA: data,
      XDG_CACHE_HOME: data,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: require("electron"),
      args: [resolve("tests/fixtures/electron.cjs")],
      env,
    });
    const page = await app.firstWindow();
    await auth.keepAuthenticated(page);
    try {
      await expect(page.locator(".welcome")).toBeVisible();
      await page.evaluate(() =>
        window.distopic!.updates.configure({ notifications: false }),
      );
      policyEnabled = true;
      const beforeChecks = checks;
      await page.evaluate(() =>
        Promise.all([
          window.distopic!.updates.check(),
          window.distopic!.updates.check(),
          window.distopic!.updates.check(),
        ]),
      );
      expect(checks - beforeChecks).toBe(1);
      if (critical) {
        await expect
          .poll(
            async () =>
              (await page.evaluate(() => window.distopic!.updates.get()))
                .status,
          )
          .toBe("error");
        expect(
          await page.evaluate(() => window.distopic!.updates.get()),
        ).toMatchObject({ mandatory: true });
      } else {
        expect(
          await page.evaluate(() => window.distopic!.updates.get()),
        ).toMatchObject({
          status: "available",
          version: "99.0.0",
          mandatory: false,
        });
        expect(
          await app.evaluate(
            () => (globalThis as any).annoyTestNotifications.length,
          ),
        ).toBe(0);
        await page.evaluate(() =>
          window.distopic!.updates.configure({ notifications: true }),
        );
        await page.evaluate(() => window.distopic!.updates.check());
        await page.evaluate(() => window.distopic!.updates.check());
        expect(
          await app.evaluate(
            () => (globalThis as any).annoyTestNotifications.length,
          ),
        ).toBe(1);
        await page.evaluate(() => window.distopic!.updates.download());
      }
      const failed = await page.evaluate(() => window.distopic!.updates.get());
      expect(failed).toMatchObject({ status: "error" });
      if (failed.status === "error")
        expect(failed.message).toContain("integridade");
      await page.evaluate(() => window.distopic!.updates.install());
      expect(
        await app.evaluate(() => (globalThis as any).annoyTestInstalls),
      ).toBe(0);
      offline = true;
      await page.evaluate(() => window.distopic!.updates.check());
      expect(
        (await page.evaluate(() => window.distopic!.updates.get())).status,
      ).toBe("error");
      offline = false;
      corrupt = false;
      await page.evaluate(() => window.distopic!.updates.check());
      if (!critical)
        await page.evaluate(() => window.distopic!.updates.download());
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.distopic!.updates.get())).status,
        )
        .toBe("error");
      const unauthenticated = await page.evaluate(() =>
        window.distopic!.updates.get(),
      );
      if (unauthenticated.status === "error")
        expect(unauthenticated.message).toContain("autenticada");
      await page.evaluate(() => window.distopic!.updates.install());
      expect(
        await app.evaluate(() => (globalThis as any).annoyTestInstalls),
      ).toBe(0);
    } finally {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        )
        .catch(() => {});
      await app.close();
      await auth.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(data, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });
