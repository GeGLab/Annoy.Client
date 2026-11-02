import {t as translate} from "../../../../shared/localization/index.ts";
// End-to-end encryption actions, shown only in the settings screens (never in a chat).
import {apiFor} from '../../client.ts';
import {getState,toast} from '../../store.ts';
import {promptText} from '../ui/action-dialog.tsx';

/** Device-level operations need no particular conversation; the native layer only checks the account. */
export const ACCOUNT_SCOPE='account';
const accountOf=(accountId:string)=>getState().accounts.find(a=>a.id===accountId);
async function guarded(accountId:string,channelId:string,work:(a:{url:string;token:string;userId:string})=>Promise<void>):Promise<void>{
 const a=accountOf(accountId);if(!a||!window.distopic?.crypto)return;
 try{await window.distopic.crypto.guard(a.url,a.token,channelId,a.userId);await work(a);}catch(error){toast((error as Error).message);}
}
export async function unlockVault():Promise<void>{
 const password=await promptText(translate("common.28839efe5d1f"),'',{secret:true});if(!password)return;
 try{await window.distopic?.crypto.unlock(password);toast(translate("common.f40f88fe1cf0"));}catch(error){toast((error as Error).message);}
}
export async function verifyIdentity(accountId:string):Promise<void>{
 const a=accountOf(accountId);if(!a)return;
 try{
  const own=await apiFor(accountId).cryptoCode(ACCOUNT_SCOPE,a.userId);
  const target=await promptText(translate("common.ec3615b972f4",{p0:own.code}));if(!target)return;
  await apiFor(accountId).cryptoCode(ACCOUNT_SCOPE,target);
  const entered=await promptText(translate("common.cc7cc138d2ca"));if(!entered)return;
  await apiFor(accountId).verifyCryptoCode(ACCOUNT_SCOPE,target,entered.trim());toast(translate("common.166de18a5c96"));
 }catch(error){toast((error as Error).message);}
}
export const backup=(accountId:string)=>guarded(accountId,ACCOUNT_SCOPE,async a=>{await window.distopic!.crypto.backup(a.url,a.token,ACCOUNT_SCOPE);});
export const restore=(accountId:string)=>guarded(accountId,ACCOUNT_SCOPE,async a=>{
 const key=await promptText(translate("common.afeee869c77d"),'',{secret:true});if(!key)return;
 await window.distopic!.crypto.restore(a.url,a.token,ACCOUNT_SCOPE,key.trim());toast(translate("common.8e620f8590d6"));
});
export const devices=(accountId:string)=>guarded(accountId,ACCOUNT_SCOPE,async a=>{
 const list=await window.distopic!.crypto.devices(a.url,a.token,ACCOUNT_SCOPE);
 const id=await promptText(translate("common.d21af0eda418",{p0:list.map(d=>d.id+(d.revoked_at?translate("common.76ac747bdef3"):'')).join('\n')}));
 if(id){await window.distopic!.crypto.revoke(a.url,a.token,ACCOUNT_SCOPE,id.trim());toast(translate("common.a84111a3d145"));}
});
export const authorizeMembers=(accountId:string,channelId:string)=>guarded(accountId,channelId,async a=>{await window.distopic!.crypto.authorize(a.url,a.token,channelId);});
export const historyPolicy=(accountId:string,channelId:string,history:'since_join'|'share_permanent',owner:string|null)=>guarded(accountId,channelId,async a=>{
 await window.distopic!.crypto.policy(a.url,a.token,channelId,history,owner);toast(translate("common.a250d4addd47"));
});
export const importLegacy=(accountId:string,channelId:string)=>guarded(accountId,channelId,async a=>{
 const result=await window.distopic!.crypto.importLegacy(a.url,a.token,channelId);
 if(!result.cancelled)toast(result.complete?translate("common.203e02b99549"):result.reason??translate("common.41ea4ff75962"));
});
