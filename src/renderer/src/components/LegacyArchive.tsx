import {localizationPreferences} from "../../../shared/localization/index.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import * as Dialog from '@radix-ui/react-dialog';
import {useEffect,useRef,useState} from 'react';
import type {Message} from '@distopic/protocol';
import {apiFor} from '../client.ts';
import {SecureAttachment} from './SecureAttachment.tsx';
import {Button} from './ui/button.tsx';
/** Explicit, read-only source archive. It never joins plaintext to MLS history. */
export function LegacyArchive({accountId,channelId,onClose}:{accountId:string;channelId:string;onClose:()=>void}){
 const [messages,setMessages]=useState<Message[]>([]),[loading,setLoading]=useState(false),[more,setMore]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 const read=async(before?:string)=>{
  const revision=++generation.current;setLoading(true);setError('');
  try{
   const result=await apiFor(accountId).legacyMessages<{protection:string;items:Message[]}>(channelId,before);
   if(revision!==generation.current)return;if(result.protection!=='legacy_plaintext')throw new Error(translate("common.3dc541237373"));
   setMessages(current=>before?[...result.items,...current]:result.items);setMore(result.items.length===50);
  }catch(error){if(revision===generation.current)setError((error as Error).message);}
  finally{if(revision===generation.current)setLoading(false);}
 };
 useEffect(()=>{setMessages([]);setMore(false);void read();return()=>{generation.current++;};},[accountId,channelId]);
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" style={{maxWidth:800,maxHeight:'85vh',overflow:'auto',padding:24}}>
  <Dialog.Title>{translate("common.219a6243f592")}</Dialog.Title>
  <Dialog.Description>{translate("common.b5335b28c32d")}</Dialog.Description>
  <Dialog.Close asChild><Button variant="secondary">{translate("common.c54d2b780cfb")}</Button></Dialog.Close>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">{translate("common.7c27daca9e72")}</p>}
  {more&&messages.length>0&&<Button disabled={loading} onClick={()=>void read(messages[0]!.id)}>{translate("common.2b4a1aa908f0")}</Button>}
  {!loading&&!messages.length&&!error&&<p>{translate("common.5c51f5b00642")}</p>}
  {messages.map(message=><article key={message.id} style={{marginBlock:20}}><strong>{message.author.displayName}</strong> <time>{new Date(message.createdAt).toLocaleString(localizationPreferences().region,{hourCycle:localizationPreferences().hourCycle})}</time><p style={{whiteSpace:'pre-wrap'}}>{message.content}</p>{message.attachments.map(file=><SecureAttachment key={file.id} accountId={accountId} message={message} file={file}/>)}</article>)}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
