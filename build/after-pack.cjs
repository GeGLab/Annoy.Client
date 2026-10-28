// electron-builder afterPack hook.
//
// Building for Windows on Linux normally needs Wine to run rcedit, which
// stamps the app icon and version info into the .exe. `signAndEditExecutable`
// is off in package.json, so this does the same edit in pure JavaScript with
// resedit. It runs before the NSIS installer is assembled.
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const PE = await import("pe-library");

  const { productFilename, info } = context.packager.appInfo;
  const exePath = join(context.appOutDir, `${productFilename}.exe`);
  const exe = PE.NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);

  const icon = ResEdit.Data.IconFile.from(readFileSync(join(__dirname, "icon.ico")));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  if (groups.length === 0) throw new Error("No icon group found in the Electron executable");
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      icon.icons.map((i) => i.data),
    );
  }

  const version = context.packager.appInfo.version;
  const [major, minor, patch] = version.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (!vi) throw new Error("No version resource found in the Electron executable");
  const lang = vi.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    ProductName: context.packager.appInfo.productName,
    FileDescription: context.packager.appInfo.productName,
    CompanyName: info.metadata.author?.name ?? info.metadata.author ?? "",
    LegalCopyright: context.packager.appInfo.copyright,
    OriginalFilename: `${productFilename}.exe`,
    InternalName: productFilename,
    FileVersion: version,
    ProductVersion: version,
  });
  vi.setFileVersion(major, minor, patch, 0, lang.lang);
  vi.setProductVersion(major, minor, patch, 0, lang.lang);
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • stamped icon and version ${version} into ${productFilename}.exe`);
};
