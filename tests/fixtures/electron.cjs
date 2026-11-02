const { app, screen } = require("electron");
app.setPath("userData", process.env.ANNOY_TEST_DATA||process.env.DISTOPIC_TEST_DATA);
app.getVersion=()=>require("../../package.json").version;
if(process.platform==='linux'&&process.env.ANNOY_TEST_MONITOR){
  app.setName('annoy-security-tests');
  app.getVersion=()=>require('../../package.json').version;
  app.setDesktopName('annoy-security-tests.desktop');
  app.setPath('userData',process.env.ANNOY_TEST_DATA);
  app.on('browser-window-created',(_event,window)=>{
    const configured=JSON.parse(process.env.ANNOY_TEST_DISPLAY_BOUNDS||'null');
    const display=screen.getAllDisplays().find(item=>item.label===process.env.ANNOY_TEST_MONITOR);
    const target=display?.workArea??configured;
    if(!target)throw new Error('Dedicated test display unavailable');
    const [width,height]=window.getSize();
    window.setPosition(target.x+Math.max(0,Math.floor((target.width-width)/2)),target.y+Math.max(0,Math.floor((target.height-height)/2)));
  });
}
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
