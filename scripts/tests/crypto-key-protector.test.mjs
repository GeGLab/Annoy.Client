import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,argon2} from 'node:crypto';
import {promisify} from 'node:util';
import {open} from '../../src/main/crypto/vault.ts';
import {VaultKeyProtector} from '../../src/main/crypto/key-protector.ts';
import {EncryptedVault} from '../../src/main/crypto/vault.ts';
test('explicit password unlock protects the vault without an OS keychain and survives restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-password-protector-'));
 const os={available:()=>false,encrypt:()=>{throw new Error('unavailable')},decrypt:()=>{throw new Error('unavailable')}};
 let protector=new VaultKeyProtector(dir,os);let vault=new EncryptedVault(dir,protector);
 try{
  assert.throws(()=>vault.unlock(),/unavailable/);await protector.unlockPassword('local password for tests');vault.unlock();vault.put('record',Buffer.from('secret'));vault.lock();protector.lock();
  assert.ok(!readFileSync(join(dir,'master.sealed')).includes(Buffer.from('local password')));
  const salt=Buffer.from(JSON.parse(readFileSync(join(dir,'password-kdf.json'),'utf8')).salt,'base64');
  const reference=await promisify(argon2)('argon2id',{message:'local password for tests',nonce:salt,memory:65536,passes:3,parallelism:1,tagLength:32});
  const envelope=JSON.parse(readFileSync(join(dir,'master.sealed'),'utf8'));
  assert.equal(open(reference,Buffer.from(envelope.data,'base64'),'password-master').length,32,'libsodium output matches existing Node Argon2id storage format');reference.fill(0);
  protector=new VaultKeyProtector(dir,os);vault=new EncryptedVault(dir,protector);await protector.unlockPassword('wrong password for tests');assert.throws(()=>vault.unlock(),/incorreta/);
  await protector.unlockPassword('local password for tests');vault.unlock();assert.equal(vault.get('record').toString(),'secret');
 }finally{vault.lock();protector.lock();rmSync(dir,{recursive:true,force:true});}
});
