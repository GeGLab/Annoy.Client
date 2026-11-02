import {t as translate} from "../../../shared/localization/index.ts";
import {useEffect,useRef} from 'react';
import {apiFor} from '../client.ts';
import {getState,toast,setState} from '../store.ts';
/** Keeps an open conversation's encrypted messages in sync. Renders nothing: the chat is only for chat;
 * encryption settings live in the server and user settings. A failure is reported once as a notice. */
export function CryptoStatus({accountId,channelId}:{accountId:string;channelId:string}) {
 const reported=useRef('');
 const setError=(message:string)=>{
  // Lost connectivity is shown by the connection indicators, not as an encryption problem.
  if(/net::|fetch|network|Conta desconectada|timed out|tempo esgotado/i.test(message)||getState().instances[accountId]?.status!=='ready')return;
  if(message&&message!==reported.current)toast(translate("common.790883cb28dd",{p0:message}),8000);reported.current=message;};
 useEffect(()=>{
  let active=true,running=false;
  const poll=async()=>{
   if(running)return;running=true;
   try {
    const status=await apiFor(accountId).cryptoStatus(channelId);if(!active)return;setError('');
    if(status.active){
     const account=getState().accounts.find(a=>a.id===accountId);if(!account)return;
     const knownIds=getState().instances[accountId]?.messages[channelId]?.items.map(m=>m.id)??[];
     const {items:messages,deletedIds,newIds}=await window.distopic!.crypto.reconcile(account.url,account.token,channelId,knownIds);
     if(active)for(const message of messages)if(newIds.includes(message.id))window.dispatchEvent(new CustomEvent('annoy:crypto-message',{detail:{url:account.url,message}}));
     if(active)setState(s=>{const entry=s.instances[accountId]?.messages[channelId];if(entry){const known=new Map([...entry.items,...messages].map(m=>[m.id,m]));entry.items=[...known.values()].filter(m=>!deletedIds.includes(m.id)&&(!m.expiresAt||Date.parse(m.expiresAt)>Date.now()));entry.loading=false;}});
    }
   }catch(err){if(active)setError((err as Error).message);}finally{running=false;}
  };void poll();const timer=setInterval(()=>void poll(),3000);return()=>{active=false;clearInterval(timer);};
 },[accountId,channelId]);
 return null;
}
