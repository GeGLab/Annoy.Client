import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {compareVersions,blockingAdvisory} from '../../src/shared/update.ts';
import {channelAccepts,channelOfVersion,effectiveChannel,versionChannel,LAUNCHED_CHANNELS,DEFAULT_CHANNEL} from '../../src/shared/update-channels.ts';
import {authenticateUpdate,signedUpdatePayload} from '../../src/main/update-signature.ts';
import {UPDATE_TRUST,UPDATE_KEY_CHANNELS} from '../../src/main/update-trust.ts';

test('versions follow semver precedence across channels',()=>{
 const ordered=['0.9.3','0.10.0-alpha.1','0.10.0-alpha.2','0.10.0-alpha.10','0.10.0-beta.1','0.10.0-nightly.202611040300','0.10.0-unstable.1','0.10.0','0.10.1-nightly.1'];
 for(let i=0;i<ordered.length;i++)for(let j=0;j<ordered.length;j++)
  assert.equal(compareVersions(ordered[i],ordered[j]),Math.sign(i-j),`${ordered[i]} vs ${ordered[j]}`);
 assert.equal(compareVersions('v0.10.0-alpha','0.10.0-alpha.1'),-1);
 assert.equal(compareVersions('0.10.0-alpha.1+build.5','0.10.0-alpha.1'),0);
});

test('the 0.9.3 critical advisory does not block alpha builds of later versions',()=>{
 const advisories=[{id:'DSA-2026-001',severity:'critical',fixedIn:'0.9.3',summary:'x'}];
 assert.equal(blockingAdvisory(advisories,'0.10.0-alpha.1'),null);
 assert.ok(blockingAdvisory(advisories,'0.9.3-alpha'));
 assert.ok(blockingAdvisory(advisories,'0.9.2'));
});

test('channels: alpha follows alpha, beta and stable; nightly and unstable only themselves',()=>{
 assert.equal(versionChannel('0.10.0-alpha.1'),'alpha');
 assert.equal(versionChannel('0.10.0'),'');
 assert.equal(channelOfVersion('0.10.1-nightly.20261104'),'nightly');
 assert.equal(channelOfVersion('0.10.0-beta.2'),DEFAULT_CHANNEL);
 for(const v of ['0.10.0-alpha.1','0.10.0-beta.1','1.0.0'])assert.ok(channelAccepts('alpha',v),v);
 for(const v of ['0.10.0-nightly.1','0.10.0-unstable.1','0.10.0-rc.1'])assert.ok(!channelAccepts('alpha',v),v);
 assert.ok(channelAccepts('nightly','0.10.1-nightly.1'));
 assert.ok(!channelAccepts('nightly','0.10.0-alpha.1'));
 assert.ok(!channelAccepts('unstable','0.10.1-nightly.1'));
});

test('only launched channels are followed',()=>{
 assert.deepEqual([...LAUNCHED_CHANNELS],['alpha','unstable','nightly']);
 assert.equal(effectiveChannel('nightly','0.10.0-alpha.1'),'nightly');
 assert.equal(effectiveChannel(null,'0.10.1-nightly.1'),'nightly','a nightly build follows nightly until the user chooses');
 assert.equal(effectiveChannel('alpha','0.10.1-nightly.1'),'alpha');
 assert.equal(effectiveChannel('nightly','0.10.0-alpha.1',['alpha']),'alpha','a channel that is not launched is never followed');
 assert.equal(effectiveChannel(null,'0.10.1-nightly.1',['alpha']),'alpha');
 assert.equal(effectiveChannel('nightly','0.10.0-alpha.1',['alpha','nightly']),'nightly');
 assert.equal(effectiveChannel(null,'0.10.1-unstable.3',['alpha','unstable']),'unstable');
 assert.equal(effectiveChannel('bogus','0.10.0',['alpha','unstable']),'alpha');
});

test('a key limited to nightly cannot sign an alpha release',()=>{
 const pair=generateKeyPairSync('ed25519'),keys={ci:pair.publicKey.export({format:'pem',type:'spki'}).toString()};
 const signed=version=>{const raw={format:1,keyId:'ci',version,platform:'linux',arch:'x64',filename:'Annoy-x86_64.AppImage',size:3,sha512:createHash('sha512').update('abc').digest('base64')};return {...raw,signature:sign(null,signedUpdatePayload(raw),pair.privateKey).toString('base64url')};};
 const expected=version=>({version,platform:'linux',arch:'x64'});
 const scope={ci:['nightly','unstable']};
 assert.ok(authenticateUpdate(signed('0.10.1-nightly.1'),keys,expected('0.10.1-nightly.1'),scope));
 assert.ok(authenticateUpdate(signed('0.10.1-unstable.2'),keys,expected('0.10.1-unstable.2'),scope));
 assert.throws(()=>authenticateUpdate(signed('0.10.0-alpha.1'),keys,expected('0.10.0-alpha.1'),scope));
 assert.throws(()=>authenticateUpdate(signed('1.0.0'),keys,expected('1.0.0'),scope));
 assert.ok(authenticateUpdate(signed('0.10.0-alpha.1'),keys,expected('0.10.0-alpha.1')));
});

import {createUpdateController} from '../../src/main/update-controller.ts';
test('leaving nightly for alpha waits by default and installs an older alpha only when asked',async()=>{
 let leave=false;const states=[];const calls={downloads:0};
 const c=createUpdateController({
  currentVersion:'0.10.0-nightly.202611200300',updatable:()=>true,loadAdvisory:async()=>null,
  checkForUpdates:async()=>'0.10.0-alpha.3',downloadUpdate:async()=>{calls.downloads++;},install:()=>{},
  publish:s=>states.push(s),allowOlder:()=>leave,
 });
 await c.check();
 assert.equal(c.getState().status,'none','waiting is the default');
 c.downloaded('0.10.0-alpha.3');
 assert.equal(c.getState().status,'error','an older download is refused without the choice');
 leave=true;
 await c.check();
 assert.equal(c.getState().status,'available');
 assert.equal(c.getState().version,'0.10.0-alpha.3');
 assert.equal(calls.downloads,0,'still asks before downloading');
 await c.download();c.downloaded('0.10.0-alpha.3');
 assert.equal(c.getState().status,'ready');
});

test('leaving a channel never skips a critical advisory',async()=>{
 const c=createUpdateController({
  currentVersion:'0.10.0-nightly.1',updatable:()=>true,
  loadAdvisory:async()=>({id:'X',severity:'critical',fixedIn:'0.10.0',summary:'x'}),
  checkForUpdates:async()=>'0.10.0-alpha.3',downloadUpdate:async()=>{},install:()=>{},publish:()=>{},allowOlder:()=>true,
 });
 await c.check();
 assert.equal(c.getState().status,'blocked');
});

test('the bundled CI key is pinned only for nightly and unstable; the release key signs everything',()=>{
 assert.deepEqual([...UPDATE_KEY_CHANNELS['annoy-channels']],['nightly','unstable']);
 assert.ok(UPDATE_TRUST['annoy-channels']);
 assert.equal(UPDATE_KEY_CHANNELS['annoy-release-2026'],undefined);
});
