import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EncryptedVault } from './vault.ts';

export interface MlsMember {index:number;identity:string;signature_key:string}
export type MlsCommand =
 | {op:'key_package'|'public_key'} | {op:'create'|'members'|'update'|'info';group:string}
 | {op:'add';group:string;package:string;identity:string;key:string}
 | {op:'replace';group:string;package:string;identity:string;key:string;indices:number[]}
 | {op:'join'|'commit';group:string;wire:string;members:MlsMember[]}
 | {op:'send';group:string;plaintext:string} | {op:'receive';group:string;wire:string}
 | {op:'policy';group:string;history:'since_join'|'share_permanent';owner:string|null}
 | {op:'create_media';group:string} | {op:'join_media';group:string;wire:string;members:MlsMember[]}
 | {op:'media_base_key';group:string;epoch:string}
 | {op:'media_commit';group:string;adds:{package:string;identity:string;key:string}[];removes:number[]}
 | {op:'media_accept';group:string;wire:string;members:MlsMember[]}
 | {op:'remove';group:string;indices:number[]};
type Domain='messages'|'media';
interface State {version:1;domain?:Domain;native:string;revision:number;outbox:Record<string,{command:string;result:unknown;before?:string;revision?:number;cancelled?:boolean}>}
interface Reply {ok:boolean;result?:unknown;snapshot?:string;error?:string}
function expiration(id:string,entry:State['outbox'][string]):number|null {
 try{
  const label=JSON.parse(id);let value=label.expiresAt;
  if(!value&&['send','action','history'].includes(label.type)){
   const payload=JSON.parse(JSON.parse(entry.command).plaintext);value=payload.expiresAt??payload.message?.expiresAt;
  }
  const time=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)?time:null;
 }catch{return null;}
}
function prune(state:State,now:number):boolean {
 let changed=false;for(const [id,entry]of Object.entries(state.outbox)){
  const time=expiration(id,entry);if(time!==null&&time<=now){delete state.outbox[id];changed=true;}
 }return changed;
}
function save(vault:EncryptedVault,id:string,state:State):void {
 prune(state,Date.now());const times=Object.entries(state.outbox).map(([id,e])=>expiration(id,e)).filter((t):t is number=>t!==null);
 const bytes=Buffer.from(JSON.stringify(state)),deadline=Buffer.from(String(Math.min(...times)));
 try{vault.transaction(()=>{vault.put('protocol:'+id,bytes);if(times.length)vault.put('protocol-expiry:'+id,deadline);else vault.delete('protocol-expiry:'+id);});}
 finally{bytes.fill(0);deadline.fill(0);}
}
/** Expire queued plaintext even while offline and before a native process starts. */
export function expireStoredOutboxes(vault:EncryptedVault,now=Date.now()):void {
 for(const key of vault.recordIds('protocol-expiry:')){
  const deadline=vault.get(key);if(!deadline)continue;let time:number;try{time=Number(deadline.toString());}finally{deadline.fill(0);}
  if(time>now)continue;const id=key.slice('protocol-expiry:'.length),bytes=vault.get('protocol:'+id);
  try{if(bytes){const state=JSON.parse(bytes.toString()) as State;if(state.version!==1||!state.outbox)throw new Error('Invalid protocol expiry state');prune(state,now);save(vault,id,state);}else vault.delete(key);}
  finally{bytes?.fill(0);}
 }
}
/** Serializes native state and the delivery outbox in one authenticated vault record. */
export class MlsService {
 private child:ChildProcessWithoutNullStreams|null=null;private closed=false;
 private pending: {resolve:(r:Reply)=>void;reject:(e:Error)=>void}|null=null;
 private output=Buffer.alloc(0);
 private tail:Promise<unknown>=Promise.resolve();
 private state:State|null=null;
 private binary:string;private vault:EncryptedVault;private identity:string;private id:string;private domain:Domain;
 constructor(binary:string,vault:EncryptedVault,identity:string,id:string,domain:Domain='messages'){
  if((domain==='media')!==id.startsWith('media:'))throw new Error('Protocol storage domain mismatch');
  this.binary=binary;this.vault=vault;this.identity=identity;this.id=id;this.domain=domain;
 }
 private exchange(command:unknown):Promise<Reply> {
  if(!this.child || this.pending) return Promise.reject(new Error('Crypto service unavailable'));
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.stop();reject(new Error('Crypto service timed out'));},15000);
   this.pending={resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}};
   const child=this.child!,bytes=Buffer.from(JSON.stringify(command)+'\n');
   child.stdin.write(bytes,error=>{bytes.fill(0);if(error&&this.child===child){this.pending?.reject(new Error('Crypto service stopped'));this.pending=null;}});
  });
 }
 private persist(){save(this.vault,this.id,this.state!);}
 expirePending(now=Date.now()):void {if(this.state&&prune(this.state,now))try{this.persist();}catch(error){this.stop();throw error;}}
 private async start():Promise<void>{
  if(this.closed)throw new Error('Crypto service closed');
  if(this.child) return;
  const saved=this.vault.get('protocol:'+this.id);
  try {this.state=saved?JSON.parse(saved.toString('utf8')) as State:null;}finally{saved?.fill(0);}
  if(this.state && (this.state.version!==1 || typeof this.state.native!=='string' || !this.state.outbox)) throw new Error('Invalid persisted protocol state');
  if(this.state&&(this.state.domain??'messages')!==this.domain)throw new Error('Protocol storage domain mismatch');
  const child=spawn(this.binary,[],{stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;
  this.output=Buffer.alloc(0);
  child.stderr.on('data',()=>{/* Native diagnostics must never enter application logs. */});
  child.on('error',()=>{if(this.child!==child)return;this.pending?.reject(new Error('Crypto service could not start'));this.pending=null;this.child=null;});
  child.on('exit',()=>{if(this.child!==child)return;this.pending?.reject(new Error('Crypto service stopped'));this.pending=null;if(this.child===child)this.child=null;});
  child.stdout.on('data',(chunk:Buffer)=>{
   if(this.child!==child){chunk.fill(0);return;}
   if(this.output.length+chunk.length>96*1024*1024){chunk.fill(0);this.stop();return;}
   const previous=this.output;this.output=Buffer.concat([previous,chunk]);previous.fill(0);chunk.fill(0);
   const end=this.output.indexOf(10);if(end<0)return;
   const frame=this.output;this.output=Buffer.from(frame.subarray(end+1));
   try {const reply=JSON.parse(frame.subarray(0,end).toString()) as Reply;const pending=this.pending;this.pending=null;pending?.resolve(reply);}
   catch {this.stop();}finally{frame.fill(0);}
  });
  const response=await this.exchange(this.state?{op:'restore',snapshot:this.state.native,domain:this.domain}:{op:this.domain==='media'?'init_media':'init',identity:this.identity});
  if(!response.ok || !response.snapshot){this.stop();throw new Error('Crypto service initialization failed');}
  if(((response.result as {domain?:Domain})?.domain??'messages')!==this.domain){this.stop();throw new Error('Native protocol domain mismatch');}
  this.state={version:1,domain:this.domain,native:response.snapshot,revision:this.state?.revision??0,outbox:this.state?.outbox??{}};this.persist();
 }
 command<T=unknown>(command:MlsCommand,deliveryId?:string):Promise<T>{
  const task=this.tail.catch(()=>{}).then(async()=>{
   await this.start();
   if(command.op==='media_base_key'){
    if(this.domain!=='media'||deliveryId!==undefined)throw new Error('Media keys cannot enter the delivery outbox');
    if(Object.values(this.state!.outbox).some(entry=>{
     const pending=JSON.parse(entry.command) as MlsCommand;
     return 'group' in pending&&pending.group===command.group&&['add','replace','update','remove','policy','media_commit'].includes(pending.op);
    }))throw new Error('Media epoch commit must be acknowledged before exporting keys');
   }
   const commandKey=JSON.stringify(command);
   if(deliveryId && this.state!.outbox[deliveryId]){
    if(this.state!.outbox[deliveryId]!.command!==commandKey) throw new Error('Delivery ID reused with different content');
    return this.state!.outbox[deliveryId]!.result as T;
   }
   if(deliveryId && Object.keys(this.state!.outbox).length>=1000)throw new Error('Delivery outbox full');
   const before=this.state!.native;
   const reply=await this.exchange(command);
   if(!reply.ok || !reply.snapshot) throw new Error(reply.error??'Crypto operation rejected');
   this.state!.native=reply.snapshot;
   // Exporting a media key is a use of that epoch. Keep the revision barrier so
   // a later operation cannot roll back a commit after its secret was released.
   if(!['public_key','members','info'].includes(command.op))this.state!.revision++;
   if(deliveryId)this.state!.outbox[deliveryId]={command:commandKey,result:reply.result,...(['add','replace','update','remove','policy','media_commit'].includes(command.op)?{before,revision:this.state!.revision}:{})};
   try{this.persist();}catch{this.stop();throw new Error('Protocol state could not be persisted; sending blocked');}
   return reply.result as T;
  });
  this.tail=task;return task;
 }
 /** Caller owns/wipes the key. It reaches only the SFrame worker's MessagePort,
  * never renderer IPC, an exported backup or the delivery outbox. */
 async mediaKey(group:string,epoch:string):Promise<{key:Buffer;epoch:string;suite:5;senderIndex:number}>{
  const result=await this.command<{version:number;suite:number;epoch:string;senderIndex:number;baseKey:string}>({op:'media_base_key',group,epoch});
  let key:Buffer|undefined;
  try{
   if(result.version!==1||result.suite!==5||result.epoch!==epoch||!Number.isInteger(result.senderIndex)||result.senderIndex<0||result.senderIndex>0xffffffff||typeof result.baseKey!=='string')throw new Error('Invalid native media key result');
   key=Buffer.from(result.baseKey,'base64');
   if(key.length!==32||key.toString('base64')!==result.baseKey)throw new Error('Invalid native media key result');
   return {key,epoch:result.epoch,suite:5,senderIndex:result.senderIndex};
  }catch(error){key?.fill(0);throw error;}finally{result.baseKey='';}
 }
 /** One engine per call. Delete its whole protocol record, including pending
  * snapshots, so another conversation's outbox cannot retain media secrets. */
 retireMedia():Promise<void>{
  const task=this.tail.catch(()=>{}).then(()=>{
   if(this.domain!=='media')throw new Error('Only a media engine can be retired');
   this.stop(true);
   this.vault.transaction(()=>{this.vault.delete('protocol:'+this.id);this.vault.delete('protocol-expiry:'+this.id);});
  });this.tail=task;return task;
 }
 pendingOutbox():Promise<{id:string;command:string;result:unknown;cancelled?:boolean}[]> {
  const task=this.tail.catch(()=>{}).then(async()=>{await this.start();return Object.entries(this.state!.outbox).map(([id,entry])=>({id,...entry}));});this.tail=task;return task;
 }
 cancelDelivery(id:string):Promise<void>{
  const task=this.tail.catch(()=>{}).then(async()=>{await this.start();const entry=this.state!.outbox[id];if(!entry)return;
   if(!entry.cancelled&&JSON.parse(entry.command).op!=='send')throw new Error('Cannot cancel membership changes');
   entry.command='{"op":"cancel"}';entry.cancelled=true;this.persist();
  });this.tail=task;return task;
 }
 acknowledge(id:string):Promise<void>{
  const task=this.tail.catch(()=>{}).then(async()=>{await this.start();delete this.state!.outbox[id];try{this.persist();}catch{this.stop();throw new Error('Delivery acknowledgement could not be persisted');}});this.tail=task;return task;
 }
 /** Rebase only a commit definitively rejected by the delivery service, before
  * any subsequent cryptographic operation. Never roll back a published epoch. */
 rollbackRejectedCommit(id:string):Promise<void>{
  const task=this.tail.catch(()=>{}).then(async()=>{
   await this.start();const entry=this.state!.outbox[id];
   if(!entry?.before||entry.revision!==this.state!.revision)throw new Error('Rebase requires independent recovery; state advanced');
   this.state!.native=entry.before;delete this.state!.outbox[id];this.state!.revision++;
   try{this.persist();}finally{this.stop();}
  });this.tail=task;return task;
 }
 reencryptRejectedApplication(id:string):Promise<void>{
  const task=this.tail.catch(()=>{}).then(async()=>{
   await this.start();const entry=this.state!.outbox[id];if(!entry)throw new Error('Missing pending delivery');
   const command=JSON.parse(entry.command) as MlsCommand;if(command.op!=='send')throw new Error('Expected pending application');
   const reply=await this.exchange(command);if(!reply.ok||!reply.snapshot)throw new Error(reply.error??'Re-encryption rejected');
   this.state!.native=reply.snapshot;this.state!.revision++;entry.result=reply.result;
   try{this.persist();}catch{this.stop();throw new Error('Could not persist rebased message');}
  });this.tail=task;return task;
 }
 stop(permanent=false):void{
  if(permanent)this.closed=true;
  this.pending?.reject(new Error('Crypto service stopped'));this.pending=null;
  const child=this.child;this.child=null;child?.kill();this.output.fill(0);this.output=Buffer.alloc(0);this.state=null;
 }
}
