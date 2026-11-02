import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync,mkdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {EncryptedVault,seal,open} from '../../src/main/crypto/vault.ts';

test('local vault encrypts records, authenticates context and never exports protocol or temporary keys',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-vault-'));const os=randomBytes(32),recovery=randomBytes(32);
 const protector={available:()=>true,seal:k=>seal(os,k,'test-os'),open:b=>open(os,b,'test-os')};
 let vault=new EncryptedVault(dir,protector);
 try {
  await vault.unlock();vault.put('message:permanent',Buffer.from('permanent-canary'),{backup:true});
  vault.put('message:temporary',Buffer.from('temporary-canary'),{expiresAt:Date.now()+10000,backup:true});
  vault.put('protocol:device',Buffer.from('private-state-canary'),{backup:true});
  for(const f of readdirSync(dir)) assert.ok(!readFileSync(join(dir,f)).includes(Buffer.from('canary')));
  const backup=vault.exportPermanent(recovery);
  const data=JSON.parse(open(recovery,backup,'backup').toString());
  assert.deepEqual(Object.keys(data.records),['message:permanent']);
  vault.delete('message:temporary');vault.lock();vault=new EncryptedVault(dir,protector);await vault.unlock();
  assert.equal(vault.get('message:temporary'),null);assert.equal(vault.get('message:permanent').toString(),'permanent-canary');
  vault.importPermanent(backup,recovery);assert.equal(vault.get('message:temporary'),null);
  assert.throws(()=>open(recovery,backup,'wrong-context'));assert.throws(()=>open(randomBytes(32),backup,'backup'));
  vault.put('short',Buffer.from('expires'),{expiresAt:Date.now()+1000});vault.expire(Date.now()+2000);assert.equal(vault.get('short'),null);
 } finally {vault.lock();rmSync(dir,{recursive:true,force:true});}
});
test('no secure protector means no unencrypted fallback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-no-keychain-'));
 try {await assert.rejects(()=>new EncryptedVault(dir,{available:()=>false,seal:b=>b,open:b=>b}).unlock(),/unavailable/);assert.deepEqual(readdirSync(dir),[]);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('releasing a backup after locking cannot erase live vault records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-backup-lock-')),os=randomBytes(32);
 const vault=new EncryptedVault(dir,{available:()=>true,seal:b=>seal(os,b,'os'),open:b=>open(os,b,'os')});
 try{
  await vault.unlock();vault.put('permanent',Buffer.from('survives lock'),{backup:true});
  const pinned=vault.pinPermanent();vault.lock();pinned.release();
  assert.ok(pinned.records.every(record=>record.key.every(value=>value===0)));
  await vault.unlock();assert.equal(vault.get('permanent').toString(),'survives lock');
 }finally{vault.lock();rmSync(dir,{recursive:true,force:true});}
});
test('restoration preserves pins and edits, applies deletion tombstones first, and imports atomically',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-restore-')),key=randomBytes(32),os=randomBytes(32);
 const vault=new EncryptedVault(dir,{available:()=>true,seal:b=>seal(os,b,'os'),open:b=>open(os,b,'os')});await vault.unlock();
 const backup=records=>seal(key,Buffer.from(JSON.stringify({version:1,records:Object.fromEntries(Object.entries(records).map(([id,v])=>[id,Buffer.from(JSON.stringify(v)).toString('base64')]))})),'backup');
 try{
  vault.put('trust:instance:peer',Buffer.from('{"verified":true,"revoked":true}'),{backup:true});
  vault.put('messages:i:u:c:entry:m',Buffer.from('edited permanent message'),{backup:true});
  vault.importPermanent(backup({'trust:instance:peer':{verified:false,revoked:false},'messages:i:u:c:entry:m':'old content'}),key);
  assert.equal(vault.get('messages:i:u:c:entry:m').toString(),'edited permanent message');
  assert.equal(JSON.parse(vault.get('trust:instance:peer').toString()).revoked,true);
  vault.importPermanent(backup({'messages:i:u:c:entry:m':'old content','tombstone:messages:i:u:c:entry:m':{deleted:true}}),key);
  assert.equal(vault.get('messages:i:u:c:entry:m'),null);
  assert.throws(()=>vault.importPermanent(backup({'new-record':'should not persist','protocol:forged':'private-state'}),key));
  assert.equal(vault.get('new-record'),null);
  assert.throws(()=>vault.transaction(()=>{vault.put('transaction-record',Buffer.from('partial'));throw new Error('simulated write failure');}));
  assert.equal(vault.get('transaction-record'),null);
  vault.lock();await vault.unlock();assert.equal(vault.get('transaction-record'),null);
 }finally{vault.lock();rmSync(dir,{recursive:true,force:true});}
});

test('key index upgrades v1 atomically and rewrites only one shard per message update',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-shards-')),os=randomBytes(32),master=randomBytes(32),recordKey=randomBytes(32),blob=randomBytes(32).toString('hex');
 const protector={available:()=>true,seal:b=>seal(os,b,'os'),open:b=>open(os,b,'os')};
 writeFileSync(join(dir,'master.sealed'),protector.seal(master));
 writeFileSync(join(dir,blob+'.enc'),seal(recordKey,Buffer.from('original-v1-message'),'old-message'));
 writeFileSync(join(dir,'index.enc'),seal(master,Buffer.from(JSON.stringify({version:1,entries:{'old-message':{blob,key:recordKey.toString('base64'),expiresAt:null,backup:true}}})),'index'));
 const vault=new EncryptedVault(dir,protector);
 try{
  await vault.unlock();assert.equal(vault.get('old-message').toString(),'original-v1-message');assert.equal(readFileSync(join(dir,'index.enc'))[0],2);
  vault.transaction(()=>{for(let i=0;i<1000;i++)vault.put('message:'+i,Buffer.from('synthetic message '+i),{backup:true});});
  const before=new Set(readdirSync(dir));vault.put('message:500',Buffer.from('updated'));
  const created=readdirSync(dir).filter(f=>!before.has(f));assert.equal(created.length,2,'only a message record and its key shard get new ciphertext files');
  assert.ok(readFileSync(join(dir,'index.enc')).length<128*1024,'root manifest size stays bounded');
  vault.lock();await vault.unlock();assert.equal(vault.get('message:500').toString(),'updated');assert.equal(vault.get('message:999').toString(),'synthetic message 999');
  const root=readFileSync(join(dir,'index.enc'));unlinkSync(join(dir,'index.enc'));mkdirSync(join(dir,'index.enc'));
  assert.throws(()=>vault.put('failed-record',Buffer.from('not committed')),/commit failed/);
  rmdirSync(join(dir,'index.enc'));writeFileSync(join(dir,'index.enc'),root);
  vault.lock();await vault.unlock();assert.equal(vault.get('failed-record'),null);assert.equal(vault.get('message:500').toString(),'updated');
 }finally{vault.lock();master.fill(0);recordKey.fill(0);rmSync(dir,{recursive:true,force:true});}
});
test('directory backup retains only permanent data, validates all files before restore and tolerates concurrent edits',async()=>{
 const {writeBackupDirectory,readBackupDirectory}=await import('../../src/main/crypto/backup-directory.ts');
 const dir=mkdtempSync(join(tmpdir(),'annoy-directory-backup-')),os=randomBytes(32),recovery=randomBytes(32);
 const protector={available:()=>true,seal:b=>seal(os,b,'os'),open:b=>open(os,b,'os')};
 const source=new EncryptedVault(join(dir,'source'),protector),target=new EncryptedVault(join(dir,'target'),protector);await source.unlock();await target.unlock();
 try{
  source.put('permanent',Buffer.from('original history'),{backup:true});source.put('large-file',Buffer.alloc(5*1024*1024,7),{backup:true});
  source.put('protocol:device',Buffer.from('must never export'),{backup:true});source.put('temporary',Buffer.from('expires'),{backup:true,expiresAt:Date.now()+60000});
  const snapshot=source.pinPermanent();assert.deepEqual(snapshot.records.map(r=>r.id),['permanent','large-file']);
  source.put('permanent',Buffer.from('edited history'),{backup:true});
  try{await writeBackupDirectory(join(dir,'backup'),snapshot.records,recovery);}finally{snapshot.release();}
  const restored=await readBackupDirectory(join(dir,'backup'),recovery,(id,bytes)=>target.restorePermanentRecord(id,bytes));assert.equal(restored,2);
  assert.equal(target.get('permanent').toString(),'original history');assert.equal(target.get('large-file').length,5*1024*1024);
  assert.equal(target.get('protocol:device'),null);assert.equal(target.get('temporary'),null);
  const file=readdirSync(join(dir,'backup')).find(f=>f!=='manifest.enc'),path=join(dir,'backup',file),bytes=readFileSync(path);bytes[bytes.length-1]^=1;writeFileSync(path,bytes);
  let applied=0;await assert.rejects(readBackupDirectory(join(dir,'backup'),recovery,()=>applied++));assert.equal(applied,0,'corrupt archive cannot apply partial records');
 }finally{source.lock();target.lock();recovery.fill(0);rmSync(dir,{recursive:true,force:true});}
});
