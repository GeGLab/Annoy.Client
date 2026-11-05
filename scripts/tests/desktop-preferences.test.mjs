import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {desktopDefaults,normalizeDesktop,parseDesktop,localMainFrame} from '../../src/shared/desktop.ts';
import {xdgEntry,xdgAutostartPath,readXdgAutostart,setXdgAutostart,stableAppImage} from '../../src/main/autostart.ts';
import {singleFlight} from '../../src/shared/single-flight.ts';
import {writePreferences,readPreferences} from '../../src/main/settings-file.ts';
test('desktop defaults, strict IPC shape and saved-value migration',()=>{
 // New installs start with the system and close to the tray on every platform.
 for(const platform of ['win32','linux'])assert.deepEqual(desktopDefaults(platform),{hardwareAcceleration:true,startAtLogin:true,startMinimized:false,closeToTray:true});
 assert.equal(normalizeDesktop({hardwareAcceleration:false,startAtLogin:'true'},'win32').startAtLogin,true);assert.equal(normalizeDesktop({startAtLogin:false,closeToTray:false},'linux').closeToTray,false);
 for(const value of [null,[],{},'true',{...desktopDefaults('linux'),extra:true},{...desktopDefaults('linux'),hardwareAcceleration:0}])assert.throws(()=>parseDesktop(value));
 assert.deepEqual(parseDesktop(desktopDefaults('linux')),desktopDefaults('linux'));
 const frame={},contents={mainFrame:frame};assert.ok(localMainFrame({sender:contents,senderFrame:frame},contents));assert.ok(!localMainFrame({sender:{mainFrame:frame},senderFrame:frame},contents));assert.ok(!localMainFrame({sender:contents,senderFrame:{}},contents));assert.ok(!localMainFrame({sender:undefined,senderFrame:undefined},undefined));
});
test('XDG writes only its own entry, detects external disable and handles special paths',()=>{
 const root=mkdtempSync(join(tmpdir(),'annoy-xdg-'));try{
  const executable=join(root,'Permanent Apps','Annoy % $ ` .AppImage'),file=xdgAutostartPath(root,root);mkdirSync(join(root,'Permanent Apps'));writeFileSync(executable,'test');
  assert.equal(stableAppImage(undefined),false);assert.equal(stableAppImage('relative.AppImage'),false);
  assert.throws(()=>xdgEntry('relative.AppImage'));assert.throws(()=>xdgEntry('/opt/app\ninject'));
  assert.match(xdgEntry(executable),/%%/);assert.match(xdgEntry(executable),/--annoy-autostart/);
  setXdgAutostart(file,executable,true);assert.equal(readXdgAutostart(file,executable),true);
  writeFileSync(file,readFileSync(file,'utf8')+'Hidden=true\n');assert.equal(readXdgAutostart(file,executable),false);
  const other=join(root,'autostart','another.desktop');writeFileSync(other,'leave');setXdgAutostart(file,executable,false);assert.equal(existsSync(file),false);assert.equal(readFileSync(other,'utf8'),'leave');
  assert.throws(()=>setXdgAutostart(join(other,'annoy.desktop'),executable,true));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('failed persistence preserves the previous committed preferences',()=>{
 const root=mkdtempSync(join(tmpdir(),'annoy-atomic-'));try{
 const file=join(root,'desktop.json'),normalize=value=>normalizeDesktop(value,'win32');writePreferences(file,desktopDefaults('win32'));
 const blocked=join(root,'blocked');writeFileSync(blocked,'file');assert.throws(()=>writePreferences(join(blocked,'desktop.json'),{hardwareAcceleration:false}));assert.equal(readPreferences(file,normalize).hardwareAcceleration,true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('single-flight coalesces policy+feed, clears on failure and allows retry',async()=>{
 let runs=0,release;const check=singleFlight(async()=>{runs++;await new Promise(resolve=>{release=resolve;});if(runs===1)throw new Error('network');return 'available';});
 const a=check(),b=check();assert.equal(a,b);await Promise.resolve();release();await assert.rejects(a,/network/);assert.equal(runs,1);
 const c=check();await Promise.resolve();release();assert.equal(await c,'available');assert.equal(runs,2);
});
