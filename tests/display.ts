import {existsSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
/** Local desktop preference, absent in CI. Never changes the user's config files. */
export function configureTestDisplay():void {
 const path=resolve(import.meta.dirname,'display.local.json');if(!existsSync(path))return;
 if(process.platform!=='linux')throw new Error('Local test monitor selection requires the configured Linux compositor');
 const settings=JSON.parse(readFileSync(path,'utf8')) as {monitor:string};
 if(!/^DP-[A-Za-z0-9_-]+$/.test(settings.monitor))throw new Error('Invalid dedicated test monitor');
 const instances=JSON.parse(execFileSync('hyprctl',['instances','-j'],{encoding:'utf8'})) as {instance:string;wl_socket:string}[];
 const instance=instances.find(item=>item.wl_socket===process.env.WAYLAND_DISPLAY)??(instances.length===1?instances[0]:null);
 if(!instance)throw new Error('Current Hyprland session is unavailable; refusing to open tests on another monitor');
 const env={...process.env,HYPRLAND_INSTANCE_SIGNATURE:instance.instance};
 const monitors=JSON.parse(execFileSync('hyprctl',['monitors','-j'],{encoding:'utf8',env})) as {name:string;x:number;y:number;width:number;height:number;scale:number}[];
 const target=monitors.find(m=>m.name===settings.monitor);if(!target)throw new Error('Dedicated test monitor '+settings.monitor+' is unavailable; no test windows were opened');
 const rule=`if _G.annoy_security_test_rule then _G.annoy_security_test_rule:set_enabled(false) end; _G.annoy_security_test_rule=hl.window_rule({name="annoy-security-tests",match={class="^annoy-security-tests$"},monitor="${target.name} silent",float=true,center=true,no_initial_focus=true,focus_on_activate=false,suppress_event="activate activatefocus"})`;
 execFileSync('hyprctl',['eval',rule],{encoding:'utf8',env});
 process.env.HYPRLAND_INSTANCE_SIGNATURE=instance.instance;
 process.env.ANNOY_TEST_MONITOR=target.name;
 process.env.ANNOY_TEST_DISPLAY_BOUNDS=JSON.stringify({name:target.name,x:target.x,y:target.y,width:Math.floor(target.width/target.scale),height:Math.floor(target.height/target.scale)});
}
