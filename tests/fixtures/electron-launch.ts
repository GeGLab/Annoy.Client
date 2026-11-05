import {_electron} from '@playwright/test';
/** Chromium must receive the class/backend switches before Electron initializes;
 * app.commandLine calls in the fixture are too late for Playwright's loader. */
export const electron={
 launch(options:Parameters<typeof _electron.launch>[0]){
  const flags=process.platform==='linux'&&process.env.ANNOY_TEST_MONITOR?['--class=annoy-security-tests','--ozone-platform=x11']:[];
  // Tests never play sound on the machine's real output (call feedback, remote audio).
  // Tests never reach the real Annoy cloud: unless a test points them somewhere, the cloud URLs go to a closed local port.
  const closed='http://127.0.0.1:9';
  // The account API (authannoy) is the test's Global fixture unless a test says otherwise.
  const env=options.env?{ANNOY_USERS_URL:closed,ANNOY_CHAT_URL:closed,ANNOY_CDN_URL:closed,...(options.env.ANNOY_GLOBAL_URL&&{ANNOY_AUTH_URL:options.env.ANNOY_GLOBAL_URL}),...options.env}:options.env;
  return _electron.launch({...options,env,args:['--mute-audio',...flags,...options.args??[]]});
 },
};
