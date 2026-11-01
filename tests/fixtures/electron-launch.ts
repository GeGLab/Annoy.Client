import {_electron} from '@playwright/test';
/** Chromium must receive the class/backend switches before Electron initializes;
 * app.commandLine calls in the fixture are too late for Playwright's loader. */
export const electron={
 launch(options:Parameters<typeof _electron.launch>[0]){
  const flags=process.platform==='linux'&&process.env.ANNOY_TEST_MONITOR?['--class=annoy-security-tests','--ozone-platform=x11']:[];
  // Tests never play sound on the machine's real output (call feedback, remote audio).
  return _electron.launch({...options,args:['--mute-audio',...flags,...options.args??[]]});
 },
};
