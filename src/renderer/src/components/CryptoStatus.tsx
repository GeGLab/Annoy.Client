import {lazy,Suspense,useEffect,useState} from 'react';
const LegacyArchive=lazy(()=>import('./LegacyArchive.tsx').then(module=>({default:module.LegacyArchive})));
import {apiFor} from '../client.ts';
import {getState,toast,setState} from '../store.ts';
import {promptText} from './ui/action-dialog.tsx';
import {Button} from './ui/button.tsx';
export function CryptoStatus({accountId,channelId}:{accountId:string;channelId:string}) {
 const [state,setStatus]=useState<{active:boolean}|null>(null),[error,setError]=useState(''),[showLegacy,setShowLegacy]=useState(false);
 useEffect(()=>{
  let active=true,running=false;
  const poll=async()=>{
   if(running)return;running=true;
   try {
    const status=await apiFor(accountId).cryptoStatus(channelId);if(!active)return;setStatus(status);setError('');
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
 const code=async()=>{
  const account=getState().accounts.find(a=>a.id===accountId);if(!account)return;
  try {
   const own=await apiFor(accountId).cryptoCode(channelId,account.userId);
   const target=await promptText('Seu código de segurança: '+own.code+'. Compartilhe por outro canal. Informe o ID da pessoa que deseja verificar:');if(!target)return;
   const expected=await apiFor(accountId).cryptoCode(channelId,target);
   const entered=await promptText('Compare com a pessoa por outro canal. Digite o código que ela forneceu:');if(!entered)return;
   await apiFor(accountId).verifyCryptoCode(channelId,target,entered.trim());toast('Identidade verificada neste dispositivo');
  }catch(err){toast((err as Error).message);}
 };
 const unlock=async()=>{const password=await promptText('Crie ou informe a senha do armazenamento local. Perder esta senha e o backup pode causar perda permanente do histórico.','',{secret:true});if(!password)return;try{await window.distopic?.crypto.unlock(password);setError('');}catch(err){toast((err as Error).message);}};

 const account=()=>getState().accounts.find(a=>a.id===accountId);
 const policy=async()=>{const a=account();if(!a)return;try{await window.distopic?.crypto.guard(a.url,a.token,channelId,a.userId);const choice=await promptText('Histórico de novos participantes: digite desde-entrada (padrão) ou compartilhar-permanentes. Só o proprietário criptográfico pode alterar. Mensagens temporárias nunca são compartilhadas.');if(!choice)return;const history=choice.trim()==='desde-entrada'?'since_join':choice.trim()==='compartilhar-permanentes'?'share_permanent':null;if(!history)throw new Error('Opção inválida');const owner=await promptText('Para transferir a administração criptográfica, informe o ID de um participante atual. Deixe vazio para manter o proprietário.');if(owner===null)return;await window.distopic!.crypto.policy(a.url,a.token,channelId,history,owner.trim()||null);toast('Política autenticada pelo MLS atualizada');}catch(err){toast((err as Error).message);}};
 const authorize=async()=>{const a=account();if(!a)return;try{await window.distopic?.crypto.guard(a.url,a.token,channelId,a.userId);await window.distopic?.crypto.authorize(a.url,a.token,channelId);}catch(err){toast((err as Error).message);}};
 const backup=async()=>{const a=account();if(!a)return;try{await window.distopic?.crypto.guard(a.url,a.token,channelId,a.userId);await window.distopic?.crypto.backup(a.url,a.token,channelId);}catch(err){toast((err as Error).message);}};
 const restore=async()=>{const a=account();if(!a)return;try{await window.distopic?.crypto.guard(a.url,a.token,channelId,a.userId);const key=await promptText('Informe a chave do backup. Restauração recupera histórico permanente e autoriza um novo dispositivo; sessões MLS antigas não são restauradas.','',{secret:true});if(!key)return;await window.distopic?.crypto.restore(a.url,a.token,channelId,key.trim());toast('Backup restaurado. Abra novamente a conversa para registrar o dispositivo.');}catch(err){toast((err as Error).message);}};
 const devices=async()=>{const a=account();if(!a)return;try{await window.distopic?.crypto.guard(a.url,a.token,channelId,a.userId);const list=await window.distopic!.crypto.devices(a.url,a.token,channelId);const id=await promptText('Dispositivos:\n'+list.map(d=>d.id+(d.revoked_at?' (revogado)':'')).join('\n')+'\nInforme o ID que deseja revogar. Todas as sessões da conta serão encerradas.');if(id){await window.distopic!.crypto.revoke(a.url,a.token,channelId,id.trim());toast('Dispositivo revogado. Entre novamente na conta.');}}catch(err){toast((err as Error).message);}};
 const importLegacy=async()=>{const a=account();if(!a)return;try{await window.distopic!.crypto.guard(a.url,a.token,channelId,a.userId);const result=await window.distopic!.crypto.importLegacy(a.url,a.token,channelId);if(!result.cancelled)toast(result.complete?'Arquivo legado validado no cofre local. Gere um backup cifrado antes de expurgar a origem.':result.reason??'Cópia parcial; origem preservada');}catch(error){toast((error as Error).message);}};

 return <><div className="connection-notice" role="status"><span>{error?`Envio seguro bloqueado: ${error}`:state?.active?'OpenMLS ativo — integração em validação':'Histórico legado sem E2EE. Novos envios usarão OpenMLS.'}</span><Button variant="ghost" size="sm" onClick={()=>void authorize()}>Autorizar participantes</Button><Button variant="ghost" size="sm" onClick={()=>void unlock()}>Desbloquear cofre</Button><Button variant="ghost" size="sm" onClick={()=>void code()}>Verificar identidade</Button><Button variant="ghost" size="sm" onClick={()=>void backup()}>Backup</Button><Button variant="ghost" size="sm" onClick={()=>void restore()}>Restaurar</Button><Button variant="ghost" size="sm" onClick={()=>void devices()}>Dispositivos</Button><Button variant="ghost" size="sm" onClick={()=>void policy()}>Política do grupo</Button><Button variant="ghost" size="sm" onClick={()=>void importLegacy()}>Copiar legado ao cofre</Button>{state?.active&&<Button variant="ghost" size="sm" onClick={()=>setShowLegacy(true)}>Arquivo legado</Button>}</div>{showLegacy&&<Suspense fallback={<p>Abrindo arquivo legado…</p>}><LegacyArchive accountId={accountId} channelId={channelId} onClose={()=>setShowLegacy(false)}/></Suspense>}</>;
}
