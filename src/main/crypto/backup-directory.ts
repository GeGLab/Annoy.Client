import {lstat,mkdir,open as openFile,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {open,seal} from './vault.ts';
export interface BackupSource {id:string;key:Buffer;path:string}
interface BackupRecord {id:string;key:string;file:string;digest:string;size:number}
const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
const allowed=(id:string)=>!!id&&id.length<=2048&&!/^(protocol|protocol-expiry|device|session|creation|packages|cursor|refresh|cancel-result|restore-authorization):/.test(id);
async function readCipher(directory:string,record:BackupRecord):Promise<Buffer>{
 const path=join(directory,record.file),stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.size||stat.size>64*1024*1024+29)throw new Error('Arquivo de backup inválido');
 const bytes=await readFile(path);if(digest(bytes)!==record.digest)throw new Error('Integridade do backup inválida');return bytes;
}
/** Versioned container; each copied record retains its original standard AEAD.
 * Only the authenticated manifest exposes record keys, under the user's key. */
export async function writeBackupDirectory(directory:string,records:BackupSource[],key:Buffer,signal?:AbortSignal):Promise<void>{
 if(key.length!==32||records.length>100000)throw new Error('Limite de backup');
 await mkdir(directory,{mode:0o700});let complete=false;
 try{
  const manifest:BackupRecord[]=[];let total=0;
  for(const record of records){
   signal?.throwIfAborted();if(!allowed(record.id))throw new Error('Estado privado de sessão não pode entrar no backup');
   const stat=await lstat(record.path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024+29)throw new Error('Registro de backup inválido');
   total+=stat.size;if(total>64*1024*1024*1024)throw new Error('Backup limitado a 64 GiB');
   const bytes=await readFile(record.path,{signal});let plaintext:Buffer|undefined;
   try{
    plaintext=open(record.key,bytes,record.id); // Validate source AEAD before certifying the copy.
    const file=randomBytes(32).toString('hex')+'.enc';
    await writeFile(join(directory,file),bytes,{flag:'wx',mode:0o600,flush:true,signal});
    manifest.push({id:record.id,key:record.key.toString('base64'),file,digest:digest(bytes),size:bytes.length});
   }finally{plaintext?.fill(0);bytes.fill(0);}
  }
  const plain=Buffer.from(JSON.stringify({version:2,records:manifest}));
  try{await writeFile(join(directory,'manifest.enc'),seal(key,plain,'backup-directory/v2'),{flag:'wx',mode:0o600,flush:true,signal});}finally{plain.fill(0);}
  if(process.platform!=="win32"){const handle=await openFile(directory,"r");try{await handle.sync();}finally{await handle.close();}}
  await readBackupDirectory(directory,key,undefined,signal);
  complete=true;
 }finally{if(!complete)await rm(directory,{recursive:true,force:true});}
}
/** Validate the entire directory first. The consumer then imports bounded chunks;
 * retries preserve current records and deletion tombstones. */
export async function readBackupDirectory(directory:string,key:Buffer,consume:((id:string,plaintext:Buffer)=>void)|undefined,signal?:AbortSignal):Promise<number>{
 const manifestPath=join(directory,'manifest.enc'),stat=await lstat(manifestPath);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw new Error('Manifesto de backup inválido');
 const plaintext=open(key,await readFile(manifestPath),'backup-directory/v2');let records:BackupRecord[];
 try{const data=JSON.parse(plaintext.toString());if(data.version!==2||!Array.isArray(data.records)||data.records.length>100000)throw new Error('Versão de backup inválida');records=data.records;}finally{plaintext.fill(0);}
 const seen=new Set<string>();let total=0;
 for(const record of records){
  signal?.throwIfAborted();if(!record||!allowed(record.id)||seen.has(record.id)||typeof record.key!=='string'||Buffer.from(record.key,'base64').length!==32||!/^[a-f0-9]{64}\.enc$/.test(record.file)||!/^[a-f0-9]{64}$/.test(record.digest)||!Number.isSafeInteger(record.size)||record.size<29)throw new Error('Registro de backup inválido');
  seen.add(record.id);total+=record.size;if(total>64*1024*1024*1024)throw new Error('Limite de backup');
  const bytes=await readCipher(directory,record),recordKey=Buffer.from(record.key,'base64');let plain:Buffer|undefined;
  try{plain=open(recordKey,bytes,record.id);}finally{plain?.fill(0);recordKey.fill(0);bytes.fill(0);}
 }
 if(!consume)return records.length;
 // Deletions must precede ordinary records, regardless of container order.
 records.sort((a,b)=>Number(b.id.startsWith('tombstone:'))-Number(a.id.startsWith('tombstone:')));
 for(const record of records){
  signal?.throwIfAborted();const bytes=await readCipher(directory,record),recordKey=Buffer.from(record.key,'base64');let plain:Buffer|undefined;
  try{plain=open(recordKey,bytes,record.id);consume(record.id,plain);}finally{plain?.fill(0);recordKey.fill(0);bytes.fill(0);}
 }
 return records.length;
}
