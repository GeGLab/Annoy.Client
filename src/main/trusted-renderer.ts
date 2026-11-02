import {app,type BrowserWindow} from 'electron';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
/** Match both WebContents/frame identity and the document executing the preload. */
export function trustedRenderer(event:Electron.IpcMainEvent|Electron.IpcMainInvokeEvent,window:BrowserWindow|null):boolean {
 if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)return false;
 try{
  const actual=new URL(event.senderFrame.url);
  if(!app.isPackaged&&process.env.ELECTRON_RENDERER_URL)return actual.origin===new URL(process.env.ELECTRON_RENDERER_URL).origin;
  const expected=pathToFileURL(join(import.meta.dirname,'../renderer/index.html'));
  return actual.protocol==='file:'&&actual.href.split(/[?#]/)[0]===expected.href;
 }catch{return false;}
}
