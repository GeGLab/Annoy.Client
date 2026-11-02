import {t as translate} from "../shared/localization/index.ts";
import {createHash,createPublicKey,verify} from 'node:crypto';
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {z} from 'zod';
const version=z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/);
const schema=z.object({format:z.literal(1),keyId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),version,platform:z.enum(['win32','linux']),arch:z.enum(['x64','arm64']),filename:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),size:z.number().int().positive().max(4*1024*1024*1024),sha512:z.string().regex(/^[A-Za-z0-9+/]{86}==$/),signature:z.string().regex(/^[A-Za-z0-9_-]{86}$/)}).strict();
export type SignedUpdate=z.infer<typeof schema>;
export type UpdateMetadata={version:string;files:{url:string;sha512:string;size?:number}[]};
export function signedUpdatePayload(value:Omit<SignedUpdate,'signature'>):Buffer {
 return Buffer.from(JSON.stringify(['annoy/update/artifact/v1',value.keyId,value.version,value.platform,value.arch,value.filename,value.size,value.sha512]));
}
export function authenticateUpdate(raw:unknown,keys:Readonly<Record<string,string>>,expected:{version:string;platform:string;arch:string}):SignedUpdate {
 const parsed=schema.safeParse(raw);if(!parsed.success)throw new Error(translate("common.36d1f5cfc1d8"));const manifest=parsed.data;
 if(manifest.version!==expected.version||manifest.platform!==expected.platform||manifest.arch!==expected.arch)throw new Error(translate("common.088c044b47cd"));
 const encoded=keys[manifest.keyId];if(!encoded)throw new Error(translate("common.9ba1380cfdd5"));
 try{const key=createPublicKey(encoded);if(key.asymmetricKeyType!=='ed25519'||!verify(null,signedUpdatePayload(manifest),key,Buffer.from(manifest.signature,'base64url')))throw new Error();}
 catch{throw new Error(translate("common.277a05b60c46"));}return manifest;
}
export async function verifyUpdateFile(path:string,manifest:SignedUpdate):Promise<void>{
 const before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.size!==manifest.size)throw new Error(translate("common.09dc6087544a"));
 const file=await open(path,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
 try{
  const initial=await file.stat();if(initial.size!==before.size||initial.ino!==before.ino)throw new Error(translate("common.bf9ab649cd6f"));
  const hash=createHash('sha512');for await(const bytes of file.createReadStream({autoClose:false}))hash.update(bytes);
  const after=await file.stat();if(initial.size!==after.size||initial.mtimeMs!==after.mtimeMs||!hash.digest().equals(Buffer.from(manifest.sha512,'base64')))throw new Error(translate("common.1183f1343a53"));
 }finally{await file.close();}
}
export function updateManifestUrl(base:string,expected:{version:string;platform:string;arch:string}):URL {
 version.parse(expected.version);if(!['win32','linux'].includes(expected.platform)||!['x64','arm64'].includes(expected.arch))throw new Error(translate("common.77370c9bee27"));
 const url=new URL(base.endsWith('/')?base:base+'/');
 if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error(translate("common.152c79523bdb"));
 return new URL(`annoy-${expected.platform}-${expected.arch}-${expected.version}.signed.json`,url);
}
export async function fetchUpdateManifest(base:string,expected:{version:string;platform:string;arch:string},fetcher:typeof fetch=fetch):Promise<unknown>{
 const response=await fetcher(updateManifestUrl(base,expected),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw new Error(translate("common.cef8a568a2d5"));
 const chunks:Uint8Array[]=[];let length=0;
 for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){length+=chunk.length;if(length>16384)throw new Error(translate("common.6adf178c35f0"));chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Error(translate("common.36d1f5cfc1d8"));}
}
export function matchUpdateMetadata(manifest:SignedUpdate,info:UpdateMetadata):void {
 if(info.version!==manifest.version||!info.files.some(file=>{
  try{return decodeURIComponent(new URL(file.url,'https://update.invalid/').pathname.split('/').at(-1)!)===manifest.filename&&file.sha512===manifest.sha512&&(file.size===undefined||file.size===manifest.size);}catch{return false;}
 }))throw new Error(translate("common.754772a379a6"));
}
