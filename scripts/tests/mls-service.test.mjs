import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {EncryptedVault,seal,open} from '../../src/main/crypto/vault.ts';
import {MlsService,expireStoredOutboxes} from '../../src/main/crypto/mls-service.ts';
const binary=process.env.ANNOY_CRYPTO_BINARY??resolve('native/annoy-crypto/target/debug/annoy-crypto'+(process.platform==='win32'?'.exe':''));
if(process.env.ANNOY_REQUIRE_NATIVE==='1'&&!existsSync(binary))throw new Error('Native OpenMLS binary missing; security validation cannot skip this test');
test('real native service persists ratchets and delivery outbox before returning ciphertext', {skip:!existsSync(binary)},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-native-'));const master=randomBytes(32);
 const vault=new EncryptedVault(dir,{available:()=>true,seal:b=>seal(master,b,'os'),open:b=>open(master,b,'os')});vault.unlock();
 let a=new MlsService(binary,vault,'alice','a');const b=new MlsService(binary,vault,'bob','b');
 try {
  const kp=await b.command({op:'key_package'});
  await a.command({op:'create',group:'g'});
  // Public signing key is obtainable from the self-member list, never secret snapshot.
  await b.command({op:'create',group:'self'});const own=await b.command({op:'members',group:'self'});
  const {welcome}=await a.command({op:'add',group:'g',package:kp.package,identity:'bob',key:own[0].signature_key},'add-1');
  const members=await a.command({op:'members',group:'g'});await b.command({op:'join',group:'g',wire:welcome,members});
  const first=await a.command({op:'send',group:'g',plaintext:'message'},'send-1');
  a.stop();a=new MlsService(binary,vault,'alice','a');
  assert.deepEqual(await a.command({op:'send',group:'g',plaintext:'message'},'send-1'),first);
  await assert.rejects(a.command({op:'send',group:'g',plaintext:'changed'},'send-1'),/reused/);
  assert.equal((await b.command({op:'receive',group:'g',wire:first.wire})).plaintext,'message');
  await assert.rejects(b.command({op:'receive',group:'g',wire:first.wire}));
  // Rejected operation restores the complete native state, allowing a subsequent valid operation.
  await assert.rejects(b.command({op:'receive',group:'g',wire:'invalid'}));
  const next=await a.command({op:'send',group:'g',plaintext:'next'},'send-2');
  assert.equal((await b.command({op:'receive',group:'g',wire:next.wire})).plaintext,'next');
  await a.acknowledge('send-1');
  const expiresAt=new Date(Date.now()+60000).toISOString(),temporary=JSON.stringify({type:'send',channel:'g',id:'temporary',expiresAt});
  await a.command({op:'send',group:'g',plaintext:'pending temporary canary'},temporary);
  assert.ok((await a.pendingOutbox()).some(item=>item.id===temporary));
  a.stop();expireStoredOutboxes(vault,Date.now()+120000);
  const state=vault.get('protocol:a');assert.ok(!state.toString().includes('pending temporary canary'));state.fill(0);
  assert.ok(!(await a.pendingOutbox()).some(item=>item.id===temporary),'offline queue cannot resurrect an expired pending message');
 } finally {a.stop();b.stop();vault.lock();rmSync(dir,{recursive:true,force:true});}
});

test('dedicated media engines export only acknowledged epochs, never queue keys, and retire all call state', {skip:!existsSync(binary)},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-media-')),master=randomBytes(32),recovery=randomBytes(32),keys=[];
 const vault=new EncryptedVault(dir,{available:()=>true,seal:b=>seal(master,b,'os'),open:b=>open(master,b,'os')});vault.unlock();
 const a=new MlsService(binary,vault,'alice','media:alice:call','media'),b=new MlsService(binary,vault,'bob','media:bob:call','media');
 const messages=new MlsService(binary,vault,'alice','messages');
 const group='annoy/media/v1/instance-a/call-a';
 try{
  await messages.command({op:'create',group:'permanent'});
  vault.put('message:kept',Buffer.from('permanent history remains'),{backup:true});
  await a.command({op:'create_media',group});
  const kp=await b.command({op:'key_package'}),pub=await b.command({op:'public_key'});
  // Conversation membership operations never apply to a call engine.
  await assert.rejects(a.command({op:'add',group,package:kp.package,identity:'bob',key:pub.key}),/group_domain_mismatch/);
  // A commit the voice service refused is rolled back before anything else uses its epoch.
  const refused=await a.command({op:'media_commit',group,adds:[{package:kp.package,identity:'bob',key:pub.key}],removes:[]},'refused');
  assert.equal(refused.epoch,'1');await assert.rejects(a.mediaKey(group,'1'),/acknowledged/);
  await a.rollbackRejectedCommit('refused');
  const zero=await a.mediaKey(group,'0');keys.push(zero.key);
  const kp2=await b.command({op:'key_package'});
  const added=await a.command({op:'media_commit',group,adds:[{package:kp2.package,identity:'bob',key:pub.key}],removes:[]},'admit-bob');
  const epoch=String(added.epoch);
  await assert.rejects(a.mediaKey(group,epoch),/acknowledged/);
  await a.acknowledge('admit-bob');
  await b.command({op:'join_media',group,wire:added.welcome,members:added.members});
  const sent=[],received=[],write=a.child.stdin.write.bind(a.child.stdin);
  a.child.stdin.write=(bytes,...args)=>{assert.ok(Buffer.isBuffer(bytes));sent.push(bytes);return write(bytes,...args);};
  a.child.stdout.on('data',bytes=>received.push(bytes));
  const first=await a.mediaKey(group,epoch),peer=await b.mediaKey(group,epoch);keys.push(first.key,peer.key);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent.length>0&&sent.every(bytes=>bytes.every(value=>value===0)),'private stdin buffers are cleared after writing');
  assert.ok(received.length>0&&received.every(bytes=>bytes.every(value=>value===0)),'private stdout chunks are cleared after parsing');
  assert.ok(first.key.equals(peer.key));assert.equal(first.key.length,32);assert.equal(first.suite,5);assert.notEqual(first.senderIndex,peer.senderIndex);
  await assert.rejects(a.command({op:'media_base_key',group,epoch},'never-cache-a-key'),/outbox/);
  await assert.rejects(a.mediaKey(group,'0'+epoch),/invalid_media_epoch/);
  assert.deepEqual(await a.pendingOutbox(),[]);
  const update=await a.command({op:'update',group},'update');
  await assert.rejects(a.mediaKey(group,String(update.epoch)),/acknowledged/);
  await a.acknowledge('update');
  await b.command({op:'media_accept',group,wire:update.commit,members:update.members});
  const next=await a.mediaKey(group,String(update.epoch));keys.push(next.key);
  assert.ok(!next.key.equals(first.key));
  await assert.rejects(a.mediaKey(group,epoch),/stale_media_epoch/);
  const protocol=vault.get('protocol:media:alice:call');
  try{assert.ok(!protocol.toString().includes('"baseKey"'));}finally{protocol.fill(0);}
  const exported=vault.exportPermanent(recovery),plain=open(recovery,exported,'backup');
  try{assert.deepEqual(Object.keys(JSON.parse(plain.toString()).records),['message:kept']);}finally{plain.fill(0);}
  // Also dispose of a pending commit's before-snapshot, rather than leaving a
  // second copy of an old media epoch inside a durable outbox.
  await a.command({op:'update',group},'pending-on-hangup');
  const retiredChild=a.child;
  await a.retireMedia();
  const stale=Buffer.from('synthetic stale private output');retiredChild.stdout.emit('data',stale);
  assert.ok(stale.every(value=>value===0),'late output from a retired process is wiped as well');
  assert.equal(vault.get('protocol:media:alice:call'),null);
  assert.equal(vault.get('protocol-expiry:media:alice:call'),null);
  await assert.rejects(a.mediaKey(group,String(update.epoch)),/closed/);
  assert.ok(await messages.command({op:'send',group:'permanent',plaintext:'history preserved'}));
  await assert.rejects(messages.retireMedia(),/Only a media engine/);
  const fresh=new MlsService(binary,vault,'alice','media:alice:call','media');
  try{await assert.rejects(fresh.mediaKey(group,String(update.epoch)),/domain/);}finally{fresh.stop();}
 }finally{for(const key of keys)key.fill(0);a.stop();b.stop();messages.stop();vault.lock();master.fill(0);recovery.fill(0);rmSync(dir,{recursive:true,force:true});}
});

test('media state cannot be restored as messages and old message snapshots remain compatible', {skip:!existsSync(binary)},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'annoy-domain-')),master=randomBytes(32);
 const vault=new EncryptedVault(dir,{available:()=>true,seal:b=>seal(master,b,'os'),open:b=>open(master,b,'os')});vault.unlock();
 const engines=[],create=(id,domain='messages')=>{const engine=new MlsService(binary,vault,'alice',id,domain);engines.push(engine);return engine;};
 const read=id=>{const bytes=vault.get('protocol:'+id);try{return JSON.parse(bytes.toString());}finally{bytes.fill(0);}};
 const write=(id,state)=>{const bytes=Buffer.from(JSON.stringify(state));try{vault.put('protocol:'+id,bytes);}finally{bytes.fill(0);}};
 try{
  assert.throws(()=>create('ordinary','media'),/domain/);assert.throws(()=>create('media:collision'),/domain/);
  const messages=create('ordinary');await messages.command({op:'create',group:'g'});messages.stop();
  const saved=read('ordinary'),oldNative=JSON.parse(Buffer.from(saved.native,'base64').toString());
  delete saved.domain;delete oldNative.domain;delete oldNative.media_group;saved.native=Buffer.from(JSON.stringify(oldNative)).toString('base64');write('ordinary',saved);
  assert.ok(await create('ordinary').command({op:'send',group:'g',plaintext:'legacy snapshot'}));
  const media=create('media:original','media');await media.command({op:'create_media',group:'annoy/media/v1/instance-a/call-a'});media.stop();
  const mediaState=read('media:original');write('wrong-domain',{...mediaState,domain:'messages'});
  await assert.rejects(create('wrong-domain').command({op:'public_key'}),/initialization failed/);
  write('media:wrong',{...read('ordinary'),domain:'media'});
  await assert.rejects(create('media:wrong','media').command({op:'public_key'}),/initialization failed/);
 }finally{for(const engine of engines)engine.stop();vault.lock();master.fill(0);rmSync(dir,{recursive:true,force:true});}
});
