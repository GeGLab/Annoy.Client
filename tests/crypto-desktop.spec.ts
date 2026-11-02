import {serverRoot} from './fixtures/server-root.ts';
import {electron} from './fixtures/electron-launch.ts';
import {test,expect,type ElectronApplication} from '@playwright/test';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
const require=createRequire(import.meta.url);
test('real Electron clients exchange MLS, attachments and edits; external IPC cannot use their vault',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'annoy-desktop-crypto-'));
 const backend=spawn(process.execPath,['--import','tsx','tests/fixtures/crypto-desktop.ts'],{cwd:serverRoot(),env:{...process.env,ANNOY_ACCOUNT_MODE:'local',ANNOY_DATA_DIR:join(dir,'server')},stdio:['ignore','pipe','pipe']});
 const clients:ElectronApplication[]=[];let stderr='';backend.stderr.on('data',b=>{stderr+=b.toString();});
 try{
  const info=await new Promise<{url:string;alice:string;bob:string}>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Backend timeout: '+stderr)),15000);
   createInterface({input:backend.stdout}).once('line',line=>{clearTimeout(timer);try{resolve(JSON.parse(line));}catch{reject(new Error('Invalid fixture output'));}});
   backend.once('error',reject);backend.once('exit',()=>{clearTimeout(timer);reject(new Error('Backend stopped: '+stderr));});
  });
  const pages=[];
  for(const name of ['alice','bob'] as const){
   await mkdir(join(dir,name),{recursive:true});
   const env={...process.env,ANNOY_GLOBAL_URL:'http://127.0.0.1:1',ANNOY_TEST_DATA:join(dir,name),ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};delete env.ELECTRON_RUN_AS_NODE;
   const app=await electron.launch({executablePath:require('electron'),args:[resolve('tests/fixtures/electron.cjs')],env});clients.push(app);
   const page=await app.firstWindow();pages.push(page);
   await app.evaluate(async({session},url)=>{
    for(const target of [session.defaultSession,session.fromPartition('annoy-native-api',{cache:false})])
     await target.cookies.set({url,name:'synthetic-browser-cookie',value:'must-never-reach-native-api'});
   },info.url);
   await page.evaluate(async({url,token,name})=>window.distopic!.auth.local({id:name,url,token,userId:name}),{url:info.url,token:info[name],name});
   await app.evaluate(({dialog})=>{dialog.showMessageBox=async(...args:any[])=>{const options=args.at(-1);if(options.message!=='Autorizar estes participantes criptográficos?'||!options.detail.includes('alice')||!options.detail.includes('bob'))throw new Error('Unexpected consent request');return {response:1,checkboxChecked:false};};});
   await page.evaluate(async({url,token,name})=>{await window.distopic!.crypto.unlock('synthetic-local-vault-password-for-tests');await window.distopic!.crypto.guard(url,token,'private',name);await window.distopic!.crypto.status(url,token,'private');},{url:info.url,token:info[name],name});
  }
  for(let i=0;i<pages.length;i++)await pages[i]!.evaluate(async({url,token})=>window.distopic!.crypto.authorize(url,token,'private'),{url:info.url,token:i===0?info.alice:info.bob});
  const message=await pages[0]!.evaluate(async({url,token})=>window.distopic!.crypto.send(url,token,'private','electron private canary',null,[{name:'secret-name.txt',type:'text/plain',bytes:new TextEncoder().encode('electron file canary').buffer}]),{url:info.url,token:info.alice});
  const received=await pages[1]!.evaluate(async({url,token})=>window.distopic!.crypto.sync(url,token,'private'),{url:info.url,token:info.bob});
  expect(received[0]!.content).toBe('electron private canary');expect(received[0]!.attachments[0]).not.toHaveProperty('fileKey');
  const bytes=await pages[1]!.evaluate(async({url,token,id,file})=>{const result=await window.distopic!.crypto.attachment(url,token,'private',id,file);return new TextDecoder().decode(result.bytes);},{url:info.url,token:info.bob,id:message.id,file:message.attachments[0]!.id});expect(bytes).toBe('electron file canary');
  await pages[0]!.evaluate(async({url,token,id})=>window.distopic!.crypto.action(url,token,'private','edit',id,'edited in Electron'),{url:info.url,token:info.alice,id:message.id});
  expect((await pages[1]!.evaluate(async({url,token})=>window.distopic!.crypto.sync(url,token,'private'),{url:info.url,token:info.bob}))[0]!.content).toBe('edited in Electron');
  const result=await clients[0]!.evaluate(async({BrowserWindow},preload)=>{
   const primary=BrowserWindow.getAllWindows()[0]!,prefs=primary.webContents.getLastWebPreferences();
   const external=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload}});
   try{await external.loadURL('data:text/html,<title>untrusted external content</title>');return await external.webContents.executeJavaScript(`(async()=>{try{await window.distopic.crypto.unlock('attacker');return 'BYPASS';}catch(e){return e.message;}})()`);}finally{external.destroy();}
  },resolve('out/preload/index.cjs'));expect(result).toContain('IPC não autorizado');
  const prefs=await clients[0]!.evaluate(({BrowserWindow})=>{const p=BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();return {sandbox:p.sandbox,contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration};});
  expect(prefs).toEqual({sandbox:true,contextIsolation:true,nodeIntegration:false});
  expect(await pages[0]!.evaluate(()=>['mediaKey','media_base_key','command'].some(name=>name in window.distopic!.crypto))).toBe(false);
  let plaintextMutations=0;
  await pages[0]!.route(info.url+'/api/channels/legacy/crypto',route=>route.fulfill({contentType:'application/json',body:'{"channel":null}'}));
  await pages[0]!.route(info.url+'/api/channels/legacy/messages**',route=>{plaintextMutations++;return route.fulfill({contentType:'application/json',body:'{}'});});
  const rejected=await pages[0]!.evaluate(async({url,token})=>{
   const {Api}=await import(location.origin+'/src/api.ts');const api=new Api(url,token,()=>true,undefined,'alice'),errors=[];
   for(const operation of [()=>api.post('/channels/legacy/messages',{content:'must never reach server in plaintext'}),()=>api.patch('/channels/legacy/messages/old',{content:'must never reach server in plaintext'}),()=>api.put('/channels/legacy/messages/old/reactions/👍',{})]){
    try{await operation();errors.push('BYPASS');}catch(error){errors.push((error as Error).message);}
   }return errors;
  },{url:info.url,token:info.alice});
  expect(rejected).toHaveLength(3);expect(rejected.every(message=>message.includes('MLS'))).toBe(true);expect(plaintextMutations).toBe(0);
  let insecureRequests=0;
  await pages[0]!.route('http://unsafe.test/**',route=>{insecureRequests++;return route.abort();});
  const tls=await pages[0]!.evaluate(async()=>{
   const {authenticate}=await import(location.origin+'/src/api.ts');const {Gateway}=await import(location.origin+'/src/gateway.ts');const errors:string[]=[],statuses:string[]=[];
   try{await authenticate('http://unsafe.test','login',{username:'synthetic',password:'must not be sent'});}catch(error){errors.push((error as Error).message);}
   try{await window.distopic!.auth.local({id:'unsafe',url:'http://unsafe.test',token:'must not be sent',userId:'unsafe'});}catch(error){errors.push((error as Error).message);}
   const gateway=new Gateway('http://unsafe.test','must not be sent',()=>{},status=>statuses.push(status));gateway.connect();gateway.close();
   return {errors,statuses};
  });
  expect(tls.errors).toHaveLength(2);expect(tls.errors.every(message=>message.includes('HTTPS'))).toBe(true);expect(tls.statuses).toContain('offline');expect(insecureRequests).toBe(0);
  // Actual native API cancellation, including requests whose response never
  // arrives. No IPC mocks, uncaught-error suppression or forced application exit.
  let held:()=>void=()=>{},redirect=false,sinkRequests=0;
  const stalled=createServer((request,response)=>{
   if(request.url==='/api/info'){
    if(redirect){response.writeHead(303,{location:'/credential-sink'});response.end();}else held();
   }else if(request.url==='/api/users/@me'){response.setHeader('content-type','application/json');response.end('{"id":"alice"}');}
   else {sinkRequests++;response.end('{}');}
  });
  await new Promise<void>(resolve=>stalled.listen(0,'127.0.0.1',resolve));
  const stalledUrl='http://127.0.0.1:'+(stalled.address() as {port:number}).port;
  try{
   for(let attempt=0;attempt<3;attempt++){
    await pages[0]!.evaluate(async({url,origin,token})=>{await window.distopic!.crypto.unlock('synthetic-local-vault-password-for-tests');await window.distopic!.auth.local({id:'alice',url:origin,token,userId:'alice'});await window.distopic!.crypto.guard(url,'synthetic-cancellation-token','cancel','alice');},{url:stalledUrl,origin:info.url,token:info.alice});
    const arrived=new Promise<void>(resolve=>{held=resolve;});
    const pending=pages[0]!.evaluate(url=>window.distopic!.crypto.status(url,'synthetic-cancellation-token','cancel'),stalledUrl).then(()=>false,()=>true);
    await arrived;
    await pages[0]!.evaluate(()=>window.distopic!.auth.logoutLocal('alice'));
    expect(await pending).toBe(true);
    expect(await clients[0]!.evaluate(()=>process.pid)).toBeGreaterThan(0);
   }
   redirect=true;
   await expect(pages[0]!.evaluate(url=>window.distopic!.auth.local({id:'redirect',url,token:'synthetic-cancellation-token',userId:'alice'}),stalledUrl)).rejects.toThrow();
   expect(sinkRequests).toBe(0);
  }finally{stalled.closeAllConnections();await new Promise<void>(resolve=>stalled.close(()=>resolve()));}
  const navigated=await clients[0]!.evaluate(async({BrowserWindow})=>{
   const primary=BrowserWindow.getAllWindows()[0]!;
   await primary.loadURL('data:text/html,<title>untrusted navigation</title>');
   return primary.webContents.executeJavaScript(`(async()=>{const errors=[];for(const operation of [()=>window.distopic.crypto.unlock('attacker'),()=>window.distopic.activity.get(),()=>window.distopic.activity.configure({games:true}),()=>window.distopic.activity.gameIcon('570')]){try{await operation();errors.push('BYPASS');}catch(e){errors.push(e.message);}}return errors;})()`);
  });expect(navigated).toHaveLength(4);expect(navigated[0]).toContain('IPC não autorizado');expect(navigated.slice(1).every((message:string)=>message.includes('Invalid activity sender'))).toBe(true);
 }finally{for(const app of clients)await app.close();backend.kill('SIGTERM');await new Promise<void>(resolve=>{if(backend.exitCode!==null)return resolve();backend.once('exit',()=>resolve());setTimeout(()=>{backend.kill('SIGKILL');resolve();},3000).unref();});await rm(dir,{recursive:true,force:true});}
});
