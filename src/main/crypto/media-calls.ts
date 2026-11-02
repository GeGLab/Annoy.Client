import {t as translate} from "../../shared/localization/index.ts";
import {randomBytes,createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {MlsService,type MlsMember} from './mls-service.ts';

/** What the call controller needs from the account controller; nothing else of the vault. */
export interface MediaHost {
 account(url:string,token:string):Promise<{instance:string;userId:string;deviceId:string;devicePrivate:string}>;
 /** Trusted, non-revoked devices of a user after the pinned certificate chain was checked. */
 directory(url:string,token:string,userId:string):Promise<{id:string;public_key:string}[]>;
 engine(id:string,identity:string):MlsService;
 /** Deletes engine records of calls this process no longer has open (a crash or a forced exit). */
 purgeMedia(keep:string[]):void;
}
export interface MediaBinding {userId:string;deviceId:string;mediaKey:string;signature:string}
export interface MediaProposals {callId:string;epoch:number;adds:{ref:number;binding:MediaBinding;keyPackage:string}[];removes:{ref:number;binding:MediaBinding}[]}
/** Delivered only to the encoded-transform worker through a dedicated MessagePort. */
export interface MediaKeySink {post(epoch:string,senderIndex:number,key:Buffer):void;close():void}
interface Call {url:string;token:string;channel:string;instance:string;userId:string;deviceId:string;devicePrivate:string;callId:string|null;engine:MlsService|null;engineId:string|null;pending:string|null;pendingEpoch:string|null;sink:MediaKeySink|null;epoch:string|null;roster:Map<string,MediaBinding>;tail:Promise<unknown>}

const CALL_ID=/^[A-Za-z0-9_-]{22,64}$/;
const statement=(c:Pick<Call,'instance'|'channel'>,callId:string,b:Omit<MediaBinding,'signature'>)=>Buffer.from(JSON.stringify(['annoy/media/bind/v1',c.instance,c.channel,callId,b.userId,b.deviceId,b.mediaKey]));
const identityOf=(c:Pick<Call,'instance'>,callId:string,b:Pick<MediaBinding,'userId'|'deviceId'>)=>JSON.stringify([c.instance,b.userId,b.deviceId,callId]);
const group=(c:Pick<Call,'instance'>,callId:string)=>'annoy/media/v1/'+c.instance.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64)+'/'+callId;

/** One MLS group per call. The voice service only orders commits; every leaf is a device
 * whose Ed25519 key signed its call key, checked here against the pinned directory. */
export class MediaCalls {
 private calls=new Map<string,Call>();private purged=false;
 constructor(private readonly host:MediaHost){}
 private call(handle:string):Call{const call=this.calls.get(handle);if(!call)throw new Error(translate("common.400aa6c88ff6"));return call;}
 private serial<T>(call:Call,work:()=>Promise<T>):Promise<T>{const task=call.tail.catch(()=>{}).then(work);call.tail=task;return task;}

 async open(url:string,token:string,channel:string):Promise<string>{
  if(this.calls.size>=4)throw new Error('Muitas chamadas criptografadas abertas');
  const a=await this.host.account(url,token),handle=randomBytes(16).toString('hex');
  // Calls never survive the process: secrets left by a crash are removed before the first new call.
  if(!this.purged){this.host.purgeMedia([...this.calls.values()].map(c=>c.engineId).filter((id):id is string=>!!id));this.purged=true;}
  this.calls.set(handle,{url,token,channel,instance:a.instance,userId:a.userId,deviceId:a.deviceId,devicePrivate:a.devicePrivate,callId:null,engine:null,engineId:null,pending:null,pendingEpoch:null,sink:null,epoch:null,roster:new Map(),tail:Promise.resolve()});
  return handle;
 }
 attach(handle:string,sink:MediaKeySink):void{const call=this.call(handle);call.sink?.close();call.sink=sink;}

 private async engineFor(call:Call,callId:string):Promise<{engine:MlsService;binding:MediaBinding}>{
  if(!CALL_ID.test(callId))throw new Error(translate("common.2ad86e29d4fe"));
  if(call.engine)throw new Error(translate("common.c1b93872c1aa"));
  const id='media:'+randomBytes(16).toString('hex');
  const engine=this.host.engine(id,identityOf(call,callId,{userId:call.userId,deviceId:call.deviceId}));
  const {key}=await engine.command<{key:string}>({op:'public_key'});
  const unsigned={userId:call.userId,deviceId:call.deviceId,mediaKey:key};
  const signature=sign(null,statement(call,callId,unsigned),createPrivateKey({key:Buffer.from(call.devicePrivate,'base64'),format:'der',type:'pkcs8'})).toString('base64url');
  call.engine=engine;call.engineId=id;call.callId=callId;
  return {engine,binding:{...unsigned,signature}};
 }
 /** First device of the call: creates the group at epoch 0. */
 create(handle:string):Promise<{callId:string;binding:MediaBinding}>{const call=this.call(handle);return this.serial(call,async()=>{
  const callId=randomBytes(18).toString('base64url'),{engine,binding}=await this.engineFor(call,callId);
  const result=await engine.command<{epoch:string}>({op:'create_media',group:group(call,callId)});
  call.roster.set(binding.deviceId,binding);await this.publish(call,result.epoch);
  return {callId,binding};
 });}
 /** A later device: publishes a KeyPackage and waits for a Welcome. */
 propose(handle:string,callId:string):Promise<{keyPackage:string;binding:MediaBinding}>{const call=this.call(handle);return this.serial(call,async()=>{
  const {engine,binding}=await this.engineFor(call,callId);
  const {package:keyPackage}=await engine.command<{package:string}>({op:'key_package'});
  return {keyPackage,binding};
 });}

 /** Verifies a device binding with the user's pinned directory; a failure blocks the commit. */
 private async verified(call:Call,callId:string,binding:MediaBinding,cache:Map<string,{id:string;public_key:string}[]>):Promise<MlsMember>{
  if(!binding||typeof binding.userId!=='string'||typeof binding.deviceId!=='string'||typeof binding.mediaKey!=='string'||typeof binding.signature!=='string')throw new Error(translate("common.f8f11955e56e"));
  let devices=cache.get(binding.userId);if(!devices){devices=await this.host.directory(call.url,call.token,binding.userId);cache.set(binding.userId,devices);}
  const device=devices.find(d=>d.id===binding.deviceId);if(!device)throw new Error(translate("common.5b087a39daf6"));
  let valid=false;try{valid=verify(null,statement(call,callId,binding),createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:device.public_key},format:'jwk'}),Buffer.from(binding.signature,'base64url'));}catch{valid=false;}
  if(!valid)throw new Error(translate("common.7f2df5e880ee"));
  return {index:0,identity:identityOf(call,callId,binding),signature_key:binding.mediaKey};
 }
 private async trusted(call:Call,bindings:MediaBinding[]):Promise<MlsMember[]>{
  if(!Array.isArray(bindings)||bindings.length>256)throw new Error(translate("common.9c638524dab9"));
  const cache=new Map<string,{id:string;public_key:string}[]>(),members:MlsMember[]=[];
  for(const binding of bindings){members.push(await this.verified(call,call.callId!,binding,cache));call.roster.set(binding.deviceId,binding);}
  for(const id of [...call.roster.keys()])if(!bindings.some(b=>b.deviceId===id))call.roster.delete(id);
  return members;
 }

 /** Designated committer: one commit for every pending join and leave. */
 commit(handle:string,proposals:MediaProposals):Promise<{epoch:number;commit:string;welcome:string|null;adds:number[];removes:number[];delivery:string}|null>{const call=this.call(handle);return this.serial(call,async()=>{
  const engine=call.engine;if(!engine||call.pending||proposals.callId!==call.callId||String(proposals.epoch)!==call.epoch)return null;
  const cache=new Map<string,{id:string;public_key:string}[]>(),adds:{package:string;identity:string;key:string}[]=[],refs:number[]=[];
  for(const add of proposals.adds.slice(0,256)){
   // A device that fails verification is left out; the others still join.
   try{const member=await this.verified(call,call.callId,add.binding,cache);adds.push({package:add.keyPackage,identity:member.identity,key:member.signature_key});refs.push(add.ref);call.roster.set(add.binding.deviceId,add.binding);}catch{/* Untrusted device: never admitted. */}
  }
  const members=await engine.command<MlsMember[]>({op:'members',group:group(call,call.callId)});
  const removes:number[]=[],removed:number[]=[];
  for(const leave of proposals.removes.slice(0,256)){
   const leaf=members.find(m=>m.identity===identityOf(call,call.callId!,leave.binding));
   if(leaf){removes.push(leaf.index);removed.push(leave.ref);call.roster.delete(leave.binding.deviceId);}
  }
  if(!adds.length&&!removes.length)return null;
  const delivery='media-commit:'+randomBytes(8).toString('hex');
  const result=await engine.command<{commit:string;welcome:string|null;epoch:string}>({op:'media_commit',group:group(call,call.callId),adds,removes},delivery);
  call.pending=delivery;call.pendingEpoch=result.epoch;
  return {epoch:proposals.epoch,commit:result.commit,welcome:result.welcome,adds:refs,removes:removed,delivery};
 });}
 /** The voice service sequenced (or refused) our commit. Only then the epoch is used. */
 settle(handle:string,delivery:string,accepted:boolean):Promise<void>{const call=this.call(handle);return this.serial(call,async()=>{
  const engine=call.engine,epoch=call.pendingEpoch;if(!engine||!epoch||call.pending!==delivery)return;call.pending=null;call.pendingEpoch=null;
  if(!accepted){await engine.rollbackRejectedCommit(delivery);return;}
  await engine.acknowledge(delivery);
  await this.publish(call,epoch);
 });}
 accept(handle:string,event:{callId:string;epoch:number;commit:string;bindings:MediaBinding[]}):Promise<{removed:boolean}>{const call=this.call(handle);return this.serial(call,async()=>{
  const engine=call.engine;if(!engine||event.callId!==call.callId)return {removed:false};
  // Another commit was sequenced first: ours never reaches anyone, roll it back before applying.
  if(call.pending){const pending=call.pending;call.pending=null;call.pendingEpoch=null;await engine.rollbackRejectedCommit(pending);}
  const trusted=await this.trusted(call,event.bindings);
  try{const result=await engine.command<{epoch:string}>({op:'media_accept',group:group(call,call.callId),wire:event.commit,members:trusted});await this.publish(call,result.epoch);return {removed:false};}
  catch(error){if((error as Error).message==='removed_from_call'){await this.retire(call);return {removed:true};}throw error;}
 });}
 welcome(handle:string,event:{callId:string;epoch:number;welcome:string;bindings:MediaBinding[]}):Promise<void>{const call=this.call(handle);return this.serial(call,async()=>{
  const engine=call.engine;if(!engine||event.callId!==call.callId)throw new Error('Convite de outra chamada');
  const trusted=await this.trusted(call,event.bindings);
  if(!trusted.some(m=>m.identity===identityOf(call,call.callId!,{userId:call.userId,deviceId:call.deviceId})))throw new Error('Convite sem este dispositivo');
  const result=await engine.command<{epoch:string}>({op:'join_media',group:group(call,call.callId),wire:event.welcome,members:trusted});
  await this.publish(call,result.epoch);
 });}
 /** Verified participants of the current epoch, for the call interface. */
 roster(handle:string):{userId:string;deviceId:string}[]{return [...this.call(handle).roster.values()].map(b=>({userId:b.userId,deviceId:b.deviceId}));}

 private async publish(call:Call,epoch:string):Promise<void>{
  const engine=call.engine!;
  const key=await engine.mediaKey(group(call,call.callId!),epoch);
  try{call.epoch=epoch;if(!call.sink)throw new Error(translate("common.0a1ed9797eef"));call.sink.post(key.epoch,key.senderIndex,key.key);}finally{key.key.fill(0);}
 }
 private async retire(call:Call):Promise<void>{const engine=call.engine;call.engine=null;call.engineId=null;call.epoch=null;call.pending=null;call.pendingEpoch=null;if(engine)await engine.retireMedia();}
 /** Leaving: the engine record with every snapshot of this call is deleted. */
 close(handle:string):Promise<void>{const call=this.calls.get(handle);if(!call)return Promise.resolve();this.calls.delete(handle);return this.serial(call,async()=>{call.sink?.close();call.sink=null;await this.retire(call);});}
 /** The vault is locking: stop every engine now; their records are purged before the next call. */
 abandon():void{for(const call of this.calls.values()){call.sink?.close();call.engine?.stop(true);}this.calls.clear();this.purged=false;}
}
