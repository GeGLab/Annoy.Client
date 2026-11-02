import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateController } from '../../src/main/update-controller.ts';

const advisory = { id: 'ACCOUNT-POLICY', severity: 'critical', fixedIn: '0.9.0', summary: 'Exclusive authentication' };
function fixture(overrides = {}) {
  const states = [];
  const calls = { downloads: 0, installs: 0, checks: 0 };
  const io = {
    currentVersion: '0.8.0', updatable: () => true, loadAdvisory: async () => advisory,
    checkForUpdates: async () => { calls.checks++; return '0.9.0'; },
    downloadUpdate: async () => { calls.downloads++; },
    install: () => { calls.installs++; }, publish: s => states.push(s), ...overrides,
  };
  return { controller: createUpdateController(io), calls, states, io };
}

test('critical updates download without interaction and install immediately when verified', async () => {
  const { controller: c, calls } = fixture();
  await c.check();
  assert.equal(calls.downloads, 1);
  assert.equal(c.getState().status, 'downloading');
  assert.equal(c.getState().mandatory, true);
  c.progress(51.3); assert.equal(c.getState().percent, 51);
  c.downloaded('0.9.0');
  assert.equal(c.getState().status, 'ready');
  assert.equal(calls.installs, 1);
});

test('ordinary updates still ask before downloading and restarting', async () => {
  const { controller: c, calls } = fixture({ loadAdvisory: async () => null });
  await c.check(); assert.equal(c.getState().mandatory, false);
  assert.equal(calls.downloads, 0);
  await c.download(); assert.equal(calls.downloads, 1);
  c.downloaded('0.9.0'); assert.equal(calls.installs, 0);
  c.install(); assert.equal(calls.installs, 1);
});

test('a failed download remains mandatory on retry, including a policy outage', async () => {
  const f = fixture();
  f.io.downloadUpdate = async () => { throw new Error('network'); };
  await f.controller.check();
  assert.equal(f.controller.getState().status, 'error');
  assert.equal(f.controller.getState().mandatory, true);
  f.io.loadAdvisory = async () => null;
  f.io.downloadUpdate = async () => { f.calls.downloads++; };
  await f.controller.download();
  assert.equal(f.controller.getState().mandatory, true);
  f.controller.downloaded('0.9.0');
  assert.equal(f.calls.installs, 1);
});

test('an advisory blocks until a sufficiently recent installer exists', async () => {
  for (const version of [null, '0.8.0', '0.8.1']) {
    const { controller: c, calls } = fixture({ checkForUpdates: async () => version });
    await c.check(); assert.equal(c.getState().status, 'blocked');
    await c.download(); assert.equal(calls.downloads, 0);
    c.downloaded('0.8.1'); assert.equal(calls.installs, 0);
  }
});

test('unsupported packages never start a download', async () => {
  const { controller: c, calls } = fixture({ updatable: () => false });
  await c.check(); assert.equal(c.getState().status, 'disabled');
  assert.equal(calls.checks, 0); assert.equal(calls.downloads, 0);
});

test('concurrent checks are serialized and cannot duplicate security downloads', async () => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const { controller: c, calls } = fixture({ loadAdvisory: async () => { await pending; return advisory; } });
  const first = c.check();
  await c.check();
  resolve(); await first;
  assert.equal(calls.checks, 1); assert.equal(calls.downloads, 1);
});

test('a known critical advisory remains blocking when a later policy fetch fails', async () => {
  const f = fixture({ checkForUpdates: async () => null });
  await f.controller.check();
  f.io.loadAdvisory = async () => null;
  f.io.checkForUpdates = async () => { throw new Error('offline'); };
  await f.controller.check();
  assert.equal(f.controller.getState().status, 'error');
  assert.equal(f.controller.getState().mandatory, true);
  assert.equal(f.controller.getState().advisory.id, advisory.id);
});


test('a newly published critical advisory forces an already cached ordinary update', async () => {
  const f = fixture({ loadAdvisory: async () => null });
  await f.controller.check(); await f.controller.download();
  f.controller.downloaded('0.9.0');
  assert.equal(f.calls.installs,0);
  f.io.loadAdvisory = async () => advisory;
  await f.controller.check();
  assert.equal(f.calls.installs,1);
  assert.equal(f.controller.getState().mandatory,true);
});

test('a new advisory blocks an optional download that is already running', async () => {
  const f = fixture({ loadAdvisory: async () => null });
  await f.controller.check(); await f.controller.download();
  f.io.loadAdvisory = async () => advisory;
  await f.controller.check();
  assert.equal(f.controller.getState().mandatory,true);
  assert.equal(f.calls.downloads,1);
  f.controller.downloaded('0.9.0');
  assert.equal(f.calls.installs,1);
});


test('a critical advisory blocks immediately while checking a slow installer feed', async () => {
  let releaseFeed;
  const feed = new Promise(r => { releaseFeed = r; });
  const { controller: c } = fixture({ checkForUpdates: async () => await feed });
  const pending = c.check();
  await new Promise(r => setImmediate(r));
  assert.equal(c.getState().status,'blocked');
  releaseFeed('0.9.0'); await pending;
  assert.equal(c.getState().mandatory,true);
});

test('late or unrequested downloads cannot replace the selected update',async()=>{
 const f=fixture({loadAdvisory:async()=>null});
 f.controller.downloaded('0.9.0');assert.equal(f.controller.getState().status,'error');assert.equal(f.calls.installs,0);
 await f.controller.check();f.controller.downloaded('0.10.0');assert.equal(f.controller.getState().status,'error');assert.equal(f.calls.installs,0);
});

test('failure of signature revalidation at install leaves the update uninstalled',async()=>{
 const f=fixture({loadAdvisory:async()=>null,install:async()=>{throw new Error('artifact changed after download');}});
 await f.controller.check();await f.controller.download();f.controller.downloaded('0.9.0');
 await f.controller.install();assert.equal(f.controller.getState().status,'error');assert.equal(f.calls.installs,0);
});
