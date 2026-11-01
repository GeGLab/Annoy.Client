import {ipcMain,dialog,type BrowserWindow} from 'electron';
import {open,rm} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
/** Explicitly saved legacy copies are user-controlled plaintext, not an app cache. */
export function registerPrivateDownload(window:()=>BrowserWindow|null,authorized:(event:Electron.IpcMainInvokeEvent)=>boolean,request:typeof fetch){
 const active=new Set<AbortController>();
 ipcMain.handle('file:private-download',async(event,raw)=>{
  const value=raw as Record<string,unknown>;
  if(!authorized(event)||!value||typeof value.baseUrl!=='string'||value.baseUrl.length>2048||typeof value.path!=='string'||value.path.length>2048||typeof value.token!=='string'||!value.token||value.token.length>4096||typeof value.name!=='string'||value.name.length>200)throw new Error('Download não autorizado');
  let base:URL,target:URL;try{base=new URL(value.baseUrl);target=new URL(value.path,base);}catch{throw new Error('Endereço de download inválido');}
  if(base.username||base.password||target.origin!==base.origin||!/^\/api\/uploads\/[a-f0-9]{32}\//.test(target.pathname)||target.search||target.hash||(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname))))throw new Error('Endereço de download inválido');
  if(active.size>=2)throw new Error('Limite de downloads simultâneos');
  const choice=await dialog.showSaveDialog(window()!,{title:'Salvar cópia de anexo legado sem E2EE',defaultPath:value.name.replace(/[/\\\0]/g,'_')});if(!choice.filePath)return {saved:false};
  const abort=new AbortController();active.add(abort);let created=false,complete=false;
  try{
   const response=await request(target.toString(),{headers:{authorization:'Bearer '+value.token},redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(300000)])});
   if(!response.ok||!response.body)throw new Error('Download recusado');
   const file=await open(choice.filePath,'wx',0o600);created=true;
   try{let size=0;const limit=new Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>500*1024*1024?new Error('Limite de download'):null,chunk);}});
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),limit,file.createWriteStream());complete=true;
   }finally{await file.close().catch(()=>{});}
   return {saved:true};
  }catch{throw new Error('Download não concluído. Escolha um nome novo e confirme seu acesso ao anexo.');}
  finally{active.delete(abort);if(created&&!complete)await rm(choice.filePath,{force:true}).catch(()=>{});}
 });
 return ()=>{for(const abort of active)abort.abort();};
}
