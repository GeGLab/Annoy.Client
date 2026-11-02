import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LANGUAGES,
  catalogs,
  defaultLocalization,
  normalizeLocalization,
  configureLocalization,
  t,
  number,
  time,
  counted,
  messageTemplate,
  onLocalizationChange,
} from "../../src/shared/localization/index.ts";
import {
  readPreferences,
  writePreferences,
} from "../../src/main/settings-file.ts";
test("seven local catalogs have identical keys and interpolation slots", () => {
  const source = catalogs["pt-BR"];
  assert.ok(Object.keys(source).length > 1500);
  for (const language of LANGUAGES) {
    assert.deepEqual(
      Object.keys(catalogs[language]).sort(),
      Object.keys(source).sort(),
      language,
    );
    for (const [key, value] of Object.entries(source)) {
      const text = catalogs[language][key];
      assert.ok(typeof text === "string" && text.trim(), `${language}:${key}`);
      assert.deepEqual(
        [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
        [...value.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(),
        `${language}:${key}`,
      );
    }
  }
});
test("legacy installs keep Portuguese; preferences reject malformed values", () => {
  assert.equal(defaultLocalization("ja-JP").language, "pt-BR");
  assert.equal(defaultLocalization("ja-JP").region, "ja-JP");
  assert.deepEqual(
    normalizeLocalization({
      language: "bad",
      region: "bad_!",
      fontSize: 999,
      underlineLinks: "no",
      hourCycle: 24,
    }),
    { ...defaultLocalization(), fontSize: 24 },
  );
  assert.equal(
    normalizeLocalization({ language: "en", region: "pt-BR", hourCycle: "h12" })
      .language,
    "en",
  );
});
test("language, region and clock are independent; fallback and safe interpolation", () => {
  configureLocalization({
    ...defaultLocalization(),
    language: "en",
    region: "de-DE",
    hourCycle: "h12",
  });
  assert.equal(number(12345.5), "12.345,5");
  assert.match(time("2026-10-30T16:25:00"), /4:25|04:25/);
  assert.equal(
    counted(1, "counts.server.one", "counts.server.other"),
    "1 server",
  );
  assert.equal(
    counted(2, "counts.server.one", "counts.server.other"),
    "2 servers",
  );
  assert.equal(
    t("counts.server.one", { count: "<script>" }),
    "<script> server",
  );
  assert.equal(
    messageTemplate("counts.server.one", "missing"),
    catalogs["pt-BR"]["counts.server.one"],
  );
  let changes = 0;
  const off = onLocalizationChange(() => changes++);
  configureLocalization(defaultLocalization());
  off();
  configureLocalization(defaultLocalization());
  assert.equal(changes, 1);
});
test("versioned atomic preferences round trip and recover from corrupt/unknown versions", () => {
  const root = mkdtempSync(join(tmpdir(), "annoy-preferences-"));
  try {
    const file = join(root, "prefs.json");
    const values = { ...defaultLocalization("en-GB"), language: "ja" };
    writePreferences(file, values);
    assert.equal(JSON.parse(readFileSync(file)).version, 1);
    assert.deepEqual(readPreferences(file, normalizeLocalization), values);
    writePreferences(file, { ...values, fontSize: 20 });
    assert.equal(readPreferences(file, normalizeLocalization).fontSize, 20);
    assert.equal(
      readPreferences(join(root, "absent.json"), normalizeLocalization)
        .language,
      "pt-BR",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
