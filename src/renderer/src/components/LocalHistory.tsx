import {rich} from "../lib/localization.ts";
import {localizationPreferences} from "../../../shared/localization/index.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import {useEffect,useRef,useState} from 'react';
import type {Message} from '@distopic/protocol';
import {useStore,toast} from '../store.ts';
import {Button} from './ui/button.tsx';
export function LocalHistory(){
 const accounts=useStore(s=>s.accounts),[accountId,setAccount]=useState(accounts[0]?.id??''),[channels,setChannels]=useState<{id:string;kind:'messages'|'legacy';count:number}[]>([]),[selected,setSelected]=useState(''),[messages,setMessages]=useState<Message[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[more,setMore]=useState(false);
 const generation=useRef(0);
 const account=accounts.find(a=>a.id===accountId);
 useEffect(()=>{let active=true;generation.current++;setLoading(false);setMore(false);setMessages([]);setSelected('');setChannels([]);setError('');if(account&&window.distopic)void window.distopic.crypto.localChannels(account.url,account.userId).then(items=>{if(active)setChannels(items);}).catch(err=>{if(active)setError((err as Error).message);});return()=>{active=false;generation.current++;};},[accountId]);
 const read=async(value:string,before?:string)=>{if(!account||!window.distopic)return;const revision=++generation.current;setLoading(true);setError('');try{const [kind,channel]=JSON.parse(value) as ['messages'|'legacy',string],items=await window.distopic.crypto.localMessages(account.url,account.userId,channel,kind,before);if(revision!==generation.current)return;setMessages(current=>before?[...items,...current]:items);setMore(items.length===50);}catch(err){if(revision===generation.current)setError((err as Error).message);}finally{if(revision===generation.current)setLoading(false);}};
 return <section className="local-history" aria-label={translate("common.b95b6f2a65c0")}><p>{translate("common.0a528902ca30")}</p>
 <label>{translate("common.99fbd1154044")}<select aria-label={translate("common.d98eecfd8f43")} value={accountId} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.instanceName} · {a.userId}</option>)}</select></label>
 <label>{translate("common.2197266e8543")}<select aria-label={translate("common.7ff5847fe0bd")} value={selected} onChange={e=>{generation.current++;setSelected(e.target.value);setMessages([]);setMore(false);setLoading(false);if(e.target.value)void read(e.target.value);}}><option value="">{translate("common.836922d227d6")}</option>{channels.map(c=><option key={JSON.stringify([c.kind,c.id])} value={JSON.stringify([c.kind,c.id])}>{rich("common.1f97ea58d8a4",{p0:(c.id),p1:(c.kind==='legacy'?'origem legada':'MLS'),p2:(c.count)})}</option>)}</select></label>
 <Button variant="secondary" onClick={()=>void window.distopic?.crypto.localBackup().then(result=>{if(result.saved)toast(translate("common.72407b9205bd"));}).catch(err=>toast((err as Error).message))}>{translate("common.b599d4b9a854")}</Button>
 {error&&<p role="alert">{error}</p>}{loading&&<p role="status">{translate("common.c596deb281a3")}</p>}
 {more&&messages.length>0&&<Button disabled={loading} onClick={()=>void read(selected,messages[0]!.id)}>{translate("common.6136f0bacb44")}</Button>}
 {messages.map(message=><article key={message.id}><strong>{message.author.displayName}</strong> <time>{new Date(message.createdAt).toLocaleString(localizationPreferences().region,{hourCycle:localizationPreferences().hourCycle})}</time><small>{message.protection==='legacy_plaintext'?translate("common.32e829cef243"):translate("common.34ffdb9f1d71")}</small><p style={{whiteSpace:'pre-wrap'}}>{message.content}</p>{message.attachments.map(file=><div key={file.id}>{rich("common.2be1bda9002d",{p0:(file.filename),p1:(Math.ceil(file.size/1024)),p2:(file.url.startsWith('annoy-archive:')&&account?<Button variant="ghost" size="sm" onClick={()=>void window.distopic?.crypto.localFileSave(account.url,account.userId,message.channelId,message.id,file.id).catch(err=>toast((err as Error).message))}>{translate("common.edd2245509a2")}</Button>:<span>{translate("common.d9c7215c1339")}</span>)})}</div>)}</article>)}
 </section>;
}
