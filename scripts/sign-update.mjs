// Offline signing only. Does not upload, publish, generate keys or edit trust pins.
import {createHash,createPrivateKey,sign} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {signedUpdatePayload,authenticateUpdate} from '../src/main/update-signature.ts';
const [artifact,version,platform,arch,keyId,keyPath,directory]=process.argv.slice(2);
if(!directory)throw new Error('Usage: sign-update.mjs ARTIFACT VERSION win32|linux x64|arm64 KEY_ID PRIVATE_KEY_PATH EXISTING_OUTPUT_DIRECTORY');
const bytes=await readFile(keyPath);let key;
try{key=createPrivateKey(bytes);if(key.asymmetricKeyType!=='ed25519')throw new Error('Use an Ed25519 signing key');}finally{bytes.fill(0);}
const hash=createHash('sha512');for await(const bytes of createReadStream(artifact))hash.update(bytes);
const manifest={format:1,keyId,version,platform,arch,filename:basename(artifact),size:(await lstat(artifact)).size,sha512:hash.digest('base64')};
const signed={...manifest,signature:sign(null,signedUpdatePayload(manifest),key).toString('base64url')};
const {createPublicKey}=await import('node:crypto');authenticateUpdate(signed,{[keyId]:createPublicKey(key).export({format:'pem',type:'spki'}).toString()},{version,platform,arch});
await writeFile(join(directory,`annoy-${platform}-${arch}-${version}.signed.json`),JSON.stringify(signed,null,2)+'\n',{flag:'wx',mode:0o644,flush:true});
console.log('Detached manifest written locally; no release published.');
