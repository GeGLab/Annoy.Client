import { test, expect } from '@playwright/test';
import { electron } from './fixtures/electron-launch.ts';
import { globalAuthFixture } from './fixtures/global-auth.ts';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require=createRequire(import.meta.url);
test.skip(!process.env.ANNOY_TEST_STEAM_LIVE, 'explicit live SteamProfiler smoke test');
test('live SteamProfiler through the desktop integration transport',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'annoy-steam-live-'));
 const auth=await globalAuthFixture();
 const env={...process.env, ANNOY_GLOBAL_URL:auth.url,ANNOY_TEST_DATA:dir,ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};
 delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:[resolve('tests/fixtures/electron.cjs')],env});
 try{
 const page=await app.firstWindow(); await auth.keepAuthenticated(page);
 const request={url:'https://steamprofiler.org/api/annoy',method:'POST' as const,headers:{'content-type':'application/json','user-agent':'Annoy-Integrations/1','x-annoy-integration':'steamprofiler'},body:JSON.stringify({v:1,command:'steam',text:'profile 76561198086380973',scope:'dm',locale:'pt-BR',invoker:{name:'Integration test'},settings:{}}),maxBytes:1024*1024,timeoutMs:30000};
 const result=await page.evaluate(async(input)=>{const r=await window.annoy!.integrations.request(input);return r.ok?{...r,body:new TextDecoder().decode(r.body)}:r;},request);
 expect(result.ok).toBe(true);
 if(result.ok){
   expect(result.status).toBe(200);
   const card=JSON.parse(result.body).images[0].url;
   const image=await page.evaluate(async(url)=>{const r=await window.annoy!.integrations.request({url,method:'GET',headers:{},maxBytes:8*1024*1024,timeoutMs:30000});return r.ok?{ok:true,status:r.status,type:r.type,size:r.body.length}:r;},card);
   expect(image).toMatchObject({ok:true,status:200,type:'image/png'});
 }
 }finally{await app.close();await auth.close();await rm(dir,{recursive:true,force:true});}
});
