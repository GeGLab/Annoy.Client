import {t as translate} from "../shared/localization/index.ts";
import {trustedRenderer} from './trusted-renderer.ts';
// Regular updates ask first; critical security releases download and restart automatically.
import { app, ipcMain, powerMonitor,Notification, type BrowserWindow } from "electron";
import {join} from "node:path";
import {readPreferences,writePreferences} from "./settings-file.ts";
import {singleFlight} from "../shared/single-flight.ts";
import updaterPkg from "electron-updater";
import { blockingAdvisory, type Advisory } from "../shared/update.ts";
import { createUpdateController } from "./update-controller.ts";
import {UPDATE_TRUST} from './update-trust.ts';
import {authenticateUpdate,fetchUpdateManifest,matchUpdateMetadata,verifyUpdateFile,type SignedUpdate} from './update-signature.ts';

const { autoUpdater } = updaterPkg;
const POLICY_URL = process.env.ANNOY_UPDATE_POLICY_URL || "https://raw.githubusercontent.com/GeGLab/annoy-client/main/security/advisories.json";
const CHECK_EVERY_MS = 6*60*60*1000;

function updatable(): boolean {
  if (!app.isPackaged && !process.env.ANNOY_UPDATE_FEED) return false;
  if (process.platform === "linux" && !process.env.APPIMAGE) return false;
  return process.platform === "linux" || process.platform === "win32";
}

async function loadAdvisory(): Promise<Advisory | null> {
  try {
    const res = await fetch(POLICY_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { advisories?: Advisory[] };
    return blockingAdvisory(Array.isArray(body.advisories) ? body.advisories : [], app.getVersion());
  } catch { return null; }
}

export function startUpdater(window: BrowserWindow): void {
  const preferencesFile=join(app.getPath("userData"),"updates.json");
  let notifications=readPreferences(preferencesFile,value=>!!value&&typeof value==="object"&&"notifications"in value&&typeof value.notifications==="boolean"?value.notifications:true);
  const notified=new Set<string>();
  const notify=(version:string)=>{if(!notifications||notified.has(version)||!Notification.isSupported())return;try{const notice=new Notification({title:translate("update.notificationTitle"),body:translate("update.notificationBody",{p0:version})});notice.on("click",()=>{window.show();if(window.isMinimized())window.restore();window.focus();});notice.show();notified.add(version);}catch{}};
  let verified:{path:string;manifest:SignedUpdate}|null=null,exiting=false;
  autoUpdater.autoDownload = false;
  // Never let the updater install a cached artifact before our independent
  // signature verification, including the automatic install-on-quit path.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  if (process.env.ANNOY_UPDATE_FEED) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.ANNOY_UPDATE_FEED });
  }
  const controller = createUpdateController({
    currentVersion: app.getVersion(), updatable, loadAdvisory,
    checkForUpdates: async () => (await autoUpdater.checkForUpdates())?.updateInfo.version ?? null,
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    install: async () => {
      if(!verified)throw new Error(translate("common.e107229013aa"));
      await verifyUpdateFile(verified.path,verified.manifest);
      exiting=true;autoUpdater.quitAndInstall(false,true);
    },
    publish: state => { if (!window.isDestroyed()) window.webContents.send("update:state", state);if(state.status==="available")notify(state.version); },
  });
  const check=singleFlight(()=>controller.check());
  const policyCheck=()=>void controller.check({policyOnly:true});
  autoUpdater.on("download-progress", p => controller.progress(p.percent));
  autoUpdater.on("update-downloaded", info => {
    verified=null;autoUpdater.autoInstallOnAppQuit=false;
    void (async()=>{
      const expected={version:info.version,platform:process.platform,arch:process.arch};
      const base=process.env.ANNOY_UPDATE_FEED||`https://github.com/GeGLab/annoy-client/releases/download/v${info.version}/`;
      const manifest=authenticateUpdate(await fetchUpdateManifest(base,expected),UPDATE_TRUST,expected);
      matchUpdateMetadata(manifest,info);await verifyUpdateFile(info.downloadedFile,manifest);
      verified={path:info.downloadedFile,manifest};controller.downloaded(info.version);
    })().catch(()=>controller.error(new Error(translate("common.61ff88422613"))));
  });
  app.on('before-quit',event=>{
    if(exiting||!verified)return;
    event.preventDefault();
    void verifyUpdateFile(verified.path,verified.manifest).then(()=>{
      exiting=true;autoUpdater.autoInstallOnAppQuit=true;app.quit();
    }).catch(()=>{
      verified=null;exiting=true;autoUpdater.autoInstallOnAppQuit=false;app.quit();
    });
  });
  autoUpdater.on("error", err => controller.error(err));
  const trusted=(event:Electron.IpcMainInvokeEvent)=>trustedRenderer(event,window);
  ipcMain.handle("update:get", event => {if(!trusted(event))throw new Error("Invalid update IPC sender");return controller.getState();});
  ipcMain.handle("update:configure",(event,values:unknown)=>{if(!trusted(event))throw new Error("Invalid update IPC sender");if(!values||typeof values!=="object"||!("notifications"in values)||typeof values.notifications!=="boolean")throw new Error("Invalid update preferences");if(values.notifications!==notifications)writePreferences(preferencesFile,{notifications:values.notifications});notifications=values.notifications;});
  ipcMain.handle("update:check", event => {if(!trusted(event))throw new Error("Invalid update IPC sender");return check();});
  ipcMain.handle("update:download", event => {if(!trusted(event))throw new Error("Invalid update IPC sender");return controller.download();});
  ipcMain.handle("update:install", event => {if(!trusted(event))throw new Error("Invalid update IPC sender");return controller.install();});
  let initial:ReturnType<typeof setTimeout>|undefined;
  window.webContents.once("did-finish-load", () => {initial=setTimeout(()=>void check(),5000);initial.unref();});
  window.on("focus",policyCheck);
  powerMonitor.on("resume",policyCheck);
  const regular=setInterval(()=>void check(),CHECK_EVERY_MS);regular.unref();
  // Preserve the current security branch's minute/focus/resume policy checks.
  const security=setInterval(policyCheck,60_000);security.unref();
  window.once("closed",()=>{clearTimeout(initial);clearInterval(regular);clearInterval(security);powerMonitor.off("resume",policyCheck);});
}
