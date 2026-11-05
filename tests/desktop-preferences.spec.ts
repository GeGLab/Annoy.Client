import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
async function launch(data: string) {
  const auth = await globalAuthFixture();
  const env = {
    ...process.env,
    ANNOY_TEST_DATA: data,
    ANNOY_GLOBAL_URL: auth.url,
    ELECTRON_RENDERER_URL: "http://127.0.0.1:5178",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve("tests/fixtures/electron.cjs")],
    env,
  });
  const page = await app.firstWindow();
  await auth.keepAuthenticated(page);
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      await auth.close();
    }
  };
  return { app, page, env };
}
test("desktop preview/save/reload, applied acceleration, unsupported autostart and tray restoration", async () => {
  const data = await mkdtemp(join(tmpdir(), "annoy-desktop-"));
  const { app, page, env } = await launch(data);
  try {
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Aplicativo e inicialização", exact: true })
      .click();
    await expect(
      page.getByRole("switch", { name: "Iniciar com o sistema", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("switch", { name: "Aceleração de hardware", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reiniciar agora", exact: true }),
    ).toHaveCount(0);
    await page
      .locator(".settings-savebar")
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reiniciar agora", exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.distopic!.desktop.get())).applied
        .hardwareAcceleration,
    ).toBe(true);
    const saved = JSON.parse(
      await readFile(join(data, "desktop.json"), "utf8"),
    );
    expect(saved.values.hardwareAcceleration).toBe(false);
    await mkdir(".impeccable/review", { recursive: true });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.screenshot({ path: ".impeccable/review/m6-desktop-dark.png" });
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await page
      .locator(".settings-savebar")
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Aplicativo e inicialização", exact: true })
      .click();
    await page.screenshot({ path: ".impeccable/review/m6-desktop-light.png" });
    await page
      .getByRole("switch", { name: "Iniciar minimizado", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Reiniciar agora", exact: true })
      .click();
    await expect(page.getByRole("dialog").last()).toContainText("alterações");
    await page
      .getByRole("button", { name: "Continuar editando", exact: true })
      .click();
    // Tray quit shares the renderer's save/discard guard; cancellation must
    // also leave the ordinary close-to-tray path active.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        "desktop:quit-requested",
      ),
    );
    await expect(page.getByRole("dialog").last()).toContainText("alterações");
    await page
      .getByRole("button", { name: "Continuar editando", exact: true })
      .click();
    await page
      .locator(".settings-savebar")
      .getByRole("button", { name: "Redefinir", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.distopic!.window.close());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isVisible(),
        ),
      )
      .toBe(false);
    const second = spawn(
      require("electron"),
      [resolve("tests/fixtures/electron.cjs")],
      { env, windowsHide: true, stdio: "ignore" },
    );
    await new Promise<void>((resolve, reject) => {
      second.once("error", reject);
      second.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`second instance ${code}`)),
      );
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.isVisible(),
        ),
      )
      .toBe(true);
    await page.reload();
    expect(
      (await page.evaluate(() => window.distopic!.desktop.get())).saved
        .hardwareAcceleration,
    ).toBe(false);
    const closed = app.waitForEvent("close");
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.send(
          "desktop:quit-requested",
        ),
      )
      .catch(() => {});
    await closed;
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await rm(data, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
for (const enabled of [true, false])
  test(`acceleration ${enabled} is read before ready; startup minimized keeps a taskbar window`, async () => {
    const data = await mkdtemp(join(tmpdir(), "annoy-acceleration-"));
    await writeFile(
      join(data, "desktop.json"),
      JSON.stringify({
        version: 1,
        values: {
          hardwareAcceleration: enabled,
          startAtLogin: false,
          startMinimized: true,
          closeToTray: false,
        },
      }),
    );
    const { app, page } = await launch(data);
    try {
      await expect(page.locator(".welcome")).toBeAttached();
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]!.isMinimized(),
          ),
        )
        .toBe(true);
      // Runners without a GPU (GitHub Windows) never get acceleration, whatever the app asks.
      const gpu = await app.evaluate(({ app }) => (app.getGPUFeatureStatus() as Record<string, string>).gpu_compositing ?? "");
      if (!enabled || !gpu.startsWith("disabled"))
        expect(
          await app.evaluate(({ app }) => app.isHardwareAccelerationEnabled()),
        ).toBe(enabled);
      const snapshot = await page.evaluate(() =>
        window.distopic!.desktop.get(),
      );
      expect(snapshot.applied.hardwareAcceleration).toBe(enabled);
      expect(snapshot.applied.closeToTray).toBe(false);
      expect(snapshot.restartRequired).toBe(false);
      // Restore the taskbar window and verify rendering/capture in each acceleration mode.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.restore(),
      );
      expect(
        (
          await app.evaluate(async ({ BrowserWindow }) =>
            (await BrowserWindow.getAllWindows()[0]!.capturePage()).getSize(),
          )
        ).width,
      ).toBeGreaterThan(0);
    } finally {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        )
        .catch(() => {});
      await app.close();
      await rm(data, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  });
test("failed native preference write does not claim saved or applied changes", async () => {
  const data = await mkdtemp(join(tmpdir(), "annoy-write-failure-"));
  const { app, page } = await launch(data);
  try {
    await expect(page.locator(".welcome")).toBeVisible();
    const initial = await page.evaluate(() => window.distopic!.desktop.get());
    // The first run writes desktop.json; a directory in its place makes the next write fail.
    await rm(join(data, "desktop.json"), { force: true });
    await mkdir(join(data, "desktop.json"));
    const rejected = await page.evaluate(async (saved) => {
      try {
        await window.distopic!.desktop.set({
          ...saved,
          hardwareAcceleration: false,
        });
        return false;
      } catch {
        return true;
      }
    }, initial.saved);
    expect(rejected).toBe(true);
    const after = await page.evaluate(() => window.distopic!.desktop.get());
    expect(after.saved.hardwareAcceleration).toBe(true);
    expect(after.applied.hardwareAcceleration).toBe(true);
    expect(after.restartRequired).toBe(false);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await rm(data, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
