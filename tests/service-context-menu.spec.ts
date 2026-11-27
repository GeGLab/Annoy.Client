import { electron } from "./fixtures/electron-launch.ts";
import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);

const PAGE = `<!doctype html><body style="margin:0">
<a id="link" href="https://browser.test/other" style="position:absolute;left:10px;top:10px;width:200px;height:40px;display:block">link</a>
<input id="field" style="position:absolute;left:10px;top:80px;width:200px;height:30px" value="text">
<div id="own" style="position:absolute;left:10px;top:150px;width:200px;height:40px">own menu</div>
<script>document.getElementById("own").addEventListener("contextmenu", e => e.preventDefault());</script>
</body>`;

test("browser services get a native right-click menu, without Inspect, unless the site draws its own", async () => {
  const directory = await mkdtemp(join(tmpdir(), "annoy-service-menu-test-"));
  const auth = await globalAuthFixture();
  const env = { ...process.env, ANNOY_GLOBAL_URL: auth.url, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  try {
    const page = await app.firstWindow();
    await auth.authenticate(page);
    await expect(page.locator(".welcome")).toBeVisible();
    await app.context().route("https://browser.test/**", route => route.fulfill({ contentType: "text/html", body: PAGE }));
    // Record the menus instead of showing them on screen.
    await app.evaluate(({ Menu }) => {
      (globalThis as any).__menus = [];
      Menu.prototype.popup = function (this: Electron.Menu) { (globalThis as any).__menus.push(this.items.filter(item => item.type !== "separator").map(item => item.label)); };
    });
    await page.evaluate(async () => {
      const { addService } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      addService({ id: "browser", kind: "web", name: "Browser", url: "https://browser.test" });
    });
    const ready = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(wc => wc.getURL().startsWith("https://browser.test") && !wc.isLoading()));
    await expect.poll(ready).toBe(true);
    const rightClick = (x: number, y: number) => app.evaluate(({ webContents }, [x, y]) => {
      const wc = webContents.getAllWebContents().find(item => item.getURL().startsWith("https://browser.test"))!;
      wc.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
      wc.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
    }, [x, y]);
    const menus = () => app.evaluate(() => (globalThis as any).__menus as string[][]);

    await rightClick(50, 30);
    await expect.poll(menus).toEqual([["Copiar link"]]);
    await rightClick(50, 95);
    await expect.poll(() => menus().then(list => list.length)).toBe(2);
    const field = (await menus())[1]!;
    expect(field).toEqual(["Recortar", "Copiar", "Colar", "Selecionar tudo"]);
    await rightClick(50, 170);
    await page.waitForTimeout(500);
    expect((await menus()).length).toBe(2);
    expect((await menus()).flat().some(label => /inspec/i.test(label))).toBe(false);
  } finally {
    await app.close();
    await auth.close();
    await rm(directory, { recursive: true, force: true });
  }
});
