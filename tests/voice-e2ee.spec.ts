import {electron} from './fixtures/electron-launch.ts';
import {test,expect,type ElectronApplication,type Page} from '@playwright/test';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
const require=createRequire(import.meta.url);

const freePort=()=>new Promise<number>((done,fail)=>{const server=createServer();server.once('error',fail);server.listen(0,'127.0.0.1',()=>{const {port}=server.address() as {port:number};server.close(()=>done(port));});});

/** SFrame header (RFC 9605 section 4.3): config byte, then KID and CTR when extended. */
function sframeHeader(bytes:Buffer):{kid:bigint;ctr:bigint;length:number}|null{
 if(bytes.length<1)return null;
 const c=bytes[0]!,x=c>>7,k=(c>>4)&7,y=(c>>3)&1,v=c&7;let at=1;
 const take=(n:number)=>{if(at+n>bytes.length)return null;let value=0n;for(let i=0;i<n;i++)value=(value<<8n)|BigInt(bytes[at+i]!);at+=n;return value;};
 const kid=x?take(k+1):BigInt(k);const ctr=y?take(v+1):BigInt(v);
 return kid===null||ctr===null?null:{kid,ctr,length:at};
}
/** Skips the VP8 RTP payload descriptor (RFC 7741); only the first packet of a frame starts it. */
function vp8Frame(payload:Buffer):Buffer|null{
 const b0=payload[0]!;if(!(b0&0x10)||(b0&0x07))return null;let at=1;
 if(b0&0x80){const b1=payload[at++]!;if(b1&0x80)at+=payload[at]!&0x80?2:1;if(b1&0x40)at++;if(b1&0x30)at++;}
 return payload.subarray(at);
}

// Real Electron clients, real mediasoup SFU, fake capture devices. Audio output is muted
// twice (Chromium switch and per WebContents): nothing reaches the speakers or headset.
test('two Electron clients hold an SFrame call through mediasoup; the SFU only forwards ciphertext',async()=>{
 test.setTimeout(150_000);
 const dir=await mkdtemp(join(tmpdir(),'annoy-voice-e2ee-'));
 const [port,voicePort]=[await freePort(),await freePort()];
 const backend=spawn(process.execPath,['--import','tsx','tests/fixtures/voice-desktop.ts'],{cwd:resolve(process.env.ANNOY_SERVER_TEST_ROOT??'../annoy-server'),env:{...process.env,ANNOY_ACCOUNT_MODE:'local',ANNOY_DATA_DIR:join(dir,'server'),ANNOY_PORT:String(port),ANNOY_HOST:'127.0.0.1',ANNOY_VOICE_PORT:String(voicePort),ANNOY_ANNOUNCED_IP:'127.0.0.1',ANNOY_ALLOWED_ORIGINS:'http://127.0.0.1:5178'},stdio:['ignore','pipe','pipe']});
 const clients:ElectronApplication[]=[];let stderr='';backend.stderr.on('data',b=>{stderr+=b.toString();});
 try{
  const info=await new Promise<{url:string;tap:string;alice:string;bob:string}>((done,fail)=>{
   const timer=setTimeout(()=>fail(new Error('Backend timeout: '+stderr)),20000);
   createInterface({input:backend.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.tap){clearTimeout(timer);done(value);}}catch{/* server log line */}});
   backend.once('exit',()=>{clearTimeout(timer);fail(new Error('Backend stopped: '+stderr));});
  });
  const pages:Page[]=[];
  for(const name of ['alice','bob'] as const){
   await mkdir(join(dir,name),{recursive:true});
   const env={...process.env,ANNOY_GLOBAL_URL:'http://127.0.0.1:1',ANNOY_TEST_DATA:join(dir,name),ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};delete env.ELECTRON_RUN_AS_NODE;
   const app=await electron.launch({executablePath:require('electron'),args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',resolve('tests/fixtures/electron.cjs')],env});clients.push(app);
   await app.evaluate(({app,webContents})=>{for(const contents of webContents.getAllWebContents())contents.setAudioMuted(true);app.on('web-contents-created',(_event,contents)=>contents.setAudioMuted(true));});
   const page=await app.firstWindow();pages.push(page);
   expect(await app.evaluate(({webContents})=>webContents.getAllWebContents().every(c=>c.isAudioMuted()))).toBe(true);
   await page.evaluate(async({url,token,name})=>{
    await window.distopic!.auth.local({id:name,url,token,userId:name});
    await window.distopic!.crypto.unlock('synthetic-local-vault-password-for-tests');
    await window.distopic!.crypto.guard(url,token,'voice',name);await window.distopic!.crypto.status(url,token,'voice');
   },{url:info.url,token:info[name],name});
  }
  const joinCall=(page:Page,name:'alice'|'bob')=>page.evaluate(async({url,token,name})=>{
   const origin=location.origin;
   const {Gateway}=await import(origin+'/src/gateway.ts');const {VoiceSession}=await import(origin+'/src/voice.ts');const {getState}=await import(origin+'/src/store.ts');
   const w=window as unknown as {voice?:InstanceType<typeof VoiceSession>;gateway?:InstanceType<typeof Gateway>;mediaEvents?:number};
   w.mediaEvents=0;
   await new Promise<void>((ready,fail)=>{
    w.gateway=new Gateway(url,token,event=>{if(event.t==='VOICE_MEDIA')w.mediaEvents!++;w.voice?.handleEvent(event);},status=>{if(status==='ready')ready();if(status==='invalid')fail(new Error('gateway rejected'));});
    w.gateway.connect();
   });
   const settings={...getState().settings,selfMute:false,selfDeaf:false};
   w.voice=new VoiceSession(w.gateway!,'voice',name,settings,()=>{},()=>{},name,{url,token,userId:name});
   await w.voice.start();
   await w.voice.startVideo('camera');
   return w.voice.encrypted;
  },{url:info.url,token:info[name],name});
  expect(await joinCall(pages[0]!,'alice')).toBe(true);
  expect(await joinCall(pages[1]!,'bob')).toBe(true);
  const stats=(page:Page)=>page.evaluate(async()=>(window as unknown as {voice:{mediaStats():Promise<{sealed:number;opened:number;dropped:Record<string,number>;epoch:string|null}>}}).voice.mediaStats());
  // Both directions decrypt: frames sealed by one worker open in the other.
  await expect.poll(async()=>{const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];return Math.min(a.sealed,a.opened,b.sealed,b.opened);},{timeout:45_000}).toBeGreaterThan(200);
  const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];
  expect(a.epoch).toBe('1');expect(b.epoch).toBe('1');
  expect((a.dropped.rejected??0)+(b.dropped.rejected??0)+(a.dropped.replay??0)+(b.dropped.replay??0)).toBe(0);
  // The decoder renders the remote camera: VP8 still packetizes and decodes after SFrame.
  const rendered=await pages[1]!.evaluate(async()=>{
   const {videoTiles}=await import(location.origin+'/src/media.ts');
   const deadline=Date.now()+20000;let tile;while(!(tile=videoTiles().find(t=>!t.local))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
   if(!tile)return {frames:0,width:0};
   const video=document.createElement('video');video.muted=true;video.srcObject=tile.stream;document.body.append(video);await video.play();
   let frames=0;await new Promise<void>(done=>{const tick=()=>{frames++;if(frames>=30)done();else video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);setTimeout(done,15000);});
   const width=video.videoWidth;video.remove();return {frames,width};
  });
  expect(rendered.frames).toBeGreaterThanOrEqual(30);expect(rendered.width).toBeGreaterThan(0);
  // What the SFU forwards: SFrame headers whose KID encodes stream context, sender leaf and epoch.
  const tapped=await (await fetch(info.tap)).json() as {source:string;kind:string;payloads:string[]}[];
  for(const source of ['mic','camera']){
   const streams=tapped.filter(t=>t.source===source);expect(streams).toHaveLength(2);
   const senders=new Set<bigint>();
   for(const stream of streams){
    const counters=new Map<bigint,bigint>();let parsed=0;
    for(const hex of stream.payloads){
     const payload=Buffer.from(hex,'hex');
     let frame:Buffer|null=payload;
     if(source==='camera'){frame=vp8Frame(payload);if(!frame)continue;frame=frame.subarray((frame[0]!&1)===0?10:3);}
     const header=sframeHeader(frame);expect(header).not.toBeNull();
     const {kid,ctr}=header!;const context=kid>>24n,index=(kid>>8n)&0xffffn,epoch=kid&0xffn;
     if(epoch===0n)continue; // the creator's frames before the second device joined
     expect(context).toBe(source==='mic'?0n:1n);expect(epoch).toBe(1n);expect(index).toBeLessThan(2n);senders.add(index);
     const last=counters.get(kid);if(last!==undefined&&source==='mic')expect(ctr).toBeGreaterThan(last);
     counters.set(kid,ctr);parsed++;
    }
    expect(parsed).toBeGreaterThan(20);
   }
   expect([...senders].sort()).toEqual([0n,1n]);
  }
  // Leaving rotates the epoch: the remaining member removes the departed device.
  await pages[0]!.evaluate(()=>{const w=window as unknown as {voice:{close():void};gateway:{close():void}};w.voice.close();});
  await expect.poll(async()=>(await stats(pages[1]!)).epoch,{timeout:20_000}).toBe('2');
  const roster=await pages[1]!.evaluate(async()=>{const w=window as unknown as {voice:{crypt:{roster():Promise<{userId:string}[]>}}};return (await w.voice.crypt.roster()).map(r=>r.userId);});
  expect(roster).toEqual(['bob']);
  // The renderer never holds an export command for MLS media keys.
  expect(await pages[1]!.evaluate(()=>['mediaKey','media_base_key','command','baseKey'].some(name=>name in window.distopic!.media!))).toBe(false);
  await pages[1]!.evaluate(()=>{const w=window as unknown as {voice:{close():void};gateway:{close():void}};w.voice.close();w.gateway.close();});
 }finally{
  for(const client of clients)await client.close().catch(()=>undefined);
  // Windows keeps the database locked until the server process has exited.
  if(backend.exitCode===null){const exited=new Promise(done=>backend.once('exit',done));backend.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true,maxRetries:5});
 }
});

/** Real Cloudflare Realtime SFU, only when credentials are provided (ANNOY_TEST_CLOUDFLARE_ENV=path to an env file). */
function cloudflareEnv():Record<string,string>|null{
 const file=process.env.ANNOY_TEST_CLOUDFLARE_ENV;if(!file)return null;
 const values:Record<string,string>={};
 for(const line of readFileSync(file,'utf8').split('\n')){const match=/^(ANNOY_CF_SFU_APP_ID|ANNOY_CF_SFU_APP_TOKEN)=(.*)$/.exec(line.trim());if(match)values[match[1]!]=match[2]!.replace(/^["']|["']$/g,'');}
 return values.ANNOY_CF_SFU_APP_ID&&values.ANNOY_CF_SFU_APP_TOKEN?{...values,ANNOY_VOICE_BACKEND:'cloudflare'}:null;
}
test('two Electron clients hold an SFrame call through the real Cloudflare Realtime SFU',async()=>{
 const cloudflare=cloudflareEnv();test.skip(!cloudflare,'Cloudflare credentials not provided');
 test.setTimeout(150_000);
 const dir=await mkdtemp(join(tmpdir(),'annoy-voice-e2ee-'));
 const [port,voicePort]=[await freePort(),await freePort()];
 const backend=spawn(process.execPath,['--import','tsx','tests/fixtures/voice-desktop.ts'],{cwd:resolve(process.env.ANNOY_SERVER_TEST_ROOT??'../annoy-server'),env:{...process.env,ANNOY_ACCOUNT_MODE:'local',ANNOY_DATA_DIR:join(dir,'server'),ANNOY_PORT:String(port),ANNOY_HOST:'127.0.0.1',ANNOY_VOICE_PORT:String(voicePort),ANNOY_ANNOUNCED_IP:'127.0.0.1',ANNOY_ALLOWED_ORIGINS:'http://127.0.0.1:5178',...cloudflare},stdio:['ignore','pipe','pipe']});
 const clients:ElectronApplication[]=[];let stderr='';backend.stderr.on('data',b=>{stderr+=b.toString();});
 try{
  const info=await new Promise<{url:string;tap:string;alice:string;bob:string}>((done,fail)=>{
   const timer=setTimeout(()=>fail(new Error('Backend timeout: '+stderr)),20000);
   createInterface({input:backend.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.tap){clearTimeout(timer);done(value);}}catch{/* server log line */}});
   backend.once('exit',()=>{clearTimeout(timer);fail(new Error('Backend stopped: '+stderr));});
  });
  const pages:Page[]=[];
  for(const name of ['alice','bob'] as const){
   await mkdir(join(dir,name),{recursive:true});
   const env={...process.env,ANNOY_GLOBAL_URL:'http://127.0.0.1:1',ANNOY_TEST_DATA:join(dir,name),ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};delete env.ELECTRON_RUN_AS_NODE;
   const app=await electron.launch({executablePath:require('electron'),args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',resolve('tests/fixtures/electron.cjs')],env});clients.push(app);
   await app.evaluate(({app,webContents})=>{for(const contents of webContents.getAllWebContents())contents.setAudioMuted(true);app.on('web-contents-created',(_event,contents)=>contents.setAudioMuted(true));});
   const page=await app.firstWindow();pages.push(page);
   expect(await app.evaluate(({webContents})=>webContents.getAllWebContents().every(c=>c.isAudioMuted()))).toBe(true);
   await page.evaluate(async({url,token,name})=>{
    await window.distopic!.auth.local({id:name,url,token,userId:name});
    await window.distopic!.crypto.unlock('synthetic-local-vault-password-for-tests');
    await window.distopic!.crypto.guard(url,token,'voice',name);await window.distopic!.crypto.status(url,token,'voice');
   },{url:info.url,token:info[name],name});
  }
  const joinCall=(page:Page,name:'alice'|'bob')=>page.evaluate(async({url,token,name})=>{
   const origin=location.origin;
   const {Gateway}=await import(origin+'/src/gateway.ts');const {CloudflareVoiceSession:VoiceSession}=await import(origin+'/src/voice-cloudflare.ts');const {getState}=await import(origin+'/src/store.ts');
   const w=window as unknown as {voice?:InstanceType<typeof VoiceSession>;gateway?:InstanceType<typeof Gateway>;mediaEvents?:number};
   w.mediaEvents=0;
   await new Promise<void>((ready,fail)=>{
    w.gateway=new Gateway(url,token,event=>{if(event.t==='VOICE_MEDIA')w.mediaEvents!++;w.voice?.handleEvent(event);},status=>{if(status==='ready')ready();if(status==='invalid')fail(new Error('gateway rejected'));});
    w.gateway.connect();
   });
   const settings={...getState().settings,selfMute:false,selfDeaf:false};
   w.voice=new VoiceSession(w.gateway!,'voice',name,settings,()=>{},()=>{},name,{url,token,userId:name});
   await w.voice.start();
   await w.voice.startVideo('camera');
   return w.voice.encrypted;
  },{url:info.url,token:info[name],name});
  expect(await joinCall(pages[0]!,'alice')).toBe(true);
  expect(await joinCall(pages[1]!,'bob')).toBe(true);
  const stats=(page:Page)=>page.evaluate(async()=>(window as unknown as {voice:{mediaStats():Promise<{sealed:number;opened:number;dropped:Record<string,number>;epoch:string|null}>}}).voice.mediaStats());
  // Both directions decrypt: frames sealed by one worker open in the other.
  await expect.poll(async()=>{const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];return Math.min(a.sealed,a.opened,b.sealed,b.opened);},{timeout:45_000}).toBeGreaterThan(200);
  const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];
  expect(a.epoch).toBe('1');expect(b.epoch).toBe('1');
  expect((a.dropped.rejected??0)+(b.dropped.rejected??0)+(a.dropped.replay??0)+(b.dropped.replay??0)).toBe(0);
  // The decoder renders the remote camera: VP8 still packetizes and decodes after SFrame.
  const rendered=await pages[1]!.evaluate(async()=>{
   const {videoTiles}=await import(location.origin+'/src/media.ts');
   const deadline=Date.now()+20000;let tile;while(!(tile=videoTiles().find(t=>!t.local))&&Date.now()<deadline)await new Promise(r=>setTimeout(r,200));
   if(!tile)return {frames:0,width:0};
   const video=document.createElement('video');video.muted=true;video.srcObject=tile.stream;document.body.append(video);await video.play();
   let frames=0;await new Promise<void>(done=>{const tick=()=>{frames++;if(frames>=30)done();else video.requestVideoFrameCallback(tick);};video.requestVideoFrameCallback(tick);setTimeout(done,15000);});
   const width=video.videoWidth;video.remove();return {frames,width};
  });
  expect(rendered.frames).toBeGreaterThanOrEqual(30);expect(rendered.width).toBeGreaterThan(0);
  // Frames crossed Cloudflare and still authenticate: the SFU forwarded SFrame unmodified and never had the keys.
  // Leaving rotates the epoch: the remaining member removes the departed device.
  await pages[0]!.evaluate(()=>{const w=window as unknown as {voice:{close():void};gateway:{close():void}};w.voice.close();});
  await expect.poll(async()=>(await stats(pages[1]!)).epoch,{timeout:20_000}).toBe('2');
  const roster=await pages[1]!.evaluate(async()=>{const w=window as unknown as {voice:{crypt:{roster():Promise<{userId:string}[]>}}};return (await w.voice.crypt.roster()).map(r=>r.userId);});
  expect(roster).toEqual(['bob']);
  // The renderer never holds an export command for MLS media keys.
  expect(await pages[1]!.evaluate(()=>['mediaKey','media_base_key','command','baseKey'].some(name=>name in window.distopic!.media!))).toBe(false);
  await pages[1]!.evaluate(()=>{const w=window as unknown as {voice:{close():void};gateway:{close():void}};w.voice.close();w.gateway.close();});
 }finally{
  for(const client of clients)await client.close().catch(()=>undefined);
  // Windows keeps the database locked until the server process has exited.
  if(backend.exitCode===null){const exited=new Promise(done=>backend.once('exit',done));backend.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true,maxRetries:5});
 }
});

test('a private call between two Electron clients is sealed with SFrame end to end',async()=>{
 test.setTimeout(150_000);
 const dir=await mkdtemp(join(tmpdir(),'annoy-call-e2ee-'));
 const [port,voicePort]=[await freePort(),await freePort()];
 const backend=spawn(process.execPath,['--import','tsx','tests/fixtures/voice-desktop.ts'],{cwd:resolve(process.env.ANNOY_SERVER_TEST_ROOT??'../annoy-server'),env:{...process.env,ANNOY_ACCOUNT_MODE:'local',ANNOY_DATA_DIR:join(dir,'server'),ANNOY_PORT:String(port),ANNOY_HOST:'127.0.0.1',ANNOY_VOICE_PORT:String(voicePort),ANNOY_ANNOUNCED_IP:'127.0.0.1',ANNOY_ALLOWED_ORIGINS:'http://127.0.0.1:5178'},stdio:['ignore','pipe','pipe']});
 const clients:ElectronApplication[]=[];let stderr='';backend.stderr.on('data',b=>{stderr+=b.toString();});
 try{
  const info=await new Promise<{url:string;alice:string;bob:string}>((done,fail)=>{
   const timer=setTimeout(()=>fail(new Error('Backend timeout: '+stderr)),20000);
   createInterface({input:backend.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.tap){clearTimeout(timer);done(value);}}catch{/* server log line */}});
   backend.once('exit',()=>{clearTimeout(timer);fail(new Error('Backend stopped: '+stderr));});
  });
  const pages:Page[]=[];
  for(const name of ['alice','bob'] as const){
   await mkdir(join(dir,name),{recursive:true});
   const env={...process.env,ANNOY_GLOBAL_URL:'http://127.0.0.1:1',ANNOY_TEST_DATA:join(dir,name),ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};delete env.ELECTRON_RUN_AS_NODE;
   const app=await electron.launch({executablePath:require('electron'),args:['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',resolve('tests/fixtures/electron.cjs')],env});clients.push(app);
   await app.evaluate(({app,webContents})=>{for(const contents of webContents.getAllWebContents())contents.setAudioMuted(true);app.on('web-contents-created',(_event,contents)=>contents.setAudioMuted(true));});
   const page=await app.firstWindow();pages.push(page);
   await page.evaluate(async({url,token,name})=>{
    await window.distopic!.auth.local({id:name,url,token,userId:name});
    await window.distopic!.crypto.unlock('synthetic-local-vault-password-for-tests');
    await window.distopic!.crypto.guard(url,token,'voice',name);await window.distopic!.crypto.status(url,token,'voice');
    const {addAccount}=await import(location.origin+'/src/client.ts');
    addAccount({id:name,url,token,userId:name,instanceName:'Chamadas cifradas'});
   },{url:info.url,token:info[name],name});
  }
  await expect.poll(()=>pages[0]!.evaluate(async()=>(await import(location.origin+'/src/store.ts')).getState().instances.alice?.status)).toBe('ready');
  await expect.poll(()=>pages[1]!.evaluate(async()=>(await import(location.origin+'/src/store.ts')).getState().instances.bob?.status)).toBe('ready');
  await pages[0]!.evaluate(async()=>{const {startDirectCall}=await import(location.origin+'/src/features/direct-calls.ts');await startDirectCall('alice','bob',true);});
  // No transport-only consent is asked: the call is end-to-end encrypted.
  await expect(pages[0]!.getByRole('alertdialog')).toHaveCount(0);
  await expect(pages[1]!.getByRole('dialog',{name:'Chamada recebida',exact:true})).toBeVisible({timeout:20_000});
  await pages[1]!.getByRole('button',{name:'Atender',exact:true}).click();
  await expect(pages[1]!.getByRole('alertdialog')).toHaveCount(0);
  const stats=(page:Page)=>page.evaluate(async()=>(await import(location.origin+'/src/features/direct-calls.ts')).directCallStats());
  await expect.poll(async()=>{const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];return Math.min(a?.sealed??0,a?.opened??0,b?.sealed??0,b?.opened??0);},{timeout:45_000}).toBeGreaterThan(200);
  const [a,b]=[await stats(pages[0]!),await stats(pages[1]!)];
  expect(a!.epoch).toBe('1');expect(b!.epoch).toBe('1');
  // No frame fails authentication. The P2P stack occasionally delivers a frame twice
  // (redundant audio after loss); anti-replay discards that copy, as RFC 9605 9.3 requires.
  expect((a!.dropped.rejected??0)+(b!.dropped.rejected??0)).toBe(0);
  expect((a!.dropped.replay??0)+(b!.dropped.replay??0)).toBeLessThanOrEqual(Math.ceil((a!.opened+b!.opened)/100));
  for(const page of pages){
   expect((await page.evaluate(async()=>(await import(location.origin+'/src/store.ts')).getState().directCall?.call.protection))).toBe('sframe');
   await expect.poll(()=>page.locator('.direct-call-video video').first().evaluate((video:HTMLVideoElement)=>video.videoWidth),{timeout:20_000}).toBeGreaterThan(0);
  }
  await pages[0]!.evaluate(async()=>{const {callAction}=await import(location.origin+'/src/features/direct-calls.ts');await callAction('end');});
  await expect.poll(()=>pages[1]!.evaluate(async()=>(await import(location.origin+'/src/features/direct-calls.ts')).directCallEncrypted())).toBe(false);
 }finally{
  for(const client of clients)await client.close().catch(()=>undefined);
  // Windows keeps the database locked until the server process has exited.
  if(backend.exitCode===null){const exited=new Promise(done=>backend.once('exit',done));backend.kill('SIGTERM');await exited;}
  await rm(dir,{recursive:true,force:true,maxRetries:5});
 }
});
