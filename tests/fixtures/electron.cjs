const { app } = require("electron");
app.setPath("userData", process.env.DISTOPIC_TEST_DATA);
app.getVersion=()=>require("../../package.json").version;
// Explicit test-only instrumentation: the real downloader runs, installers never execute.
if(process.env.ANNOY_TEST_UPDATE_CONFIG){
  const electron=require("electron");
  global.annoyTestNotifications=[];global.annoyTestInstalls=0;
  electron.Notification.prototype.show=function(){global.annoyTestNotifications.push({title:this.title,body:this.body});};
  const {autoUpdater}=require("electron-updater");
  autoUpdater.updateConfigPath=process.env.ANNOY_TEST_UPDATE_CONFIG;
  autoUpdater.quitAndInstall=()=>{global.annoyTestInstalls++;};
}
void import("../../out/main/index.js");
