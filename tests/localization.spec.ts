import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
test("seven languages update live; preview discards, save persists, maximum text and zoom remain operable", async () => {
  const data = await mkdtemp(join(tmpdir(), "annoy-localization-"));
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
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Configurações", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Idioma e acessibilidade", exact: true })
      .click();
    for (const language of ["en", "es", "fr", "it", "ja", "zh-Hans", "pt-BR"]) {
      await page
        .locator(".localization-settings .ui-select-trigger")
        .first()
        .click();
      await page
        .getByRole("option")
        .filter({
          hasText: (
            {
              en: "English",
              es: "Español",
              fr: "Français",
              it: "Italiano",
              ja: "日本語",
              "zh-Hans": "简体中文",
              "pt-BR": "Português (Brasil)",
            } as Record<string, string>
          )[language]!,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator(".brand-wordmark").first()).toHaveText("annoy.");
      await expect(page.locator(".localization-settings h3")).not.toBeEmpty();
    }
    await page.getByRole("slider", { name: "Tamanho do texto" }).focus();
    await page.keyboard.press("End");
    await expect(page.locator("html")).toHaveCSS("font-size", "20px");
    await page.getByRole("switch").last().click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-underline-links",
      "false",
    );
    await page
      .locator(".settings-savebar")
      .getByRole("button", { name: "Redefinir", exact: true })
      .click();
    await expect(page.locator("html")).toHaveCSS("font-size", "14px");
    await expect(page.locator("html")).toHaveAttribute(
      "data-underline-links",
      "true",
    );
    await page.getByRole("slider", { name: "Tamanho do texto" }).focus();
    await page.keyboard.press("End");
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.setSize(940, 620);
      w.webContents.setZoomFactor(2);
    });
    await expect
      .poll(() =>
        page
          .locator(".settings-content")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Salvar alterações", exact: true })
      .click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    await mkdir(".impeccable/review", { recursive: true });
    const capture = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.capturePage())
        .toPNG()
        .toString("base64"),
    );
    await writeFile(
      ".impeccable/review/m5-24px-200-dark.png",
      Buffer.from(capture, "base64"),
    );
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
    ).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.setZoomFactor(1),
    );
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("html")).toHaveCSS("font-size", "20px");
    const saved = JSON.parse(
      await readFile(join(data, "localization.json"), "utf8"),
    );
    expect(saved.values.language).toBe("pt-BR");
    expect(saved.values.fontSize).toBe(20);
    expect(errors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close();
    await auth.close();
    await rm(data, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
