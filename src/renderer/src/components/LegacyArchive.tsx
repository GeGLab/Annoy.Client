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
   if(revision!==generation.current)return;if(result.protection!=='legacy_plaintext')throw new Error('Origem do arquivo legado não identificada');
   setMessages(current=>before?[...result.items,...current]:result.items);setMore(result.items.length===50);
  }catch(error){if(revision===generation.current)setError((error as Error).message);}
  finally{if(revision===generation.current)setLoading(false);}
 };
 useEffect(()=>{setMessages([]);setMore(false);void read();return()=>{generation.current++;};},[accountId,channelId]);
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" style={{maxWidth:800,maxHeight:'85vh',overflow:'auto',padding:24}}>
  <Dialog.Title>Arquivo legado sem E2EE</Dialog.Title>
  <Dialog.Description>Estas mensagens foram armazenadas em texto claro. A proteção atual não altera o passado. O arquivo é somente leitura; cópias anteriores podem existir. Downloads salvos fora do cofre não são apagados pelo aplicativo.</Dialog.Description>
  <Dialog.Close asChild><Button variant="secondary">Fechar arquivo legado</Button></Dialog.Close>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">Lendo arquivo legado…</p>}
  {more&&messages.length>0&&<Button disabled={loading} onClick={()=>void read(messages[0]!.id)}>Mensagens legadas anteriores</Button>}
  {!loading&&!messages.length&&!error&&<p>Não há mensagens legadas neste canal.</p>}
  {messages.map(message=><article key={message.id} style={{marginBlock:20}}><strong>{message.author.displayName}</strong> <time>{new Date(message.createdAt).toLocaleString('pt-BR')}</time><p style={{whiteSpace:'pre-wrap'}}>{message.content}</p>{message.attachments.map(file=><SecureAttachment key={file.id} accountId={accountId} message={message} file={file}/>)}</article>)}
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
