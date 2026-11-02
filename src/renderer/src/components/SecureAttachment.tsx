import {t as translate} from "../../../shared/localization/index.ts";
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
const ImageViewer=lazy(()=>import('./ImageViewer.tsx'));
import type {Message,Attachment} from '@distopic/protocol';
import {apiFor} from '../client.ts';
import {toast} from '../store.ts';
import {Icon} from './ui.tsx';
import {Button} from './ui/button.tsx';

const IMAGE=/^image\/(png|jpeg|gif|webp|avif)$/i;
const formatSize=(bytes:number)=>bytes<1024*1024?`${Math.max(1,Math.ceil(bytes/1024))} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;

/** Encrypted and authenticated (legacy) attachments, shown like any other attachment.
 * Object URLs exist only while this authorized message is mounted. */
export function SecureAttachment({accountId,message,file}:{accountId:string;message:Message;file:Attachment}){
 const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[zoom,setZoom]=useState(false);const objectUrl=useRef(''),mounted=useRef(true);
 const encrypted=file.url.startsWith('annoy-encrypted:'),image=IMAGE.test(file.contentType),media=/^(audio|video)\//.test(file.contentType);
 useEffect(()=>{mounted.current=true;const dispose=()=>{if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';};const timer=message.expiresAt?setTimeout(()=>{dispose();setUrl('');setZoom(false);},Math.max(0,Date.parse(message.expiresAt)-Date.now())):null;return()=>{mounted.current=false;if(timer)clearTimeout(timer);dispose();};},[message.id,message.expiresAt]);
 const load=async():Promise<string>=>{if(url)return url;if(loading)return '';setLoading(true);try{
  const result=await (encrypted?apiFor(accountId).attachment(message.channelId,message.id,file.id):apiFor(accountId).legacyAttachment(file));
  if(!mounted.current||(message.expiresAt&&Date.parse(message.expiresAt)<=Date.now())){new Uint8Array(result.bytes).fill(0);return '';}
  const safe=/^(image\/(png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(result.type)?result.type:'application/octet-stream';
  objectUrl.current=URL.createObjectURL(new Blob([result.bytes],{type:safe}));new Uint8Array(result.bytes).fill(0);setUrl(objectUrl.current);return objectUrl.current;
 }catch(err){toast((err as Error).message);return '';}finally{if(mounted.current)setLoading(false);}};
 // Images and media open in place, like ordinary attachments; other files wait for "Baixar".
 useEffect(()=>{if(image||media)void load();},[message.id,file.id]);
 const download=async()=>{
  if(!encrypted&&!image&&!media)return void apiFor(accountId).downloadLegacy(file).catch(err=>toast((err as Error).message));
  const href=await load();if(!href)return;const link=document.createElement('a');link.href=href;link.download=file.filename;link.click();
 };
 const viewer=zoom&&url&&<Suspense fallback={null}><ImageViewer images={[{id:file.id,url,filename:file.filename,size:file.size}]} initialIndex={0} onClose={()=>setZoom(false)}/></Suspense>;
 if(image)return <><button type="button" className="attachment-image" aria-label={translate("chat.5ed9aabafd14",{p0:(file.filename)})} onClick={()=>url&&setZoom(true)}>
  {url?<img src={url} alt={file.filename} decoding="async"/>:<span className="attachment-loading">{loading?translate("common.c7ad73ae4ace"):file.filename}</span>}
  {url&&<span className="attachment-expand"><Icon name="maximize" size={16}/></span>}
 </button>{viewer}</>;
 if(media&&url)return file.contentType.startsWith('video/')?<video className="attachment-video" controls src={url}/>:<audio controls src={url}/>;
 return <div className="attachment-file"><Icon name="paperclip" size={20}/><span><span className="attachment-name">{file.filename}</span><span className="muted">{formatSize(file.size)}</span></span><Button variant="ghost" size="sm" onClick={()=>void download()} disabled={loading}>{loading?translate("common.0911dfa616da"):translate("expression.b45ae836a031")}</Button></div>;
}
