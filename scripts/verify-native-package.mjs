// Offline Linux package-content check. Does not start Electron, install or publish.
import {readFileSync,lstatSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

if(process.platform!=='linux'||process.arch!=='x64')throw new Error('This package check is currently validated only on Linux x64');
if(!process.argv[2])throw new Error('Usage: node scripts/verify-native-package.mjs PATH_TO_LINUX_UNPACKED');
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=resolve(process.argv[2]);
// Resolve the same tooling versions declared by the installed packager.
const require=createRequire(import.meta.url),builderRequire=createRequire(require.resolve('app-builder-lib/package.json'));
const {listPackage,extractFile}=builderRequire('@electron/asar');
const {getCurrentFuseWire,FuseV1Options}=builderRequire('@electron/fuses');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const asar=join(root,'resources/app.asar'),native=join(root,'resources/crypto/annoy-crypto');
for(const file of [asar,native])assert.ok(lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink(),'Package resources must be regular files');
const paths=listPackage(asar),metadata=JSON.parse(extractFile(asar,'package.json'));
const sourceMetadata=JSON.parse(readFileSync(join(project,'package.json'),'utf8'));
assert.equal(metadata.version,sourceMetadata.version);assert.equal(metadata.main,'out/main/index.js');
const compiled=['out/main/index.js','out/preload/index.cjs','out/renderer/index.html'];
for(const file of compiled)assert.equal(digest(extractFile(asar,file)),digest(readFileSync(join(project,file))),'Packaged code differs from the validated build');
const runtime=['node_modules/libsodium-sumo/dist/modules-sumo/libsodium-sumo.js','node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js',
 ...readdirSync(join(project,'node_modules/jose/dist/webapi'),{recursive:true}).filter(file=>file.endsWith('.js')).map(file=>'node_modules/jose/dist/webapi/'+file)];
for(const file of runtime)
 assert.equal(digest(extractFile(asar,file)),digest(readFileSync(join(project,file))),'Required crypto runtime differs from the installed dependency');
// The packager removes descriptive fields such as keywords. Verify runtime
// package resolution semantically instead of comparing that JSON formatting.
for(const name of ['jose','libsodium-sumo','libsodium-wrappers-sumo']){
 const file='node_modules/'+name+'/package.json',actual=JSON.parse(extractFile(asar,file)),expected=JSON.parse(readFileSync(join(project,file),'utf8'));
 for(const field of ['name','version','type','main','module','exports','dependencies'])assert.deepEqual(actual[field],expected[field],'Crypto package resolution differs from the installed dependency');
}
const sensitive=paths.filter(path=>/\.(?:sqlite3?|db|p12|pfx|pem|key|annoy-backup)$/i.test(path)||/(?:^|\/)(?:\.env(?:\.|$)|crypto-v1(?:\/|$)|test-results(?:\/|$))/.test(path));
assert.equal(sensitive.length,0,'Review unexpected sensitive-looking artifacts in the package');
const nativeBytes=readFileSync(native),expectedNative=readFileSync(join(project,'native/annoy-crypto/target/release/annoy-crypto'));
assert.equal(nativeBytes.subarray(0,4).toString('hex'),'7f454c46');assert.equal(nativeBytes[4],2);assert.equal(nativeBytes.readUInt16LE(18),62);
assert.ok(lstatSync(native).mode&0o111,'Native service is not executable');
assert.equal(digest(nativeBytes),digest(expectedNative),'Bundled MLS process differs from the tested release binary');
const executable=join(root,sourceMetadata.build.linux.executableName??sourceMetadata.name),wire=await getCurrentFuseWire(executable);
for(const [flag,expected]of [[FuseV1Options.RunAsNode,48],[FuseV1Options.EnableNodeOptionsEnvironmentVariable,48],[FuseV1Options.EnableNodeCliInspectArguments,48],[FuseV1Options.OnlyLoadAppFromAsar,49]])
 assert.equal(wire[flag],expected,'Packaged Electron hardening fuse is not set');
console.log(JSON.stringify({format:1,createdAt:new Date().toISOString(),platform:process.platform,architecture:process.arch,version:metadata.version,archiveEntries:paths.length,
 archiveSha256:digest(readFileSync(asar)),nativeSha256:digest(nativeBytes),executableSha256:digest(readFileSync(executable)),compiledEntriesMatch:true,cryptoRuntimeMatches:true,cryptoRuntimeFilesChecked:runtime.length,sensitiveLookingEntries:sensitive.length,
 fuses:{runAsNode:wire[FuseV1Options.RunAsNode]===49,nodeOptions:wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable]===49,mainInspector:wire[FuseV1Options.EnableNodeCliInspectArguments]===49,onlyLoadAsar:wire[FuseV1Options.OnlyLoadAppFromAsar]===49},
 osSignatureValidated:false,installed:false,published:false,note:'Content/hash/fuse verification only; not a runtime, installer or OS signature approval. Linux has no embedded ASAR integrity support in the selected Electron.'},null,2));
