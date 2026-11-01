import type {ElectronApplication} from '@playwright/test';
/** Renderer-only regression fixture. No cryptography claim: the separate real
 * controller/Electron security suites exercise the unmodified native handler. */
export async function uiReactionFixture(app:ElectronApplication):Promise<void>{
 await app.evaluate(({ipcMain})=>{
  const fixture={writes:[] as string[],delay:false,release:null as null|(()=>void)};
  (globalThis as any).__uiReactionFixture=fixture;
  ipcMain.removeHandler('crypto:action');
  ipcMain.handle('crypto:action',async(event,raw)=>{
   if(raw.kind!=='reaction'||raw.channel!=='general'||raw.targetId!=='message')throw new Error('Unexpected UI reaction fixture action');
   const message=await event.sender.executeJavaScript(`(async()=>{const {getState}=await import(location.origin+'/src/store.ts');return getState().instances.test.messages.general.items[0];})()`);
   const result=structuredClone(message),reaction=result.reactions?.find((r:any)=>r.emoji===raw.content)??{emoji:raw.content,userIds:[]};
   fixture.writes.push(raw.add?'PUT':'DELETE');
   reaction.userIds=raw.add?[...new Set([...reaction.userIds,'person'])]:reaction.userIds.filter((id:string)=>id!=='person');
   result.reactions=[...(result.reactions??[]).filter((r:any)=>r.emoji!==raw.content),...(reaction.userIds.length?[reaction]:[])];
   if(fixture.delay){fixture.delay=false;await new Promise<void>(resolve=>{fixture.release=resolve;});}
   return {ok:true,value:result};
  });
 });
}
