// Synthetic local benchmark; does not contact any service or retain keys.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {EncryptedVault,seal,open} from '../src/main/crypto/vault.ts';
import {MlsService} from '../src/main/crypto/mls-service.ts';
const directory=mkdtempSync(join(tmpdir(),'annoy-crypto-benchmark-')),key=randomBytes(32);
const vault=new EncryptedVault(directory,{available:()=>true,seal:b=>seal(key,b,'os'),open:b=>open(key,b,'os')});vault.unlock();
const binary=resolve(process.env.ANNOY_CRYPTO_BINARY??'native/annoy-crypto/target/release/annoy-crypto'+(process.platform==='win32'?'.exe':''));
const alice=new MlsService(binary,vault,'alice','alice'),bob=new MlsService(binary,vault,'bob','bob');
try{
 await alice.command({op:'create',group:'benchmark'});await bob.command({op:'create',group:'self'});
 const members=await bob.command({op:'members',group:'self'}),kp=await bob.command({op:'key_package'});
 const added=await alice.command({op:'add',group:'benchmark',package:kp.package,identity:'bob',key:members[0].signature_key});
 await bob.command({op:'join',group:'benchmark',wire:added.welcome,members:await alice.command({op:'members',group:'benchmark'})});
 const samples=[];
 for(let i=0;i<100;i++){
  const start=performance.now(),id='message-'+i;
  const sent=await alice.command({op:'send',group:'benchmark',plaintext:'Synthetic message '+i},id);
  const received=await bob.command({op:'receive',group:'benchmark',wire:sent.wire});
  if(received.plaintext!=='Synthetic message '+i)throw new Error('Benchmark decryption failed');
  await alice.acknowledge(id);samples.push(performance.now()-start);
 }
 samples.sort((a,b)=>a-b);const total=samples.reduce((a,b)=>a+b,0);
 console.log(JSON.stringify({synthetic:true,platform:process.platform,node:process.version,participants:2,messages:100,payload:'small text',includes:'native IPC, authenticated vault persistence, ratchet and decryption',p50Ms:samples[49],p95Ms:samples[94],totalMs:total,messagesPerSecond:100000/total,mainRssBytes:process.memoryUsage().rss,excludes:'network, large groups, large files and native RSS'},null,2));
}finally{alice.stop(true);bob.stop(true);vault.lock();key.fill(0);rmSync(directory,{recursive:true,force:true});}
