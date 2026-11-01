import {electron} from './fixtures/electron-launch.ts';
import {test,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {globalAuthFixture} from './fixtures/global-auth.ts';
const require=createRequire(import.meta.url);
test('legacy source is separate, paginated, read-only and attachments require authenticated preview',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'annoy-archive-ui-')),auth=await globalAuthFixture();
 const env={...process.env,ANNOY_GLOBAL_URL:auth.url,ANNOY_TEST_DATA:directory,ELECTRON_RENDERER_URL:'http://127.0.0.1:5178'};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({executablePath:require('electron'),args:[resolve('tests/fixtures/electron.cjs')],env}),page=await app.firstWindow();
 try{
  await auth.keepAuthenticated(page);
  // UI fixture only. The real crypto handler is exercised separately by
  // crypto-desktop/controller tests; no crypto assertion relies on this mock.
  await app.evaluate(({ipcMain})=>{
   for(const name of ['crypto:status','crypto:reconcile'])ipcMain.removeHandler(name);
   ipcMain.handle('crypto:status',()=>({ok:true,value:{active:true}}));
   ipcMain.handle('crypto:reconcile',()=>({ok:true,value:{items:[],deletedIds:[],newIds:[]}}));
  });
  const user={id:'me',username:'tester',displayName:'Legacy Author',avatarUrl:null};
  const file={id:'a'.repeat(32),filename:'legacy.txt',contentType:'text/plain',size:14,url:'/api/uploads/'+'a'.repeat(32)+'/legacy.txt'};
  const messages=Array.from({length:100},(_,i)=>({id:'old-'+String(i).padStart(3,'0'),channelId:'archive',author:user,content:'Legacy source '+i,protection:'legacy_plaintext',createdAt:'2026-01-01T00:00:00.000Z',editedAt:null,replyToId:null,mentionIds:[],mentionsEveryone:false,attachments:i===99?[file]:[]}));
  const pages=new Set<string>();let authenticated=false;
  await page.route('https://archive.test/api/**',route=>{
   const url=new URL(route.request().url());if(url.pathname.endsWith('/legacy/messages')){pages.add(url.searchParams.get('before')??'latest');return route.fulfill({contentType:'application/json',body:JSON.stringify({protection:'legacy_plaintext',items:url.searchParams.has('before')?messages.slice(0,50):messages.slice(50)})});}
   if(url.pathname.startsWith('/api/uploads/')){authenticated=route.request().headers().authorization==='Bearer synthetic';return route.fulfill({contentType:'text/plain',body:'legacy content'});}
   return route.fulfill({contentType:'application/json',body:'[]'});
  });
  await page.routeWebSocket('wss://archive.test/gateway',()=>{});
  await page.evaluate(async user=>{
   const {addAccount}=await import(location.origin+'/src/client.ts'),{setState}=await import(location.origin+'/src/store.ts');
   addAccount({id:'archive',url:'https://archive.test',userId:'me',token:'synthetic',instanceName:'Archive fixture'});
   setState((s:any)=>{
    const inst=s.instances.archive;inst.status='ready';inst.user=user;inst.dms=[{id:'archive',type:'dm',serverId:null,name:'Legacy',topic:'',parentId:null,position:0,overwrites:[],recipients:[{...user,id:'peer',displayName:'Peer'}]}];inst.messages.archive={items:[],hasMore:false,loading:false};
    s.view={kind:'home',accountId:'archive',dmId:'archive'};
   });
  },user);
  // Encryption tools live in Settings → Privacidade e segurança, never in the chat.
  await expect(page.getByRole('button',{name:'Arquivo legado',exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{const {setState}=await import(location.origin+'/src/store.ts');setState((s:any)=>{s.modal={kind:'userSettings',section:'security'};});});
  await page.getByRole('button',{name:'Ver histórico antigo',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Arquivo legado sem E2EE'});
  await expect(dialog.locator('article')).toHaveCount(50);await expect(dialog).toContainText('somente leitura');
  await dialog.getByRole('button',{name:'Mensagens legadas anteriores'}).click();await expect(dialog.locator('article')).toHaveCount(100);expect([...pages].sort()).toEqual(['latest','old-050']);
  await expect(dialog.getByRole('button',{name:'Editar',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Abrir anexo legado sem E2EE'}).click();
  await expect(dialog.getByRole('link',{name:'Salvar cópia',exact:true})).toHaveAttribute('href',/^blob:/);expect(authenticated).toBe(true);
  await dialog.getByRole('button',{name:'Fechar arquivo legado'}).click();await expect(dialog).toHaveCount(0);
 }finally{await app.close();await auth.close();await rm(directory,{recursive:true,force:true});}
});
