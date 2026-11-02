import {test,expect} from '@playwright/test';

for(const won of [true,false])test(`call keys wait for server confirmation and ${won?'keep the winning':'discard the losing'} provisional group`,async({page})=>{
 await page.route('http://127.0.0.1:5178/key-race-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic key delivery test</title>'}));
 await page.goto('http://127.0.0.1:5178/key-race-test');
 const result=await page.evaluate(async(won)=>{
  const {CallEncryption}=await import(/* @vite-ignore */ location.origin+'/src/media-e2ee/call-encryption.ts');
  const installed:string[]=[],attached:string[]=[],closed:string[]=[],sources=new Map<string,MessagePort>();
  class WorkerFixture extends EventTarget {
   postMessage(message:{type:string;port?:MessagePort}){
    if(message.type!=='keys'||!message.port)return;
    const port=message.port;
    attached.push('keys');port.onmessage=event=>installed.push(event.data.group);port.start();
   }
   terminate(){}
  }
  Object.defineProperty(window,'Worker',{value:WorkerFixture,configurable:true});
  let next=0,confirm!:(value:{created:boolean;callId:string})=>void;
  let attempted!:()=>void;const createAttempted=new Promise<void>(done=>{attempted=done;});
  const bridge={
   async open(){const handle=String(++next),channel=new MessageChannel();sources.set(handle,channel.port1);window.postMessage({annoyMediaPort:handle},'*',[channel.port2]);return {handle};},
   async create(handle:string){sources.get(handle)!.postMessage({group:'provisional'});return {callId:'provisional',binding:{}};},
   async close(handle:string){closed.push(handle);sources.get(handle)?.close();},
   async propose(handle:string){sources.get(handle)!.postMessage({group:'winner'});return {keyPackage:'synthetic',binding:{}};},
  };
  Object.defineProperty(window,'distopic',{value:{media:bridge},configurable:true});
  const signaling={async voice(method:string){if(method!=='mediaCreate')return {};attempted();return new Promise<{created:boolean;callId:string}>(done=>{confirm=done;});}};
  const start=CallEncryption.start(signaling as never,{url:'http://127.0.0.1',token:'synthetic',userId:'synthetic'},'synthetic',{callId:null},()=>{});
  await createAttempted;
  const before={attached:attached.length,installed:installed.length};
  confirm({created:won,callId:won?'provisional':'winner'});
  const call=await start;
  const deadline=Date.now()+2000;while(installed.length===0&&Date.now()<deadline)await new Promise(done=>setTimeout(done,10));
  const after={installed:[...installed],attached:attached.length,closed:[...closed]};
  call.close();for(const port of sources.values())port.close();
  return {before,after};
 },won);
 expect(result.before).toEqual({attached:0,installed:0});
 expect(result.after).toEqual({installed:[won?'provisional':'winner'],attached:1,closed:won?[]:['1']});
});
