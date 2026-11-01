import {parseLegacyMessage} from './legacy-message.ts';
import {writeBackupDirectory,readBackupDirectory} from './backup-directory.ts';
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,sign,verify} from 'node:crypto';
import type {Message,Attachment} from '@distopic/protocol';
import {parsePayload,type AppPayload} from "./payload.ts";
import {deviceProof} from "./dpop.ts";
import {MlsService,expireStoredOutboxes,type MlsMember} from './mls-service.ts';
import {MediaCalls} from './media-calls.ts';
import {seal,open,type EncryptedVault} from './vault.ts';
interface DeviceKeys {id:string;pub:string;private:string;recoveryPub:string;recoveryPrivate:string;mlsKey:string}
interface SecretAttachment extends Attachment {fileKey?:string}
export interface CryptoFile {name:string;type:string;bytes:ArrayBuffer}
interface ProtectedMessage extends Message {expiresAt?:string|null;protection?:'e2ee'|'legacy_plaintext'}
interface DeviceRow {id:string;user_id:string;public_key:string;recovery_key:string;mls_key:string;enrollment_nonce:string;self_signature:string;approved_by:string|null;endorsement:string|null;revoked_at:string|null}
interface Account {url:string;token:string;user:{id:string;displayName:string;username?:string};instance:string;keys:DeviceKeys;engine:MlsService}
interface GroupPolicy {version:1;owner:string;history:'since_join'|'share_permanent'}
interface ChannelState {channel_id:string;group_id:string;epoch:number;state:string;members:string;history_policy:string}
interface Envelope {blob_ids?:string;id:string;sequence:number;device_id:string;kind:'application'|'commit'|'welcome';epoch:number;target_device:string|null;wire:string;signature:string;roster:string|null;created_at:string;expires_at:string|null}
class SecureRequestError extends Error {constructor(readonly code:string,message:string){super(message);}}
interface Trust {root:string;devices:Record<string,{key:string;revoked:boolean}>;verified:boolean}
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('base64url');
const signKey=(key:string,payload:unknown)=>sign(null,Buffer.from(JSON.stringify(payload)),createPrivateKey({key:Buffer.from(key,'base64'),format:'der',type:'pkcs8'})).toString('base64url');
function valid(pub:string,payload:unknown,sig:string):boolean {try{return verify(null,Buffer.from(JSON.stringify(payload)),createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:pub},format:'jwk'}),Buffer.from(sig,'base64url'));}catch{return false;}}
function newKey(){const pair=generateKeyPairSync('ed25519');return {pub:pair.publicKey.export({format:'jwk'}).x!,private:pair.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};}
/** No private material from this controller may be returned through renderer IPC. */
export class CryptoController {
 private vault:EncryptedVault;private binary:string;private fetcher:typeof fetch;
 private nonces=new Map<string,{value:string;at:number}>();
 private expectedAccounts=new Map<string,{url:string;userId:string}>();
 expect(url:string,token:string,userId:string):void {
  const origin=new URL(url).origin;if(!userId||userId.length>100||!token||token.length>4096)throw new Error('Identidade esperada inválida');
  const id=hash(origin+'\0'+token),prior=this.expectedAccounts.get(id);if(prior&&(prior.url!==origin||prior.userId!==userId))throw new Error('Identidade da sessão mudou');
  if(!prior&&this.expectedAccounts.size>=256)throw new Error('Limite de contas criptográficas em memória');this.expectedAccounts.set(id,{url:origin,userId});
 }
 private sessionBinding(url:string,token:string):{id:string;url:string;deviceId:string}|null {
  const current=this.read<{id:string;url:string;deviceId:string}>('session:'+hash(url+'\0'+token));if(current)return current;
  const legacy=this.read<{id:string;url:string;deviceId:string}>('session:'+hash(token));return legacy?.url===url?legacy:null;
 }
 /** End-to-end encrypted calls. Device keys stay here; only call bindings and SFrame base keys leave. */
 readonly media=new MediaCalls({
  account:async(url,token)=>{const a=await this.serial(url,()=>this.account(url,token));return {instance:a.instance,userId:a.user.id,deviceId:a.keys.id,devicePrivate:a.keys.private};},
  directory:(url,token,userId)=>this.serial(url,async()=>{const a=await this.account(url,token);return (await this.directory(a,userId)).map(row=>({id:row.id,public_key:row.public_key}));}),
  engine:(id,identity)=>new MlsService(this.binary,this.vault,identity,id,'media'),
  purgeMedia:keep=>{for(const key of this.vault.recordIds('protocol:media:')){const id=key.slice('protocol:'.length);if(!keep.includes(id))this.vault.transaction(()=>{this.vault.delete(key);this.vault.delete('protocol-expiry:'+id);});}},
 });
 private restoring=false;private epoch=0;private abort=new AbortController();
 private accounts=new Map<string,Account>();private queues=new Map<string,Promise<unknown>>();
 constructor(vault:EncryptedVault,binary:string,fetcher:typeof fetch=fetch){this.vault=vault;this.binary=binary;this.fetcher=fetcher;}
 expireLocal(now=Date.now()):void {
  this.vault.expire(now);for(const account of this.accounts.values())account.engine.expirePending(now);expireStoredOutboxes(this.vault,now);
 }
 private read<T>(id:string):T|null {const bytes=this.vault.get(id);try{return bytes?JSON.parse(bytes.toString('utf8')) as T:null;}finally{bytes?.fill(0);}}
 private write(id:string,value:unknown,backup=false){const bytes=Buffer.from(JSON.stringify(value)),previous=this.vault.get(id);try{if(previous?.equals(bytes))return;this.vault.put(id,bytes,{backup});}finally{bytes.fill(0);previous?.fill(0);}}

 private async authenticatedFetch(url:string,token:string,path:string,init:RequestInit={}):Promise<Response>{
  const method=init.method??'GET';
  const execute=async(nonce?:string)=>{
   const headers=new Headers(init.headers),proof=await this.proof(url,token,method,path,nonce);
   headers.set('authorization',(proof?'DPoP ':'Bearer ')+token);if(proof)headers.set('dpop',proof);
   return this.fetcher(new URL(path,url).toString(),{...init,headers,redirect:'error',signal:init.signal??AbortSignal.any([this.abort.signal,AbortSignal.timeout(15000)])});
  };
  let response=await execute();const nonce=response.headers.get('dpop-nonce');
  if(response.status===401 && nonce && this.nonces.get(url)?.value!==nonce){await response.body?.cancel();response=await execute(nonce);}
  return response;
 }
 private async jsonResponse(response:Response):Promise<unknown>{
  if(Number(response.headers.get('content-length')??0)>16*1024*1024){await response.body?.cancel();throw new Error('Resposta excede o limite criptográfico');}
  if(!response.body)throw new Error('Resposta vazia');const chunks:Uint8Array[]=[];let size=0;
  for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>16*1024*1024)throw new Error('Resposta excede o limite criptográfico');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);try{return JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);for(const chunk of chunks)chunk.fill(0);}
 }
 private async request<T>(url:string,token:string,path:string,body?:unknown,method?:string,signal?:AbortSignal):Promise<T>{
  const response=await this.authenticatedFetch(url,token,'/api'+path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:signal?AbortSignal.any([this.abort.signal,signal,AbortSignal.timeout(60000)]):undefined});
  const result=await this.jsonResponse(response);if(!response.ok)throw new SecureRequestError((result as {error?:string}).error??'request_failed',(result as {message?:string}).message??'Secure API rejected request');return result as T;
 }
 private async account(raw:string,token:string):Promise<Account>{
  if(this.restoring)throw new Error('Restauração do cofre em andamento');
  const generation=this.epoch;
  const url=new URL(raw);if(url.username || url.password || (url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new Error('E2EE exige HTTPS fora do loopback');
  this.vault.unlock();
  const [user,info]=await Promise.all([this.request<{id:string;displayName:string}>(url.origin,token,'/users/@me'),this.request<{crypto?:{instanceId:string;version:number;protocol:string}}>(url.origin,token,'/info')]);
  if(generation!==this.epoch)throw new Error('Operação cancelada');
  if(!user.id || info.crypto?.version!==1 || info.crypto.protocol!=='MLS-RFC9420')throw new Error('Servidor sem suporte MLS validável; envio seguro bloqueado');
  const instance=info.crypto.instanceId,id=hash(url.origin+'\0'+user.id);
  const expected=this.expectedAccounts.get(hash(url.origin+'\0'+token)),binding=this.sessionBinding(url.origin,token);
  if((!expected&&!binding)||(expected&&expected.userId!==user.id)||(binding&&binding.id!==id))throw new Error('Identidade da conta retornada pelo servidor diverge da sessão autorizada');
  const pinned=this.read<{instance:string}>('instance:'+id);if(pinned && pinned.instance!==instance)throw new Error('Identidade da instância mudou; confirme antes de continuar');
  this.write('instance:'+id,{instance},true);
  const existing=this.accounts.get(id);if(existing){existing.token=token;await this.bindSession(existing);return existing;}
  let keys=this.read<DeviceKeys>('device:'+id);
  if(!keys){const device=newKey(),recovery=this.read<{pub:string;private:string}>('recovery:'+id)??newKey();keys={id:hash(Buffer.from(device.pub,'base64url')),pub:device.pub,private:device.private,recoveryPub:recovery.pub,recoveryPrivate:recovery.private,mlsKey:''};this.write('device:'+id,keys);this.write('recovery:'+id,{pub:recovery.pub,private:recovery.private},true);}
  const rows=await this.request<DeviceRow[]>(url.origin,token,'/crypto/users/'+encodeURIComponent(user.id)+'/devices');
  const restored=this.read('restore-authorization:'+id),root=this.read<{pub:string;private:string}>('recovery:'+id);
  if(restored&&rows.some(row=>row.id===keys!.id&&row.revoked_at)){
   this.vault.delete('restore-authorization:'+id);this.vault.delete('protocol:'+id);this.vault.delete('device:'+id);return this.account(raw,token);
  }
  if(root&&root.pub!==keys.recoveryPub){
   if(rows.some(row=>row.id===keys!.id))throw new Error('Backup pertence a outra raiz criptográfica; dispositivo registrado preservado');
   keys.recoveryPub=root.pub;keys.recoveryPrivate=root.private;this.write('device:'+id,keys);
  }
  const identity=JSON.stringify([instance,user.id,keys.id]);
  const engine=new MlsService(this.binary,this.vault,identity,id);
  const publicMls=await engine.command<{key:string}>({op:'public_key'}),mlsKey=Buffer.from(publicMls.key,'base64').toString('base64url');
  if(keys.mlsKey && keys.mlsKey!==mlsKey){engine.stop();if(restored){this.vault.delete('restore-authorization:'+id);this.vault.delete('protocol:'+id);this.vault.delete('device:'+id);return this.account(raw,token);}throw new Error('Estado criptográfico do dispositivo foi perdido; restaure o backup como novo dispositivo');}
  keys.mlsKey=mlsKey;this.write('device:'+id,keys);
  if(!rows.some(d=>d.id===keys!.id && !d.revoked_at)){
   if(rows.length && rows.some(row=>row.recovery_key!==keys!.recoveryPub)){engine.stop();throw new Error('Novo dispositivo exige aprovação de dispositivo existente ou restauração do backup de recuperação');}
   const challenge=await this.request<{nonce:string;instanceId:string}>(url.origin,token,'/crypto/devices/challenge',{purpose:'enroll'});
   const payload=['annoy/device/enroll/v1',instance,user.id,keys.id,keys.pub,keys.recoveryPub,keys.mlsKey,challenge.nonce];
   await this.request(url.origin,token,'/crypto/devices',{nonce:challenge.nonce,publicKey:keys.pub,recoveryKey:keys.recoveryPub,mlsKey:keys.mlsKey,signature:signKey(keys.private,payload),...(rows.length?{endorsement:signKey(keys.recoveryPrivate,payload)}:{})});
  }
  if(generation!==this.epoch){engine.stop();throw new Error('Operação cancelada');}
  const account={url:url.origin,token,user,instance,keys,engine};await this.bindSession(account);this.accounts.set(id,account);return account;
 }

 private async bindSession(a:Account):Promise<void>{
  const bindingId='session:'+hash(a.url+'\0'+a.token);if(this.sessionBinding(a.url,a.token))return;
  const id=hash(a.url+'\0'+a.user.id);
  const info=await this.fetcher(a.url+'/api/info',{signal:AbortSignal.timeout(10000),redirect:'error'}).then(r=>this.jsonResponse(r)) as {crypto:{dpopNonce:string}};
  const proof=await deviceProof(a.keys.pub,a.keys.private,a.token,'POST',a.url+'/api/auth/device-bind',info.crypto.dpopNonce);
  await this.request(a.url,a.token,'/auth/device-bind',{deviceId:a.keys.id,proof});
  const bytes=Buffer.from(JSON.stringify({id,url:a.url,deviceId:a.keys.id}));
  try{this.vault.put(bindingId,bytes,{expiresAt:Date.now()+24*3600000});}finally{bytes.fill(0);}
 }
 private async directory(a:Account,userId:string):Promise<DeviceRow[]>{
  const rows=await this.request<DeviceRow[]>(a.url,a.token,'/crypto/users/'+encodeURIComponent(userId)+'/devices');
  if(!rows.length)throw new Error('Participante ainda não configurou dispositivo seguro');
  const id='trust:'+a.instance+':'+userId;
  const trust=this.read<Trust>(id)??{root:rows[0]!.recovery_key,devices:{},verified:false};
  const candidates=[...rows];let progress=true;
  while(candidates.length && progress){progress=false;
   for(let i=candidates.length-1;i>=0;i--){const row=candidates[i]!;
    if(row.recovery_key!==trust.root || hash(Buffer.from(row.public_key,'base64url'))!==row.id)throw new Error('Chave pública substituída; envio bloqueado');
    const payload=['annoy/device/enroll/v1',a.instance,userId,row.id,row.public_key,row.recovery_key,row.mls_key,row.enrollment_nonce];
    if(!valid(row.public_key,payload,row.self_signature))throw new Error('Prova de dispositivo inválida');
    const pinned=trust.devices[row.id];
    if(pinned && (pinned.key!==row.public_key || (pinned.revoked && !row.revoked_at)))throw new Error('Tentativa de restaurar dispositivo revogado');
    let approved=!!pinned;
    if(!approved && Object.keys(trust.devices).length===0 && row===rows[0] && !row.endorsement)approved=true;
    if(!approved && row.endorsement){const approver=row.approved_by?trust.devices[row.approved_by]:null;approved=valid(approver?.key??trust.root,payload,row.endorsement);}
    if(!approved)continue;
    trust.devices[row.id]={key:row.public_key,revoked:!!row.revoked_at};candidates.splice(i,1);progress=true;
   }
  }
  if(candidates.length)throw new Error('Dispositivo sem cadeia de aprovação confiável');
  this.write(id,trust,true);return rows.filter(d=>!d.revoked_at);
 }
 private async members(a:Account,channel:string,ids:string[],ownerCommit=false,historical=false):Promise<{rows:DeviceRow[];mls:MlsMember[]}>{
  const rows:DeviceRow[]=[];
  // Fetch each peer directory from its public device record.
  const peers=await this.request<DeviceRow[]>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/devices');
  // An already-delivered commit can describe a member removed since delivery.
  // Resolve its public certificate for validation only; never use this path to
  // select recipients for a new commit or application message.
  if(historical)for(const id of ids)if(!peers.some(peer=>peer.id===id)){
   const row=await this.request<DeviceRow>(a.url,a.token,'/crypto/devices/'+encodeURIComponent(id));
   if(row.id!==id)throw new Error('Certificado histórico substituído');peers.push(row);
  }
  for(const user of new Set(peers.map(p=>p.user_id)))rows.push(...await this.directory(a,user));
  const selected=ids.map(id=>{const row=rows.find(d=>d.id===id);if(!row)throw new Error('Dispositivo ausente ou revogado');return row;});
  if(!ownerCommit){const authorization=this.read<{users:string[]}>('authorization:'+a.instance+':'+a.user.id+':'+channel);if(!authorization||selected.some(row=>!authorization.users.includes(row.user_id)))throw new Error('Participante não autorizado pelo usuário');}
  return {rows:selected,mls:selected.map((r,index)=>({index,identity:JSON.stringify([a.instance,r.user_id,r.id]),signature_key:Buffer.from(r.mls_key,'base64url').toString('base64')}))};
 }
 private pinGroup(a:Account,channel:string,state:ChannelState,authenticated=false):void {
  const key='active:'+a.instance+':'+channel,pin=this.read<{active:boolean;groupId?:string}>(key);
  if(pin?.groupId&&pin.groupId!==state.group_id)throw new Error('Identificador do grupo MLS substituído; comunicação bloqueada');
  this.write(key,{active:true,...(authenticated?{groupId:state.group_id}:pin?.groupId?{groupId:pin.groupId}:{})},true);
 }
 private async envelope(a:Account,channel:string,state:ChannelState,kind:Envelope['kind'],wire:string,epoch:number,members?:string[],target:string|null=null,id:string=randomUUID(),blobIds:string[]=[],expiresAt:string|null=null,signal?:AbortSignal):Promise<void>{
  const body={version:1,id,deviceId:a.keys.id,kind,epoch,targetDevice:target,wire,expiresAt,members,blobIds};
  const payload=['annoy/mls/envelope/v1',a.instance,channel,state.group_id,id,a.keys.id,kind,epoch,target,expiresAt,members??null,blobIds,hash(wire)];
  await this.request(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/envelopes',{...body,signature:signKey(a.keys.private,payload)},undefined,signal);
 }

 private serial<T>(key:string,work:()=>Promise<T>):Promise<T>{const generation=this.epoch;const task=(this.queues.get(key)??Promise.resolve()).catch(()=>{}).then(()=>{if(generation!==this.epoch)throw new Error('Operação cancelada');return work();});this.queues.set(key,task);return task;}
 private historyKey(a:Account,channel:string){return 'messages:'+a.instance+':'+a.user.id+':'+channel;}
 private cursorKey(a:Account,channel:string){return 'cursor:'+a.instance+':'+a.user.id+':'+channel;}

 private history(a:Account,channel:string,before?:string,limit=50):Message[]{
  const key=this.historyKey(a,channel),index=(this.read<string[]>(key)??[]).filter(id=>this.vault.has(key+':entry:'+id)&&!this.vault.has('tombstone:'+key+':entry:'+id));
  const end=before?index.indexOf(before):index.length;
  return index.slice(Math.max(0,end-limit),Math.max(0,end)).map(id=>this.read<ProtectedMessage>(key+':entry:'+id)).filter((m):m is ProtectedMessage=>!!m).map(m=>this.publicMessage(m));
 }
 private publicMessage(message:ProtectedMessage):Message {
  return {...message,attachments:message.attachments.map(attachment=>{const {fileKey,...publicFields}=attachment as SecretAttachment;return publicFields;})};
 }
 private storeMessage(a:Account,channel:string,message:ProtectedMessage):void {
  const key=this.historyKey(a,channel),index=this.read<string[]>(key)??[];
  if(message.expiresAt && Date.parse(message.expiresAt)<=Date.now())return;
  const bytes=Buffer.from(JSON.stringify({...message,protection:'e2ee'}));
  try{this.vault.put(key+':entry:'+message.id,bytes,{backup:!message.expiresAt,expiresAt:message.expiresAt?Date.parse(message.expiresAt):undefined});}finally{bytes.fill(0);}
  if(!index.includes(message.id)){index.push(message.id);this.write(key,index,true);}
 }

 private async applyPayload(a:Account,channel:string,payload:AppPayload,sender:string,id:string,expiresAt:string|null):Promise<void> {
  const who=JSON.parse(sender) as string[];
  if(who[0]!==a.instance)throw new Error('Identidade de outra instância');
  if(payload.kind==='message'){
   if(payload.message.author.id!==who[1]||payload.message.channelId!==channel||payload.message.id!==id||(payload.message.expiresAt??null)!==expiresAt)throw new Error('Identidade da mensagem inválida');
   if(!this.read('tombstone:'+this.historyKey(a,channel)+':entry:'+id))this.storeMessage(a,channel,payload.message);
   return;
  }
  if(payload.id!==id||payload.authorId!==who[1]||payload.expiresAt!==expiresAt)throw new Error('Evento de mensagem inválido');
  if(payload.kind==='history'){
   const state=(await this.request<{channel:ChannelState}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
   const {policy}=await a.engine.command<{policy:GroupPolicy}>({op:'info',group:state.group_id});
   if(policy.history!=='share_permanent'||policy.owner!==who[0]+':'+who[1])throw new Error('Histórico não autorizado pela política MLS');
   for(const message of payload.messages){if(message.channelId!==channel||message.expiresAt)throw new Error('Histórico compartilhado inválido');if(!this.read('tombstone:'+this.historyKey(a,channel)+':entry:'+message.id)&&!this.read(this.historyKey(a,channel)+':entry:'+message.id))this.storeMessage(a,channel,{...message,sharedBy:who[1]} as ProtectedMessage);}
   return;
  }
  const key=this.historyKey(a,channel)+':entry:'+payload.targetId;
  const message=this.read<ProtectedMessage>(key);if(!message)return;
  if(payload.kind==='reaction'){
   const parts=[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(payload.emoji)];if(parts.length!==1||!/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(payload.emoji))throw new Error('Reação inválida');
   const reactions=message.reactions??[];let existing=reactions.find(r=>r.emoji===payload.emoji);
   if(payload.add){if(!existing){if(reactions.length>=20)return;existing={emoji:payload.emoji,userIds:[]};reactions.push(existing);}if(!existing.userIds.includes(payload.authorId))existing.userIds.push(payload.authorId);}
   else if(existing)existing.userIds=existing.userIds.filter(id=>id!==payload.authorId);
   message.reactions=reactions.filter(r=>r.userIds.length);this.storeMessage(a,channel,message);return;
  }
  if(message.author.id!==payload.authorId)throw new Error('Somente autor pode editar ou excluir criptograficamente a mensagem');
  if(payload.kind==='edit'){message.content=payload.content;message.editedAt=payload.at;this.storeMessage(a,channel,message);}
  else {this.write('tombstone:'+key,{id:payload.targetId,at:payload.at},true);this.vault.delete(key);}
 }
 private async postPending(a:Account,channel:string,options:{skipApplications?:boolean;rebase?:boolean;signal?:AbortSignal}={}):Promise<void>{
  const state=(await this.request<{channel:ChannelState|null}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
  if(!state)return;this.pinGroup(a,channel,state);
  for(const item of await a.engine.pendingOutbox()){
   let label:{type:string;channel:string;id:string;welcomeId?:string;target?:string;sequence?:number;expiresAt?:string|null;message?:Message};
   try{label=JSON.parse(item.id);}catch{continue;}
   if(label.channel!==channel)continue;
   const result=item.result as {wire?:string;commit?:string;welcome?:string;epoch?:number;members?:MlsMember[];plaintext?:string;sender?:string};
   if(item.cancelled){
    const payload=['annoy/mls/cancel/v1',a.instance,channel,state.group_id,label.id,a.keys.id];
    const result=await this.request<{delivered:boolean}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/cancel',{id:label.id,deviceId:a.keys.id,signature:signKey(a.keys.private,payload)});
    const bytes=Buffer.from(JSON.stringify(result));try{this.vault.put('cancel-result:'+a.instance+':'+label.id,bytes,{expiresAt:Date.now()+86400000});}finally{bytes.fill(0);}
    await a.engine.acknowledge(item.id);continue;
   }
   if(options.skipApplications&&['send','action','history'].includes(label.type))continue;
   try{
   if(label.type==='send'){
    const command=JSON.parse(item.command) as {plaintext:string};const payload=JSON.parse(command.plaintext) as {message:ProtectedMessage};
    if(payload.message.expiresAt && Date.parse(payload.message.expiresAt)<=Date.now()){await a.engine.acknowledge(item.id);continue;}
    await this.envelope(a,channel,state,'application',result.wire!,result.epoch!,undefined,null,label.id,payload.message.attachments.map(f=>f.id),payload.message.expiresAt??null,options.signal);
    this.storeMessage(a,channel,payload.message);
   }else if(label.type==='action'||label.type==='history'){
    const payload=parsePayload((JSON.parse(item.command) as {plaintext:string}).plaintext);
    const expires=payload.kind==='message'?payload.message.expiresAt??null:payload.expiresAt;
    if(!expires||Date.parse(expires)>Date.now()){
     await this.envelope(a,channel,state,'application',result.wire!,result.epoch!,undefined,null,label.id,[],expires);
     await this.applyPayload(a,channel,payload,JSON.stringify([a.instance,a.user.id,a.keys.id]),label.id,expires);
    }
   }else if(label.type==='add'||label.type==='replace'||label.type==='update'||label.type==='remove'||label.type==='policy'){
    const ids=result.members!.map(m=>JSON.parse(m.identity)[2] as string);
    await this.envelope(a,channel,state,'commit',result.commit!,result.epoch!,ids,null,label.id);
    if(result.welcome)await this.envelope(a,channel,state,'welcome',result.welcome,result.epoch!,ids,label.target!,label.welcomeId!);
   }else if(label.type==='receive'){
    try{await this.applyPayload(a,channel,parsePayload(result.plaintext!),result.sender!,label.id,label.expiresAt??null);}
    catch{this.write('security-event:'+a.instance+':'+label.id,{code:'invalid_payload',at:new Date().toISOString()});}
    this.write(this.cursorKey(a,channel),{sequence:label.sequence});
   }else if(label.type==='accepted'||label.type==='joined'){
    this.pinGroup(a,channel,state,true);
    this.write(this.cursorKey(a,channel),{sequence:label.sequence});
    const info=await a.engine.command<{members:MlsMember[]}>({op:'info',group:state.group_id});
    const users=[...new Set(info.members.map(m=>JSON.parse(m.identity)[1] as string))];
    this.write('authorization:'+a.instance+':'+a.user.id+':'+channel,{users},true);
   }
   await a.engine.acknowledge(item.id);
   }catch(error){
    if(error instanceof SecureRequestError&&error.code==='epoch_conflict'&&['add','replace','update','remove','policy'].includes(label.type)){
     await a.engine.rollbackRejectedCommit(item.id);throw new Error('Renovação concorrente: estado recuperado, tente novamente');
    }
    if(error instanceof SecureRequestError&&error.code==='rekey_required'&&['send','action','history'].includes(label.type)&&options.rebase!==false){
     await this.syncAccount(a,channel,undefined,true);
     await a.engine.reencryptRejectedApplication(item.id);return this.postPending(a,channel,{rebase:false,signal:options.signal});
    }
    throw error;
   }
  }
 }
 private async provision(a:Account):Promise<void>{
  const count=this.read<{at:number}>('packages:'+a.instance+':'+a.keys.id);
  if(count && Date.now()-count.at<3600000)return;
  const {available}=await this.request<{available:number}>(a.url,a.token,'/crypto/key-packages/count?deviceId='+a.keys.id);
  for(let i=available;i<10;i++){
   const pack=await a.engine.command<{package:string}>({op:'key_package'});
   const challenge=await this.request<{nonce:string}>(a.url,a.token,'/crypto/devices/challenge',{purpose:'package'});
   const payload=['annoy/key-package/v1',a.instance,a.user.id,a.keys.id,hash(pack.package),challenge.nonce];
   await this.request(a.url,a.token,'/crypto/key-packages',{nonce:challenge.nonce,deviceId:a.keys.id,package:pack.package,signature:signKey(a.keys.private,payload)});
  }
  this.write('packages:'+a.instance+':'+a.keys.id,{at:Date.now()});
 }
 private async ensureGroup(a:Account,channel:string):Promise<ChannelState>{
  let state=(await this.request<{channel:ChannelState|null}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
  if(!state){
   const creationKey='creation:'+a.instance+':'+a.user.id+':'+channel;
   let creation=this.read<{group:string}>(creationKey);
   if(!creation){creation={group:randomBytes(32).toString('base64url')};await a.engine.command({op:'create',group:creation.group});this.write(creationKey,creation);}
   const payload=['annoy/mls/activate/v1',a.instance,channel,creation.group,a.keys.id,[a.keys.id]];
   state=await this.request<ChannelState>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/activate',{version:1,groupId:creation.group,deviceId:a.keys.id,members:[a.keys.id],signature:signKey(a.keys.private,payload)});
  }
  this.pinGroup(a,channel,state,this.read<{group:string}>('creation:'+a.instance+':'+a.user.id+':'+channel)?.group===state.group_id);
  await this.postPending(a,channel);
  return state;
 }
 private async syncAccount(a:Account,channel:string,before?:string,skipApplications=false):Promise<Message[]>{
  await this.postPending(a,channel,{skipApplications});
  const state=(await this.request<{channel:ChannelState|null}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
  if(!state)return [];this.pinGroup(a,channel,state);
  if(!this.read('authorization:'+a.instance+':'+a.user.id+':'+channel))throw new Error('Revise e autorize os participantes criptográficos desta conversa');
  let cursor=this.read<{sequence:number}>(this.cursorKey(a,channel))?.sequence??0;
  let local=false;try{await a.engine.command({op:'info',group:state.group_id});local=true;}catch{}
  for(let page=0;page<100;page++){
   const delivery=await this.request<{items:Envelope[];hasMore?:boolean}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/envelopes?deviceId='+a.keys.id+'&after='+cursor);
   if(!delivery.items.length)break;
   for(const env of delivery.items){
    if(env.device_id===a.keys.id){cursor=env.sequence;this.write(this.cursorKey(a,channel),{sequence:cursor});continue;}
    if(!local && env.kind!=='welcome')continue;
    let devices:{rows:DeviceRow[];mls:MlsMember[]};
    if(env.kind==='application'){
     const info=await a.engine.command<{members:MlsMember[]}>({op:'info',group:state.group_id});
     const member=info.members.find(m=>JSON.parse(m.identity)[2]===env.device_id);if(!member)throw new Error('Remetente fora do grupo MLS');
     const userId=JSON.parse(member.identity)[1] as string,rows=await this.directory(a,userId);
     const row=rows.find(r=>r.id===env.device_id);
     if(!row&&this.read<Trust>('trust:'+a.instance+':'+userId)?.devices[env.device_id]?.revoked){cursor=env.sequence;this.write(this.cursorKey(a,channel),{sequence:cursor});continue;}
     if(!row||Buffer.from(row.mls_key,'base64url').toString('base64')!==member.signature_key)throw new Error('Chave do remetente substituída');
     devices={rows:[row],mls:[]};
    }else{
     const roster=env.roster?JSON.parse(env.roster) as string[]:JSON.parse(state.members) as string[];
     devices=await this.members(a,channel,roster,env.kind==='commit',true);
    }
    const sender=devices.rows.find(r=>r.id===env.device_id);
    if(!sender)throw new Error('Remetente não autorizado');
    const metadata=['annoy/mls/envelope/v1',a.instance,channel,state.group_id,env.id,env.device_id,env.kind,env.epoch,env.target_device,env.expires_at,env.roster?JSON.parse(env.roster):null,JSON.parse(env.blob_ids??"[]"),hash(env.wire)];
    if(!valid(sender.public_key,metadata,env.signature))throw new Error('Envelope adulterado');
    const label=JSON.stringify({type:env.kind==='welcome'?'joined':env.kind==='commit'?'accepted':'receive',channel,id:env.id,sequence:env.sequence,expiresAt:env.expires_at});
    if(env.kind==='welcome'){
     if(!local){await a.engine.command({op:'join',group:state.group_id,wire:env.wire,members:devices.mls},label);local=true;}
     else {cursor=env.sequence;this.write(this.cursorKey(a,channel),{sequence:cursor});continue;}
    }else if(env.kind==='commit')await a.engine.command({op:'commit',group:state.group_id,wire:env.wire,members:devices.mls},label);
    else await a.engine.command({op:'receive',group:state.group_id,wire:env.wire},label);
    await this.postPending(a,channel,{skipApplications});cursor=env.sequence;
   }
   if(!(delivery.hasMore??delivery.items.length>=100))break;
  }
  return this.history(a,channel,before);
 }


 async proof(url:string,token:string,method:string,path:string,overrideNonce?:string):Promise<string|null>{
  // Absence of a saved binding is a bootstrap session, never a downgrade of a known binding.
  if(!this.vault.exists())return null;
  this.vault.unlock();const binding=this.sessionBinding(new URL(url).origin,token);if(!binding)return null;
  const target=new URL(path,url),origin=new URL(url).origin;
  if(binding.url!==origin || target.origin!==origin || !['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method.toUpperCase()) || (!target.pathname.startsWith('/api/') && target.pathname!=='/gateway'))throw new Error('Pedido DPoP fora da sessão autorizada');
  const keys=this.read<DeviceKeys>('device:'+binding.id);if(!keys||keys.id!==binding.deviceId)throw new Error('Chave do dispositivo indisponível');
  if(overrideNonce){if(!/^[A-Za-z0-9_-]{43}$/.test(overrideNonce))throw new Error("Desafio DPoP inválido");this.nonces.set(origin,{value:overrideNonce,at:Date.now()});}
  let nonce=this.nonces.get(origin);
  if(!nonce || Date.now()-nonce.at>15000 || target.pathname==='/gateway'){
   const response=await this.fetcher(origin+'/api/info',{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000)]),redirect:'error'});
   if(!response.ok)throw new Error('Não foi possível obter desafio DPoP');const info=await this.jsonResponse(response) as {crypto?:{dpopNonce?:string}};
   if(!info.crypto?.dpopNonce)throw new Error('Servidor tentou remover proteção DPoP');
   nonce={value:info.crypto.dpopNonce,at:Date.now()};this.nonces.set(origin,nonce);
  }
  return deviceProof(keys.pub,keys.private,token,method,target.toString(),nonce.value);
 }

 guardChannel(url:string,userId:string,channel:string):boolean {
  if(!this.vault.exists())return false;this.vault.unlock();const id=hash(new URL(url).origin+'\0'+userId);
  const instance=this.read<{instance:string}>('instance:'+id);return !!instance && !!this.read<{active:boolean}>('active:'+instance.instance+':'+channel)?.active;
 }
 async membershipReview(url:string,token:string,channel:string):Promise<{userId:string;code:string}[]>{return this.serial(url,async()=>{
  const a=await this.account(url,token),devices=await this.request<DeviceRow[]>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/devices');
  const result:{userId:string;code:string}[]=[];
  for(const userId of new Set(devices.map(d=>d.user_id))){await this.directory(a,userId);const trust=this.read<Trust>('trust:'+a.instance+':'+userId)!;result.push({userId,code:hash(JSON.stringify(['annoy/safety/v1',a.instance,userId,trust.root]))});}
  return result;
 });}
 async authorizeMembers(url:string,token:string,channel:string,review:{userId:string;code:string}[]):Promise<void>{return this.serial(url,async()=>{
  const a=await this.account(url,token),devices=await this.request<DeviceRow[]>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/devices');
  const users=[...new Set(devices.map(d=>d.user_id))];
  if(!users.includes(a.user.id)||users.length!==review.length)throw new Error('Lista de participantes mudou; revise novamente');
  for(const id of users){await this.directory(a,id);const trust=this.read<Trust>('trust:'+a.instance+':'+id)!;if(!review.some(r=>r.userId===id && r.code===hash(JSON.stringify(['annoy/safety/v1',a.instance,id,trust.root]))))throw new Error('Chave de participante mudou');}
  this.write('authorization:'+a.instance+':'+a.user.id+':'+channel,{users},true);
 });}
 async status(url:string,token:string,channel:string){return this.serial(url,async()=>{
  const a=await this.account(url,token);await this.postPending(a,channel);await this.provision(a);
  const state=await this.request<{channel:ChannelState|null}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto');
  const pinned=this.read<{active:boolean}>('active:'+a.instance+':'+channel);
  if(pinned?.active && !state.channel)throw new Error('Tentativa de downgrade: E2EE anteriormente ativo');
  if(state.channel)this.pinGroup(a,channel,state.channel);
  return {active:!!state.channel,deviceId:a.keys.id,instanceId:a.instance};
 });}
 async sync(url:string,token:string,channel:string,before?:string):Promise<Message[]>{return this.serial(url,async()=>{const a=await this.account(url,token);return this.syncAccount(a,channel,before);});}

 async reconcile(url:string,token:string,channel:string,knownIds:string[]):Promise<{items:Message[];deletedIds:string[];newIds:string[]}>{return this.serial(url,async()=>{
  const a=await this.account(url,token),key=this.historyKey(a,channel),before=new Set(this.read<string[]>(key)??[]);
  const items=await this.syncAccount(a,channel);
  const deletedIds=knownIds.filter(id=>!this.vault.has(key+':entry:'+id)||this.vault.has('tombstone:'+key+':entry:'+id));
  return {items,deletedIds,newIds:items.filter(m=>!before.has(m.id)&&!m.sharedBy).map(m=>m.id)};
 });}
 async search(url:string,token:string,query:{q?:string;channelId?:string;serverId?:string;authorId?:string;cursor?:string;before?:string;after?:string;has?:string}):Promise<{items:{message:Message;channelName:string;serverId:string|null}[];nextCursor:string|null}>{return this.serial(url,async()=>{
  const a=await this.account(url,token),prefix='messages:'+a.instance+':'+a.user.id+':';const results:Message[]=[];
  const channels=query.channelId?[query.channelId]:this.vault.recordIds(prefix).filter(id=>!id.includes(':entry:')).map(id=>id.slice(prefix.length));
  const scope=query.serverId?await this.request<{channels:{id:string;name:string}[]}>(a.url,a.token,'/servers/'+encodeURIComponent(query.serverId)):null;
  for(const channel of channels){
   if(scope&&!scope.channels.some(c=>c.id===channel))continue;
   let before:string|undefined;
   for(let page=0;page<2000;page++){
    const messages=this.history(a,channel,before,100);if(!messages.length)break;
    for(const message of messages){
     if(query.q&&!message.content.toLocaleLowerCase().includes(query.q.toLocaleLowerCase()))continue;
     if(query.authorId&&message.author.id!==query.authorId)continue;
     if(query.before&&message.createdAt>=query.before)continue;if(query.after&&message.createdAt<query.after)continue;
     if(query.has==='link'&&!/https?:\/\//.test(message.content))continue;
     if(query.has&&query.has!=='link'&&!message.attachments.some(f=>query.has==='file'||f.contentType.startsWith(query.has+'/')))continue;
     results.push(message);
    }
    if(messages.length<100)break;before=messages[0]!.id;
   }
  }
  results.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const start=query.cursor?results.findIndex(m=>m.id===query.cursor)+1:0,items=results.slice(start,start+25);
  return {items:items.map(message=>({message,channelName:scope?.channels.find(c=>c.id===message.channelId)?.name??message.channelId,serverId:query.serverId??null})),nextCursor:start+25<results.length?items.at(-1)!.id:null};
 });}
 async send(url:string,token:string,channel:string,content:string,replyToId:string|null,files:CryptoFile[]=[],expiresAt:string|null=null,options:{signal?:AbortSignal;id?:string}={}):Promise<Message>{return this.serial(url,async()=>{
  options.signal?.throwIfAborted();
  if(expiresAt && (!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Date.now()+30*86400000))throw new Error('Expiração inválida');
  const a=await this.account(url,token);await this.postPending(a,channel);await this.provision(a);const before=await this.request<{type:string;participantIds:string[]}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto');
  if(before.type==='files'&&!files.length)throw new Error('Envie ao menos um arquivo neste canal');
  if(!content.trim()&&!files.length)throw new Error('Mensagem vazia');
  const candidates=await this.request<DeviceRow[]>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/devices');
  if(before.type==='dm' && before.participantIds.some(id=>!candidates.some(d=>d.user_id===id)))throw new Error('O destinatário precisa abrir a conversa para configurar seu dispositivo seguro');
  const authorized=this.read<{users:string[]}>('authorization:'+a.instance+':'+a.user.id+':'+channel);
  if(!authorized || candidates.some(d=>!authorized.users.includes(d.user_id)))throw new Error('Revise e autorize os participantes criptográficos antes de enviar');
  let state=await this.ensureGroup(a,channel);await this.syncAccount(a,channel);
  const peers=await this.request<DeviceRow[]>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto/devices');
  const info=await a.engine.command<{epoch:number;members:MlsMember[]}>({op:'info',group:state.group_id});
  const missing=info.members.filter(m=>!peers.some(p=>p.id===JSON.parse(m.identity)[2]));
  const roster=info.members.map(m=>JSON.parse(m.identity)[2] as string);
  // Add only devices with a validated endorsement chain and a signed, one-use KeyPackage.
  for(const peer of peers.filter(p=>!roster.includes(p.id))){
   const trusted=await this.directory(a,peer.user_id);if(!trusted.some(p=>p.id===peer.id))throw new Error('Dispositivo não confiável');
   const kp=await this.request<{package:string;signature:string;nonce:string}>(a.url,a.token,'/crypto/key-packages/'+peer.id+'/claim',{});
   if(!valid(peer.public_key,['annoy/key-package/v1',a.instance,peer.user_id,peer.id,hash(kp.package),kp.nonce],kp.signature))throw new Error('KeyPackage substituído');
   const indices=missing.filter(m=>JSON.parse(m.identity)[1]===peer.user_id).map(m=>m.index);
   const label=JSON.stringify({type:indices.length?'replace':'add',channel,id:randomUUID(),welcomeId:randomUUID(),target:peer.id});
   const base={group:state.group_id,package:kp.package,identity:JSON.stringify([a.instance,peer.user_id,peer.id]),key:Buffer.from(peer.mls_key,'base64url').toString('base64')};
   await a.engine.command(indices.length?{op:'replace',...base,indices}:{op:'add',...base},label);
   for(const i of indices){const at=missing.findIndex(m=>m.index===i);if(at>=0)missing.splice(at,1);}
   await this.postPending(a,channel);roster.push(peer.id);
   await this.shareHistory(a,channel,state);
  }
  if(missing.length){await a.engine.command({op:'remove',group:state.group_id,indices:missing.map(m=>m.index)},JSON.stringify({type:'remove',channel,id:randomUUID()}));await this.postPending(a,channel);}
  state=(await this.request<{channel:ChannelState}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
  const refreshKey='refresh:'+a.instance+':'+a.keys.id+':'+channel;
  const refresh=this.read<{at:number;messages:number}>(refreshKey)??{at:0,messages:0};
  if(state.state==='rekey_required' || refresh.messages>=32 || Date.now()-refresh.at>15*60000){
   await a.engine.command({op:'update',group:state.group_id},JSON.stringify({type:'update',channel,id:randomUUID()}));await this.postPending(a,channel);refresh.at=Date.now();refresh.messages=0;
  }
  refresh.messages++;this.write(refreshKey,refresh);
  const attachments:SecretAttachment[]=[];
  for(const file of files){
   options.signal?.throwIfAborted();
   if(file.bytes.byteLength>64*1024*1024)throw new Error('Anexo E2EE limitado a 64 MiB por arquivo');
   const id=randomBytes(16).toString('hex'),key=randomBytes(32),plain=Buffer.from(file.bytes);
   const encrypted=seal(key,plain,'attachment:'+id);
   try {
    const response=await this.authenticatedFetch(a.url,a.token,'/api/channels/'+encodeURIComponent(channel)+'/crypto/blobs/'+id,{method:'POST',headers:{'annoy-device':a.keys.id,'content-type':'application/octet-stream'},body:new Uint8Array(encrypted),signal:AbortSignal.any([this.abort.signal,...(options.signal?[options.signal]:[]),AbortSignal.timeout(60000)]),redirect:'error'});
    if(!response.ok)throw new Error('Upload cifrado recusado: '+response.status);
    attachments.push({id,filename:file.name,contentType:file.type,size:plain.length,url:'annoy-encrypted:'+id,fileKey:key.toString('base64url')});
   }finally{plain.fill(0);key.fill(0);}
  }
  const message:Message={expiresAt,protection:"e2ee",id:options.id??randomUUID(),channelId:channel,author:{id:a.user.id,displayName:a.user.displayName,username:a.user.username??a.user.id,avatarUrl:null},content,createdAt:new Date().toISOString(),editedAt:null,replyToId,attachments,mentionIds:[],mentionsEveryone:false};
  options.signal?.throwIfAborted();const label=JSON.stringify({type:'send',channel,id:message.id});
  await a.engine.command({op:'send',group:state.group_id,plaintext:JSON.stringify({v:1,kind:'message',message})},label);
  try{options.signal?.throwIfAborted();await this.postPending(a,channel,{signal:options.signal});}
  catch(error){
   if(!options.signal?.aborted)throw error;
   await a.engine.cancelDelivery(label);
   try{await this.postPending(a,channel);}catch{throw new Error('Cancelamento pendente: a rede não confirmou se a mensagem foi entregue. Não reenvie antes de sincronizar.');}
   const result=this.read<{delivered:boolean}>('cancel-result:'+a.instance+':'+message.id);
   if(!result?.delivered)throw new DOMException('Envio cancelado antes da entrega','AbortError');
   this.storeMessage(a,channel,message);
  }
  return this.publicMessage(message);
 });}
 async importLegacy(url:string,token:string,channel:string):Promise<{complete:boolean;messages:number;attachments:number;reason?:string}>{return this.serial(url,async()=>{
  const a=await this.account(url,token),base='legacy:'+a.instance+':'+a.user.id+':'+channel;
  const manifest=await this.request<{version:number;channelId:string;fingerprint:string;messages:number;attachments:number;bytes:number}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/legacy/manifest');
  if(manifest.version!==1||manifest.channelId!==channel||!/^[a-f0-9]{64}$/.test(manifest.fingerprint)||!Number.isSafeInteger(manifest.messages)||manifest.messages<0||manifest.messages>100000||!Number.isSafeInteger(manifest.attachments)||manifest.attachments<0||manifest.attachments>1000000)throw new Error('Manifesto legado inválido');
  const state=await this.request<{channel:ChannelState|null}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto');
  const ids:string[]=[],seen=new Set<string>(),files=new Map<string,{hash:string;size:number}>();let before:string|undefined,downloaded=0;
  for(let page=0;page<1001;page++){
   const path='/channels/'+encodeURIComponent(channel)+(state.channel?'/legacy/messages':'/messages')+'?limit=100'+(before?'&before='+encodeURIComponent(before):'');
   const result=await this.request<Message[]|{protection:string;items:Message[]}>(a.url,a.token,path),rows=Array.isArray(result)?result:result.protection==='legacy_plaintext'?result.items:null;
   if(!rows||rows.length>100)throw new Error('Página legada inválida');if(!rows.length)break;
   const messages=rows.map(raw=>parseLegacyMessage(raw,channel));
   for(const message of messages){
    if(seen.has(message.id))throw new Error('Origem repetiu mensagens durante a cópia');seen.add(message.id);if(seen.size>100000)throw new Error('Limite de migração');
    for(const file of message.attachments){
     const fileKey='legacy-file:'+a.instance+':'+a.user.id+':'+channel+':'+file.id;
     if(file.size>64*1024*1024)return {complete:false,messages:seen.size-1,attachments:files.size,reason:'Anexo legado excede 64 MiB; a origem foi preservada. Planeje exportação em lotes com ferramenta compatível.'};
     let plain=this.vault.get(fileKey);
     if(!plain){
      if(downloaded+file.size>512*1024*1024)return {complete:false,messages:seen.size-1,attachments:files.size,reason:'Lote de 512 MiB concluído. Execute novamente para continuar; a origem foi preservada.'};
      const response=await this.authenticatedFetch(a.url,a.token,'/api/uploads/'+file.id+'/'+encodeURIComponent(file.filename),{cache:'no-store',redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(60000)])});
      if(!response.ok||!response.body)throw new Error('Anexo legado indisponível; origem preservada');
      const chunks:Uint8Array[]=[];let size=0;for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>file.size||size>64*1024*1024)throw new Error('Tamanho de anexo inválido');chunks.push(chunk);}
      plain=Buffer.concat(chunks);for(const chunk of chunks)chunk.fill(0);if(plain.length!==file.size){plain.fill(0);throw new Error('Anexo legado incompleto');}
      downloaded+=plain.length;this.vault.put(fileKey,plain,{backup:true});
     }
     try{if(plain.length!==file.size)throw new Error('Cópia local diverge da origem');files.set(file.id,{hash:createHash('sha256').update(plain).digest('hex'),size:plain.length});}finally{plain.fill(0);}
    }
    this.write(base+':entry:'+message.id,message,true);
   }
   ids.unshift(...messages.map(m=>m.id));this.write(base,ids,true);before=messages[0]!.id;
   if(rows.length<100)break;
  }
  if(seen.size!==manifest.messages||files.size!==manifest.attachments)throw new Error('Cópia legada incompleta; origem preservada');
  // Read every copied record through AEAD before issuing a public attestation.
  for(const id of ids)if(!this.read<Message>(base+':entry:'+id))throw new Error('Registro local não foi validado');
  const root=createHash('sha256');root.update('annoy/legacy/files/v1');for(const [id,file] of [...files].sort(([a],[b])=>a.localeCompare(b)))root.update(JSON.stringify([id,file.hash,file.size]));
  const fileDigest=root.digest('hex'),proof=['annoy/legacy/archive/v1',a.instance,a.user.id,channel,a.keys.id,manifest.fingerprint,fileDigest,manifest.messages,manifest.attachments];
  await this.request(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/legacy/receipt',{version:1,deviceId:a.keys.id,fingerprint:manifest.fingerprint,fileDigest,messages:manifest.messages,attachments:manifest.attachments,signature:signKey(a.keys.private,proof)});
  this.write('legacy-meta:'+a.instance+':'+a.user.id+':'+channel,{source:'legacy_plaintext',complete:true,fingerprint:manifest.fingerprint,fileDigest,messages:manifest.messages,attachments:manifest.attachments},true);
  return {complete:true,messages:manifest.messages,attachments:manifest.attachments};
 });}
 localChannels(url:string,userId:string):{id:string;kind:'messages'|'legacy';count:number}[]{
  this.vault.unlock();const instance=this.read<{instance:string}>('instance:'+hash(new URL(url).origin+'\0'+userId));if(!instance)return [];
  const result:{id:string;kind:'messages'|'legacy';count:number}[]=[];
  for(const kind of ['messages','legacy'] as const){const prefix=kind+':'+instance.instance+':'+userId+':';for(const key of this.vault.recordIds(prefix).filter(k=>!k.includes(':entry:'))){const ids=this.read<string[]>(key);if(Array.isArray(ids))result.push({id:key.slice(prefix.length),kind,count:ids.filter(id=>this.vault.has(key+':entry:'+id)).length});}}
  return result;
 }
 localMessages(url:string,userId:string,channel:string,kind:'messages'|'legacy',before?:string):Message[]{
  this.vault.unlock();const instance=this.read<{instance:string}>('instance:'+hash(new URL(url).origin+'\0'+userId));if(!instance)return [];
  const base=kind+':'+instance.instance+':'+userId+':'+channel,ids=(this.read<string[]>(base)??[]).filter(id=>this.vault.has(base+':entry:'+id)&&!this.vault.has('tombstone:'+base+':entry:'+id));
  const end=before?ids.indexOf(before):ids.length;return ids.slice(Math.max(0,end-50),Math.max(0,end)).map(id=>this.read<Message>(base+':entry:'+id)).filter((m):m is Message=>!!m).map(m=>this.publicMessage(m));
 }
 localLegacyFile(url:string,userId:string,channel:string,messageId:string,fileId:string):{bytes:Buffer;name:string}{
  this.vault.unlock();const instance=this.read<{instance:string}>('instance:'+hash(new URL(url).origin+'\0'+userId));if(!instance)throw new Error('Conta local não encontrada');
  const base='legacy:'+instance.instance+':'+userId+':'+channel,message=this.read<Message>(base+':entry:'+messageId);
  if(!message||this.vault.has('tombstone:'+base+':entry:'+messageId))throw new Error('Mensagem local indisponível');const file=message.attachments.find(f=>f.id===fileId);if(!file)throw new Error('Anexo local não encontrado');
  const bytes=this.vault.get('legacy-file:'+instance.instance+':'+userId+':'+channel+':'+fileId);if(!bytes||bytes.length!==file.size){bytes?.fill(0);throw new Error('Anexo local inválido');}return {bytes,name:file.filename};
 }
 async exportLocalBackupDirectory(directory:string):Promise<{key:string}>{
  if(!this.vault.exists())throw new Error('Nenhum cofre local disponível');this.vault.unlock();const key=randomBytes(32),snapshot=this.vault.pinPermanent();
  try{await writeBackupDirectory(directory,snapshot.records,key,this.abort.signal);return {key:key.toString('base64url')};}finally{snapshot.release();key.fill(0);}
 }
 async refresh(url:string,token:string,channel:string):Promise<void>{return this.serial(url,async()=>{
  const a=await this.account(url,token);const state=await this.ensureGroup(a,channel);await this.syncAccount(a,channel);
  await a.engine.command({op:'update',group:state.group_id},JSON.stringify({type:'update',channel,id:randomUUID()}));await this.postPending(a,channel);
 });}
 async configureChannel(url:string,token:string,channel:string,history:'since_join'|'share_permanent',owner:string|null):Promise<void>{return this.serial(url,async()=>{
  const a=await this.account(url,token);const state=await this.ensureGroup(a,channel);await this.syncAccount(a,channel);
  await a.engine.command({op:'policy',group:state.group_id,history,owner:owner?a.instance+':'+owner:null},JSON.stringify({type:'policy',channel,id:randomUUID()}));
  await this.postPending(a,channel);
 });}
 private async shareHistory(a:Account,channel:string,state:ChannelState):Promise<void>{
  const info=await a.engine.command<{policy:GroupPolicy}>({op:'info',group:state.group_id});
  if(info.policy.history!=='share_permanent'||info.policy.owner!==a.instance+':'+a.user.id)return;
  const key=this.historyKey(a,channel),ids=this.read<string[]>(key)??[];let chunk:ProtectedMessage[]=[];
  const flush=async()=>{if(!chunk.length)return;const payload={v:1,kind:'history',id:randomUUID(),authorId:a.user.id,at:new Date().toISOString(),expiresAt:null,messages:chunk};
   await a.engine.command({op:'send',group:state.group_id,plaintext:JSON.stringify(payload)},JSON.stringify({type:'history',channel,id:payload.id}));await this.postPending(a,channel);chunk=[];};
  for(const id of ids){if(this.vault.has('tombstone:'+key+':entry:'+id))continue;const m=this.read<ProtectedMessage>(key+':entry:'+id);if(!m||m.expiresAt)continue;
   if(chunk.length>=20||Buffer.byteLength(JSON.stringify([...chunk,m]))>58000)await flush();
   if(Buffer.byteLength(JSON.stringify(m))>58000)continue;chunk.push(m);
  }await flush();
 }
 async safetyCode(url:string,token:string,userId:string):Promise<{code:string;verified:boolean}>{return this.serial(url,async()=>{
  const a=await this.account(url,token);await this.directory(a,userId);
  const trust=this.read<Trust>('trust:'+a.instance+':'+userId)!;
  return {code:hash(JSON.stringify(['annoy/safety/v1',a.instance,userId,trust.root])).match(/.{1,4}/g)!.join('-'),verified:trust.verified};
 });}
 async verifySafetyCode(url:string,token:string,userId:string,code:string):Promise<void>{return this.serial(url,async()=>{
  const a=await this.account(url,token);await this.directory(a,userId);const id='trust:'+a.instance+':'+userId,trust=this.read<Trust>(id)!;
  const expected=hash(JSON.stringify(['annoy/safety/v1',a.instance,userId,trust.root])).match(/.{1,4}/g)!.join('-');
  if(code!==expected)throw new Error('Código de segurança não confere');trust.verified=true;this.write(id,trust,true);
 });}



 async action(url:string,token:string,channel:string,kind:'edit'|'delete'|'reaction',targetId:string,content='',add=true):Promise<Message|null>{return this.serial(url,async()=>{
  const a=await this.account(url,token);await this.syncAccount(a,channel);
  const state=(await this.request<{channel:ChannelState}>(a.url,a.token,'/channels/'+encodeURIComponent(channel)+'/crypto')).channel;
  if(!state)throw new Error('Canal sem E2EE');
  const target=this.read<ProtectedMessage>(this.historyKey(a,channel)+':entry:'+targetId);if(!target)throw new Error('Mensagem indisponível');
  if(kind!=='reaction'&&target.author.id!==a.user.id)throw new Error('Moderação de conteúdo cifrado exige relatório voluntário ou retirada de entrega pelo servidor');
  const common={v:1,id:randomUUID(),authorId:a.user.id,targetId,at:new Date().toISOString(),expiresAt:target.expiresAt??null};
  const payload=kind==='edit'?{...common,kind,content}:kind==='delete'?{...common,kind}:{...common,kind,emoji:content,add};
  const parsed=parsePayload(JSON.stringify(payload));
  await a.engine.command({op:'send',group:state.group_id,plaintext:JSON.stringify(parsed)},JSON.stringify({type:'action',channel,id:common.id}));
  await this.postPending(a,channel);const message=this.read<ProtectedMessage>(this.historyKey(a,channel)+':entry:'+targetId);return message?this.publicMessage(message):null;
 });}
 async attachment(url:string,token:string,channel:string,messageId:string,id:string):Promise<{bytes:ArrayBuffer;type:string;name:string}>{return this.serial(url,async()=>{
  const a=await this.account(url,token);const message=this.read<ProtectedMessage>(this.historyKey(a,channel)+':entry:'+messageId);
  if(!message || (message.expiresAt && Date.parse(message.expiresAt)<=Date.now()))throw new Error('Mensagem expirada ou indisponível');
  const file=message.attachments.find(f=>f.id===id) as SecretAttachment|undefined;
  if(!file?.fileKey || file.size>64*1024*1024)throw new Error('Anexo inválido');
  const response=await this.authenticatedFetch(a.url,a.token,'/api/channels/'+encodeURIComponent(channel)+'/crypto/blobs/'+encodeURIComponent(id),{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok || Number(response.headers.get('content-length')??0)>64*1024*1024+29 || !response.body)throw new Error('Download cifrado recusado');
  const parts:Uint8Array[]=[];let size=0;for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>64*1024*1024+29)throw new Error('Anexo excede limite');parts.push(chunk);}
  const ciphertext=Buffer.concat(parts),key=Buffer.from(file.fileKey,'base64url');
  try {const plain=open(key,ciphertext,'attachment:'+id);if(plain.length!==file.size){plain.fill(0);throw new Error('Integridade do anexo inválida');}const bytes=new Uint8Array(plain).buffer;plain.fill(0);return {bytes,type:file.contentType,name:file.filename};}finally{key.fill(0);}
 });}
 async exportBackupDirectory(url:string,token:string,directory:string):Promise<{key:string}>{return this.serial(url,async()=>{
  await this.account(url,token);const key=randomBytes(32),snapshot=this.vault.pinPermanent();
  try{await writeBackupDirectory(directory,snapshot.records,key,this.abort.signal);return {key:key.toString('base64url')};}finally{snapshot.release();key.fill(0);}
 });}
 async importBackupDirectory(directory:string,keyText:string):Promise<number>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(keyText))throw new Error('Chave de recuperação inválida');
  if(this.restoring)throw new Error('Restauração em andamento');this.restoring=true;this.stop();const key=Buffer.from(keyText,'base64url');
  try{
   this.vault.unlock();
   const count=await readBackupDirectory(directory,key,(id,plain)=>this.vault.restorePermanentRecord(id,plain),this.abort.signal);
   for(const record of this.vault.recordIds('recovery:'))this.write('restore-authorization:'+record.slice('recovery:'.length),{at:Date.now()});
   return count;
  }finally{this.restoring=false;key.fill(0);}
 }
 async exportBackup(url:string,token:string):Promise<{data:Buffer;key:string}>{return this.serial(url,async()=>{
  await this.account(url,token);const key=randomBytes(32);try{return {data:this.vault.exportPermanent(key),key:key.toString('base64url')};}finally{key.fill(0);}
 });}
 importBackup(data:Buffer,keyText:string):void {
  if(!/^[A-Za-z0-9_-]{43}$/.test(keyText))throw new Error('Chave de recuperação inválida');
  const key=Buffer.from(keyText,'base64url');this.vault.unlock();try{
   this.vault.importPermanent(data,key);this.stop();this.vault.unlock();
   for(const record of this.vault.recordIds('recovery:'))this.write('restore-authorization:'+record.slice('recovery:'.length),{at:Date.now()});
  }finally{key.fill(0);}
 }
 async devices(url:string,token:string):Promise<Pick<DeviceRow,'id'|'public_key'|'revoked_at'>[]>{return this.serial(url,async()=>{
  const a=await this.account(url,token);return this.request(a.url,a.token,'/crypto/users/'+a.user.id+'/devices');
 });}
 async revoke(url:string,token:string,deviceId:string):Promise<void>{return this.serial(url,async()=>{
  const a=await this.account(url,token);const {nonce}=await this.request<{nonce:string}>(a.url,a.token,'/crypto/devices/challenge',{purpose:'revoke'});
  const signature=signKey(a.keys.recoveryPrivate,['annoy/device/revoke/v1',a.instance,a.user.id,deviceId,nonce]);
  await this.request(a.url,a.token,'/crypto/devices/'+encodeURIComponent(deviceId)+'/revoke',{nonce,signature});
  this.stop();
 });}
 stop(){this.media.abandon();this.epoch++;this.abort.abort();this.abort=new AbortController();for(const a of this.accounts.values())a.engine.stop(true);this.accounts.clear();this.nonces.clear();this.expectedAccounts.clear();this.vault.lock();}
}
