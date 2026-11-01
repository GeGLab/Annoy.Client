import {trustedRenderer} from '../trusted-renderer.ts';
import {nativeApiFetch} from '../native-api-fetch.ts';
import {rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {app,ipcMain,safeStorage,dialog,clipboard,MessageChannelMain,type BrowserWindow} from 'electron';
import type {MediaBinding,MediaProposals} from './media-calls.ts';
import {existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {LIMITS} from '@distopic/protocol';
import {EncryptedVault} from './vault.ts';
import {VaultKeyProtector} from "./key-protector.ts";
import {CryptoController} from './controller.ts';

export function registerCrypto(window:()=>BrowserWindow|null,allowed:()=>boolean):(()=>void)&{proof:(url:string,token:string,method:string,path:string,nonce?:string)=>Promise<string|null>} {
 const directory=join(app.getPath('userData'),'crypto-v1');
 const protector=new VaultKeyProtector(directory,{
  available:()=>safeStorage.isEncryptionAvailable() && (process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text'),
  encrypt:value=>safeStorage.encryptString(value),decrypt:sealed=>safeStorage.decryptString(sealed),
 });
 const vault=new EncryptedVault(directory,protector);
 const exe='annoy-crypto'+(process.platform==='win32'?'.exe':'');
 const developmentRoot=join(import.meta.dirname,'../..');
 const release=join(developmentRoot,'native/annoy-crypto/target/release',exe);
 const binary=app.isPackaged?join(process.resourcesPath,'crypto',exe):existsSync(release)?release:join(developmentRoot,'native/annoy-crypto/target/debug',exe);
 const controller=new CryptoController(vault,binary,nativeApiFetch);
 const handle=(name:string,handler:(event:Electron.IpcMainInvokeEvent,raw:unknown)=>unknown)=>ipcMain.handle(name,async(event,raw)=>{
  try{return {ok:true,value:await handler(event,raw)};}
  catch(error){return {ok:false,name:error instanceof Error?error.name:'Error',message:error instanceof SyntaxError?'Conteúdo criptográfico inválido':error instanceof Error?error.message.slice(0,200):'Operação criptográfica bloqueada'};}
 });
 const payload=(event:Electron.IpcMainInvokeEvent,raw:unknown)=>{
  const win=window();if(!trustedRenderer(event,win) || !allowed())throw new Error('IPC criptográfico não autorizado');
  const value=raw as Record<string,unknown>;
  if(!value || typeof value.url!=='string' || value.url.length>2048 || typeof value.token!=='string' || !value.token || value.token.length>4096 || typeof value.channel!=='string' || !value.channel || value.channel.length>100)throw new Error('Pedido criptográfico inválido');
  return {url:value.url,token:value.token,channel:value.channel,raw:value};
 };
 const localPayload=(event:Electron.IpcMainInvokeEvent,raw:unknown)=>{
  const value=raw as Record<string,unknown>;if(!trustedRenderer(event,window())||!value||typeof value.url!=='string'||value.url.length>2048||typeof value.userId!=='string'||!value.userId||value.userId.length>100)throw new Error('Cofre local não autorizado');
  return value as {url:string;userId:string;channel?:string;kind?:string;before?:string;messageId?:string;fileId?:string};
 };
 handle('crypto:local-channels',(event,raw)=>{const p=localPayload(event,raw);return controller.localChannels(p.url,p.userId);});
 handle('crypto:local-messages',(event,raw)=>{const p=localPayload(event,raw);if(typeof p.channel!=='string'||p.channel.length>100||!['messages','legacy'].includes(p.kind??'')||(p.before!==undefined&&(typeof p.before!=='string'||p.before.length>100)))throw new Error('Conversa local inválida');return controller.localMessages(p.url,p.userId,p.channel,p.kind as 'messages'|'legacy',p.before);});
 handle('crypto:local-file-save',async(event,raw)=>{
  const p=localPayload(event,raw);if(typeof p.channel!=='string'||p.channel.length>100||typeof p.messageId!=='string'||p.messageId.length>100||typeof p.fileId!=='string'||!/^[a-f0-9]{32}$/.test(p.fileId))throw new Error('Anexo local inválido');
  const file=controller.localLegacyFile(p.url,p.userId,p.channel,p.messageId,p.fileId);
  try{const selected=await dialog.showSaveDialog(window()!,{title:'Salvar cópia legada fora do cofre',defaultPath:file.name.replace(/[/\\\0]/g,'_')});if(!selected.filePath)return {saved:false};writeFileSync(selected.filePath,file.bytes,{flag:'wx',mode:0o600,flush:true});return {saved:true};}finally{file.bytes.fill(0);}
 });
 handle('crypto:local-backup',async event=>{
  if(!trustedRenderer(event,window()))throw new Error('Cofre local não autorizado');
  const selected=await dialog.showOpenDialog(window()!,{title:'Escolher pasta para backup local cifrado',properties:['openDirectory','createDirectory']});if(!selected.filePaths[0])return {saved:false};
  const target=join(selected.filePaths[0],'annoy-backup-'+new Date().toISOString().slice(0,10)+'-'+randomBytes(4).toString('hex')),backup=await controller.exportLocalBackupDirectory(target);
  const confirmed=await dialog.showMessageBox(window()!,{type:'info',message:'Guarde a chave de recuperação do backup',detail:backup.key+'\nSem esta chave o backup não pode ser recuperado. Inclui histórico permanente e anexos já locais; sessões MLS e conteúdo temporário são excluídos.',buttons:['Copiar chave e guardar backup','Cancelar'],cancelId:1});
  if(confirmed.response!==0){await rm(target,{recursive:true,force:true});return {saved:false};}clipboard.writeText(backup.key);setTimeout(()=>{void(async()=>{if(await clipboard.readText()===backup.key)await clipboard.writeText('');})().catch(()=>{});},60000).unref();return {saved:true};
 });
 handle('crypto:import-legacy',async(event,raw)=>{
  const p=payload(event,raw),confirmation=await dialog.showMessageBox(window()!,{type:'question',message:'Copiar histórico legado para o cofre local?',detail:'Este conteúdo já foi armazenado sem E2EE. A cópia local será cifrada e um comprovante público sem o conteúdo será registrado. A origem não será apagada. Crie um backup cifrado antes de qualquer expurgo administrativo.',buttons:['Cancelar','Copiar e validar arquivo legado'],defaultId:0,cancelId:0});
  if(confirmation.response!==1)return {cancelled:true};return controller.importLegacy(p.url,p.token,p.channel);
 });
 let unlocking=false;
 const sends=new Map<string,AbortController>();
 handle('crypto:cancel',(event,raw)=>{
  const win=window();if(!trustedRenderer(event,win)||!allowed()||typeof raw!=='string'||!/^[a-f0-9-]{36}$/.test(raw))throw new Error('Cancelamento não autorizado');
  sends.get(raw)?.abort(new DOMException('Envio cancelado','AbortError'));
 });
 handle('crypto:unlock',async(event,raw)=>{
  const win=window();if(!trustedRenderer(event,win) || typeof raw!=='string')throw new Error('IPC não autorizado');
  if(unlocking)throw new Error("Desbloqueio já está em andamento");unlocking=true;
  try{await protector.unlockPassword(raw);vault.unlock();return {unlocked:true};}finally{unlocking=false;}
 });
 handle('crypto:proof',(event,raw)=>{
  const win=window();const value=raw as Record<string,unknown>;
  if(!trustedRenderer(event,win)||!value||typeof value.url!=='string'||value.url.length>2048||typeof value.token!=='string'||value.token.length>4096||typeof value.method!=='string'||typeof value.path!=='string'||value.path.length>4096)throw new Error('Pedido de prova inválido');
  return controller.proof(value.url,value.token,value.method,value.path,typeof value.nonce==='string'?value.nonce:undefined);
 });
 handle('crypto:guard',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.userId!=='string'||p.raw.userId.length>100)throw new Error('Identidade inválida');controller.expect(p.url,p.token,p.raw.userId);return controller.guardChannel(p.url,p.raw.userId,p.channel);});
 handle('crypto:bind',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.userId!=='string'||!p.raw.userId||p.raw.userId.length>100)throw new Error('Identidade inválida');controller.expect(p.url,p.token,p.raw.userId);return controller.bind(p.url,p.token);});
 handle('crypto:status' ,(event,raw)=>{const p=payload(event,raw);return controller.status(p.url,p.token,p.channel);});
 handle('crypto:sync',(event,raw)=>{const p=payload(event,raw);if(p.raw.before!==undefined&&(typeof p.raw.before!=='string'||p.raw.before.length>100))throw new Error('Cursor inválido');return controller.sync(p.url,p.token,p.channel,p.raw.before as string|undefined);});
 handle('crypto:reconcile',(event,raw)=>{const p=payload(event,raw);const ids=p.raw.knownIds;if(!Array.isArray(ids)||ids.length>10000||ids.some(id=>typeof id!=='string'||id.length>100))throw new Error('Lista de mensagens inválida');return controller.reconcile(p.url,p.token,p.channel,ids);});
 handle('crypto:action',(event,raw)=>{const p=payload(event,raw);if(!['edit','delete','reaction'].includes(p.raw.kind as string)||typeof p.raw.targetId!=='string'||p.raw.targetId.length>100||typeof p.raw.content!=='string'||p.raw.content.length>LIMITS.messageMax||typeof p.raw.add!=='boolean')throw new Error('Ação inválida');return controller.action(p.url,p.token,p.channel,p.raw.kind as 'edit'|'delete'|'reaction',p.raw.targetId,p.raw.content,p.raw.add);});
 handle('crypto:search',(event,raw)=>{const p=payload(event,raw);const query=p.raw.query as Record<string,unknown>;if(!query||Object.keys(query).some(k=>!['q','channelId','serverId','authorId','cursor','before','after','has'].includes(k))||Object.values(query).some(v=>typeof v!=='string'||v.length>200))throw new Error('Busca inválida');return controller.search(p.url,p.token,query as Record<string,string>);});
 handle('crypto:policy',(event,raw)=>{const p=payload(event,raw);if(!['since_join','share_permanent'].includes(p.raw.history as string)||(p.raw.owner!==null&&(typeof p.raw.owner!=='string'||p.raw.owner.length>100)))throw new Error('Política inválida');return controller.configureChannel(p.url,p.token,p.channel,p.raw.history as 'since_join'|'share_permanent',p.raw.owner as string|null);});
 handle('crypto:send',async(event,raw)=>{
  const p=payload(event,raw);
  if(typeof p.raw.content!=='string' || p.raw.content.length>LIMITS.messageMax || (p.raw.replyToId!==null && (typeof p.raw.replyToId!=='string' || p.raw.replyToId.length>100)))throw new Error('Mensagem inválida');
  const files=p.raw.files??[];
  if(!Array.isArray(files)||files.length>10 || files.some(f=>!f || typeof f.name!=='string'||f.name.length>200||typeof f.type!=='string'||f.type.length>120||!(f.bytes instanceof ArrayBuffer)) || files.reduce((sum,f)=>sum+f.bytes.byteLength,0)>64*1024*1024)throw new Error('Limite de anexos cifrados');
  if(p.raw.expiresAt!==undefined && p.raw.expiresAt!==null && (typeof p.raw.expiresAt!=='string'||!Number.isFinite(Date.parse(p.raw.expiresAt))))throw new Error('Expiração inválida');
  const id=p.raw.requestId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||sends.has(id))throw new Error('Identificador de envio inválido');
  if(sends.size>=16)throw new Error('Muitos envios em andamento');
  const abort=new AbortController();sends.set(id,abort);
  try{return await controller.send(p.url,p.token,p.channel,p.raw.content,p.raw.replyToId as string|null,files,p.raw.expiresAt as string|null??null,{signal:abort.signal,id});}
  finally{sends.delete(id);for(const file of files)new Uint8Array(file.bytes).fill(0);}
 });
 handle('crypto:attachment',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.messageId!=='string'||p.raw.messageId.length>100||typeof p.raw.id!=='string'||!/^[a-f0-9]{32}$/.test(p.raw.id))throw new Error('Anexo inválido');return controller.attachment(p.url,p.token,p.channel,p.raw.messageId,p.raw.id);});
 handle('crypto:authorize',async(event,raw)=>{
  const p=payload(event,raw),review=await controller.membershipReview(p.url,p.token,p.channel);
  const confirmation=await dialog.showMessageBox(window()!,{type:'question',message:'Autorizar estes participantes criptográficos?',detail:review.map(r=>r.userId+' — '+r.code).join('\n')+'\nCompare códigos por outro canal para verificar a identidade. A administração da instância não recebe chaves privadas.',buttons:['Cancelar','Autorizar participantes'],defaultId:0,cancelId:0});
  if(confirmation.response===1)await controller.authorizeMembers(p.url,p.token,p.channel,review);
  return {authorized:confirmation.response===1};
 });
 handle('crypto:backup',async(event,raw)=>{
  const p=payload(event,raw),win=window()!;
  const format=await dialog.showMessageBox(win,{type:'question',message:'Formato do backup cifrado',detail:'O diretório inclui o histórico permanente e anexos já locais. Anexos ainda não baixados dependem do servidor. O arquivo v1 é limitado a 40 MiB de conteúdo. Estados MLS e conteúdo temporário são sempre excluídos.',buttons:['Diretório completo','Arquivo v1','Cancelar'],cancelId:2});if(format.response===2)return {saved:false};
  let target:string,backup:{key:string;data?:Buffer};const directory=format.response===0;
  if(directory){const selected=await dialog.showOpenDialog(win,{title:'Escolher pasta para criar um novo backup cifrado',properties:['openDirectory','createDirectory']});if(!selected.filePaths[0])return {saved:false};target=join(selected.filePaths[0],'annoy-backup-'+new Date().toISOString().slice(0,10)+'-'+randomBytes(4).toString('hex'));backup=await controller.exportBackupDirectory(p.url,p.token,target);}
  else{const saved=await dialog.showSaveDialog(win,{title:'Salvar backup cifrado v1',defaultPath:'annoy.annoy-backup',filters:[{name:'Annoy',extensions:['annoy-backup']}]});if(!saved.filePath)return {saved:false};target=saved.filePath;backup=await controller.exportBackup(p.url,p.token);}
  const confirmed=await dialog.showMessageBox(win,{type:'info',message:'Guarde esta chave de recuperação fora do computador',detail:backup.key+'\n\nSem esta chave, perder os dispositivos pode causar perda permanente dos dados. Estados MLS e conteúdo temporário não estão no backup.',buttons:['Copiar chave e guardar backup','Cancelar'],cancelId:1});
  if(confirmed.response!==0){if(directory)await rm(target,{recursive:true,force:true});return {saved:false};}
  clipboard.writeText(backup.key);if(!directory)writeFileSync(target,backup.data!,{mode:0o600,flush:true});
  setTimeout(()=>{void(async()=>{if(await clipboard.readText()===backup.key)await clipboard.writeText('');})().catch(()=>{});},60000).unref();return {saved:true};
 });
 handle('crypto:restore',async(event,raw)=>{
  const p=payload(event,raw);if(typeof p.raw.recoveryKey!=='string'||p.raw.recoveryKey.length>100)throw new Error('Chave inválida');
  const format=await dialog.showMessageBox(window()!,{type:'question',message:'Qual backup deseja restaurar?',buttons:['Diretório completo','Arquivo v1','Cancelar'],cancelId:2});if(format.response===2)return {restored:false};
  const directory=format.response===0;
  const selected=await dialog.showOpenDialog(window()!,{title:'Restaurar backup cifrado',properties:[directory?'openDirectory':'openFile'],...(!directory?{filters:[{name:'Annoy',extensions:['annoy-backup']}]}:{})});if(!selected.filePaths[0])return {restored:false};
  if(directory)await controller.importBackupDirectory(selected.filePaths[0],p.raw.recoveryKey);
  else{if(statSync(selected.filePaths[0]).size>64*1024*1024)throw new Error('Backup excede o limite');controller.importBackup(readFileSync(selected.filePaths[0]),p.raw.recoveryKey);}
  return {restored:true};
 });
 handle('crypto:devices',(event,raw)=>{const p=payload(event,raw);return controller.devices(p.url,p.token);});
 handle('crypto:revoke',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.deviceId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.raw.deviceId))throw new Error('Dispositivo inválido');return controller.revoke(p.url,p.token,p.raw.deviceId);});
 handle('crypto:code',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.userId!=='string'||p.raw.userId.length>100)throw new Error('Usuário inválido');return controller.safetyCode(p.url,p.token,p.raw.userId);});
 handle('crypto:verify',(event,raw)=>{const p=payload(event,raw);if(typeof p.raw.userId!=='string'||p.raw.userId.length>100||typeof p.raw.code!=='string'||p.raw.code.length>100)throw new Error('Código inválido');return controller.verifySafetyCode(p.url,p.token,p.raw.userId,p.raw.code);});
 // Encrypted calls. The SFrame base keys go to a MessagePort that the page hands straight
 // to its encoded-transform worker; they never cross renderer IPC as return values.
 const mediaRequest=(event:Electron.IpcMainInvokeEvent,raw:unknown)=>{
  if(!trustedRenderer(event,window())||!allowed())throw new Error('IPC de mídia não autorizado');
  const value=raw as Record<string,unknown>;if(!value||typeof value.handle!=='string'||!/^[a-f0-9]{32}$/.test(value.handle))throw new Error('Chamada inválida');
  return value as Record<string,unknown>&{handle:string};
 };
 const bindingList=(value:unknown):MediaBinding[]=>{if(!Array.isArray(value)||value.length>256)throw new Error('Participantes inválidos');return value as MediaBinding[];};
 const wire=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>1_400_000)throw new Error('Mensagem MLS inválida');return value;};
 handle('media:open',async(event,raw)=>{
  const p=payload(event,raw);if(typeof p.raw.userId!=='string'||!p.raw.userId||p.raw.userId.length>100)throw new Error('Identidade inválida');
  controller.expect(p.url,p.token,p.raw.userId);const handleId=await controller.media.open(p.url,p.token,p.channel);
  const {port1,port2}=new MessageChannelMain();
  controller.media.attach(handleId,{post:(epoch,senderIndex,key)=>port1.postMessage({epoch,senderIndex,key:new Uint8Array(key)}),close:()=>port1.close()});
  event.sender.postMessage('media:port',{handle:handleId},[port2]);
  return {handle:handleId};
 });
 handle('media:create',(event,raw)=>controller.media.create(mediaRequest(event,raw).handle));
 handle('media:propose',(event,raw)=>{const p=mediaRequest(event,raw);if(typeof p.callId!=='string'||p.callId.length>64)throw new Error('Chamada inválida');return controller.media.propose(p.handle,p.callId);});
 handle('media:commit',(event,raw)=>{
  const p=mediaRequest(event,raw),proposals=p.proposals as MediaProposals;
  if(!proposals||typeof proposals.callId!=='string'||!Number.isSafeInteger(proposals.epoch)||!Array.isArray(proposals.adds)||!Array.isArray(proposals.removes)||proposals.adds.length>256||proposals.removes.length>256)throw new Error('Propostas inválidas');
  for(const add of proposals.adds){if(!Number.isSafeInteger(add?.ref))throw new Error('Propostas inválidas');wire(add.keyPackage);}
  if(proposals.removes.some(r=>!Number.isSafeInteger(r?.ref)))throw new Error('Propostas inválidas');
  return controller.media.commit(p.handle,proposals);
 });
 handle('media:settle',(event,raw)=>{const p=mediaRequest(event,raw);if(typeof p.delivery!=='string'||!/^media-commit:[a-f0-9]{16}$/.test(p.delivery)||typeof p.accepted!=='boolean')throw new Error('Confirmação inválida');return controller.media.settle(p.handle,p.delivery,p.accepted);});
 handle('media:accept',(event,raw)=>{const p=mediaRequest(event,raw),e=p.event as Record<string,unknown>;if(!e||typeof e.callId!=='string'||!Number.isSafeInteger(e.epoch))throw new Error('Commit inválido');return controller.media.accept(p.handle,{callId:e.callId,epoch:e.epoch as number,commit:wire(e.commit),bindings:bindingList(e.bindings)});});
 handle('media:welcome',(event,raw)=>{const p=mediaRequest(event,raw),e=p.event as Record<string,unknown>;if(!e||typeof e.callId!=='string'||!Number.isSafeInteger(e.epoch))throw new Error('Convite inválido');return controller.media.welcome(p.handle,{callId:e.callId,epoch:e.epoch as number,welcome:wire(e.welcome),bindings:bindingList(e.bindings)});});
 handle('media:roster',(event,raw)=>controller.media.roster(mediaRequest(event,raw).handle));
 handle('media:close',(event,raw)=>controller.media.close(mediaRequest(event,raw).handle));
 const timer=setInterval(()=>{try{controller.expireLocal();}catch{/* Locked vault; expiration retries at unlock. */}},1000);timer.unref();
 const stop=()=>{for(const abort of sends.values())abort.abort();sends.clear();controller.stop();protector.lock();};app.on('before-quit',()=>{clearInterval(timer);stop();});return Object.assign(stop,{proof:controller.proof.bind(controller)});
}
