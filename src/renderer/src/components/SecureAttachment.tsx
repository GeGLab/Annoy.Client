import {lazy,Suspense,useEffect,useRef,useState} from 'react';
const ImageViewer=lazy(()=>import('./ImageViewer.tsx'));
import type {Message,Attachment} from '@distopic/protocol';
import {apiFor} from '../client.ts';
import {toast} from '../store.ts';
import {Button} from './ui/button.tsx';
/** Object URLs exist only while this authorized message is mounted. */
export function SecureAttachment({accountId,message,file}:{accountId:string;message:Message;file:Attachment}){
 const [url,setUrl]=useState(''),[loading,setLoading]=useState(false),[zoom,setZoom]=useState(false);const objectUrl=useRef(''),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const dispose=()=>{if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current='';};const timer=message.expiresAt?setTimeout(()=>{dispose();setUrl('');setZoom(false);},Math.max(0,Date.parse(message.expiresAt)-Date.now())):null;return()=>{mounted.current=false;if(timer)clearTimeout(timer);dispose();};},[message.id,message.expiresAt]);
 const load=async()=>{if(loading||url)return;setLoading(true);try{
  const result=await (file.url.startsWith('annoy-encrypted:')?apiFor(accountId).attachment(message.channelId,message.id,file.id):apiFor(accountId).legacyAttachment(file));
  if(!mounted.current||(message.expiresAt&&Date.parse(message.expiresAt)<=Date.now())){new Uint8Array(result.bytes).fill(0);return;}
  const safe=/^(image\/(png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(result.type)?result.type:'application/octet-stream';
  objectUrl.current=URL.createObjectURL(new Blob([result.bytes],{type:safe}));new Uint8Array(result.bytes).fill(0);setUrl(objectUrl.current);
 }catch(err){toast((err as Error).message);}finally{setLoading(false);}};
 return <div className="attachment-file"><strong>{file.filename}</strong> · {Math.ceil(file.size/1024)} KiB {!url?<Button variant="ghost" size="sm" onClick={()=>void load()} disabled={loading}>{loading?'Abrindo anexo…':file.url.startsWith('annoy-encrypted:')?'Abrir anexo cifrado':'Abrir anexo legado sem E2EE'}</Button>:<><a href={url} download={file.filename}>Salvar cópia</a>{/^image\/(png|jpeg|gif|webp|avif)$/i.test(file.contentType)&&<button onClick={()=>setZoom(true)} aria-label="Ampliar imagem"><img src={url} alt={file.filename} style={{maxWidth:360,maxHeight:300}}/></button>}{file.contentType.startsWith('audio/')&&<audio controls src={url}/>} {file.contentType.startsWith('video/')&&<video controls src={url} style={{maxWidth:500}}/>}</>}{!file.url.startsWith('annoy-encrypted:')&&<Button variant='ghost' size='sm' onClick={()=>void apiFor(accountId).downloadLegacy(file).catch(err=>toast((err as Error).message))}>Baixar cópia legada</Button>}{zoom&&url&&<Suspense fallback={<span>Abrindo imagem…</span>}><ImageViewer images={[{id:file.id,url,filename:file.filename,size:file.size}]} initialIndex={0} onClose={()=>setZoom(false)}/></Suspense>}</div>;
}
