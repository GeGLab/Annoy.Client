import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {SecretStore} from '../../src/main/secrets.ts';
import {osStorage} from '../../src/main/safe-storage.ts';
import {createCipheriv,createDecipheriv} from 'node:crypto';
// A stand-in for the OS keychain cipher.
function seal(key,plain,aad){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(aad));const body=Buffer.concat([c.update(plain),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);}
function open(key,sealed,aad){const d=createDecipheriv('aes-256-gcm',key,sealed.subarray(0,12));d.setAAD(Buffer.from(aad));d.setAuthTag(sealed.subarray(12,28));return Buffer.concat([d.update(sealed.subarray(28)),d.final()]);}

function storage(){
 const key=randomBytes(32);let available=true,rotate=false,encrypted=0;
 return {
  api:{available:async()=>available,encrypt:async value=>{encrypted++;await new Promise(resolve=>setImmediate(resolve));return seal(key,Buffer.from(value),'os');},decrypt:async value=>({result:open(key,value,'os').toString(),shouldReEncrypt:rotate})},
  unavailable:()=>{available=false;},rotate:()=>{rotate=true;},count:()=>encrypted,
 };
}
test('async secret writes serialize concurrent account/global updates and keep the old ciphertext format',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'annoy-async-secrets-'));try{
  const file=join(dir,'secrets.json'),os=storage(),store=new SecretStore(file,os.api);
  await Promise.all([store.set('global','global-canary'),store.set('accounts','account-canary')]);
  assert.equal(await store.get('global'),'global-canary');assert.equal(await store.get('accounts'),'account-canary');
  const bytes=await readFile(file);assert.ok(!bytes.includes(Buffer.from('canary')));
  const envelope=JSON.parse(bytes);assert.equal(typeof envelope.global,'string');assert.equal(typeof envelope.accounts,'string');
  const before=envelope.global;os.rotate();assert.equal(await store.get('global'),'global-canary');
  const rotated=JSON.parse(await readFile(file,'utf8'));assert.notEqual(rotated.global,before);assert.equal(rotated.accounts,envelope.accounts);
  os.unavailable();assert.equal(await store.set('global','replacement'),false);assert.equal(await store.get('global'),null);
  assert.equal(JSON.parse(await readFile(file,'utf8')).global,rotated.global);
  await store.set('accounts',null);assert.ok(!('accounts'in JSON.parse(await readFile(file,'utf8'))));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unreadable secret metadata is preserved and a failed operation does not poison the queue',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'annoy-secret-retry-'));try{
  const file=join(dir,'secrets.json'),store=new SecretStore(file,storage().api);
  for(const invalid of ['invalid-json','[]','null','{"accounts":42}']){
   await writeFile(file,invalid);
   await assert.rejects(store.set('global','secret'));assert.equal(await readFile(file,'utf8'),invalid);
  }
  await writeFile(file,'{}');await store.set('global','secret');assert.equal(await store.get('global'),'secret');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('the Electron adapter only uses asynchronous APIs and refuses Linux plaintext/unknown storage',async()=>{
 const api={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async value=>Buffer.from(value),decryptStringAsync:async bytes=>({result:bytes.toString(),shouldReEncrypt:false}),getSelectedStorageBackend:()=> 'basic_text'};
 assert.equal(await osStorage(api,'linux').available(),false);
 assert.equal(await osStorage({...api,getSelectedStorageBackend:()=> 'unknown'},'linux').available(),false);
 assert.equal(await osStorage({...api,getSelectedStorageBackend:()=> 'gnome_libsecret'},'linux').available(),true);
 const windows=osStorage(api,'win32');assert.equal(await windows.available(),true);
 assert.deepEqual(await windows.decrypt(await windows.encrypt('legacy')),{result:'legacy',shouldReEncrypt:false});
 assert.equal(await osStorage({...api,isAsyncEncryptionAvailable:async()=>{throw new Error('temporarily unavailable');}},'win32').available(),false);
});
