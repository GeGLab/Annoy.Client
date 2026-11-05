import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);

// A nightly build whose user chose the alpha channel (TODO 6.2): waiting is
// recommended, going now asks first.
test("a nightly build on the alpha channel recommends waiting and asks before going back", async () => {
  const data = await mkdtemp(join(tmpdir(), "annoy-channel-"));
  await writeFile(join(data, "updates.json"), JSON.stringify({ version: 1, values: { notifications: false, channel: "alpha" } }));
  const auth = await globalAuthFixture();
  const env = { ...process.env, ANNOY_TEST_DATA: data, ANNOY_GLOBAL_URL: auth.url, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178", ANNOY_TEST_VERSION: "0.10.0-nightly.202611200300" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await auth.keepAuthenticated(page);
  try {
    await expect(page.locator(".welcome")).toBeVisible();
    expect(await page.evaluate(() => window.distopic!.updates.channel())).toMatchObject({ channel: "alpha", outside: true, buildChannel: "nightly", leaving: false });
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Atualizações", exact: true }).click();
    const note = page.locator(".update-channel-outside");
    await expect(note).toContainText("Esta é uma build Nightly");
    await expect(note).toContainText("Recomendamos fortemente aguardar uma versão estável para evitar perda de dados.");
    await note.getByRole("button", { name: "Ir para a versão Alpha agora" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("pode quebrar opções");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    expect((await page.evaluate(() => window.distopic!.updates.channel())).leaving).toBe(false);
    await note.getByRole("button", { name: "Ir para a versão Alpha agora" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Instalar mesmo assim" }).click();
    await expect(note.getByRole("button")).toHaveCount(0);
    expect((await page.evaluate(() => window.distopic!.updates.channel())).leaving).toBe(true);
    await page.screenshot({ path: join("test-results", "update-channel-outside.png") });
    // All channels are offered; choosing nightly again clears the notice.
    const picker = page.getByRole("combobox", { name: "Canal" });
    await expect(picker.locator("option")).toHaveText(["Alpha", "Instável", "Nightly"]);
    await picker.selectOption("nightly");
    await expect(note).toHaveCount(0);
    expect(await page.evaluate(() => window.distopic!.updates.channel())).toMatchObject({ channel: "nightly", outside: false, leaving: false });
    await page.screenshot({ path: join("test-results", "update-channel-picker.png") });
  } finally {
    await app.close();
    await auth.close?.();
    await rm(data, { recursive: true, force: true });
  }
});
