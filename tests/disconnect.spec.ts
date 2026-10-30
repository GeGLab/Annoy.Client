import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] } });
const origin = 'http://disconnect.test';
const me = { id: 'me', username: 'tester', displayName: 'Pessoa de teste', avatarUrl: null };
const friend = { id: 'friend', username: 'friend', displayName: 'Amigo de teste', avatarUrl: null };
const server = { id: 'server', name: 'Comunidade de teste', iconUrl: null, ownerId: 'me' };
const channel = { id: 'voice', serverId: 'server', name: 'Voz', type: 'voice', topic: '', parentId: null, position: 0, overwrites: [] };
const ready = { user: me, servers: [server], dms: [{ id: 'dm', recipients: [friend], lastMessageId: null }], relationships: [{ user: friend, status: 'friend' }], presences: { me: 'online', friend: 'online' }, activities: { friend: [{ kind: 'development', provider: 'vscode', name: 'Atividade antiga' }] }, instance: { isAdmin: false, registration: 'open', voiceBackend: 'cloudflare', directCalls: true } };
const state = { server, channels: [channel], roles: [{ id: 'server', serverId: 'server', name: 'Membros', color: null, permissions: 2147483647, position: 0 }], members: [me, friend].map(user => ({ user, nick: null, roleIds: ['server'], joinedAt: '2026-01-01', presence: 'online' })), voiceStates: [], permissions: 2147483647 };

async function setup(page: Page, acknowledge = true) {
  let socket!: WebSocketRoute;
  let available = true;
  const methods: string[] = [], writes: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('distopic.settings', JSON.stringify({ noiseFilter: 'off', notifications: false, messageSounds: false, screenAudio: true }));
    const tracks: MediaStreamTrack[] = [], peers: any[] = [];
    (window as any).__captured = tracks; (window as any).__peers = peers;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints); tracks.push(...stream.getTracks()); return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    class FakePeer {
      connectionState = 'connected'; localDescription: any = null; remoteDescription: any = null;
      transceivers: any[] = [];
      constructor() { peers.push(this); }
      addEventListener() {}
      addTrack(track: MediaStreamTrack) { tracks.push(track); }
      addTransceiver(track: MediaStreamTrack) {
        tracks.push(track); const t = { mid: String(this.transceivers.length), direction: 'sendonly' }; this.transceivers.push(t); return t;
      }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription(value: any) { this.localDescription = value; }
      async setRemoteDescription(value: any) { this.remoteDescription = value; }
      close() { this.connectionState = 'closed'; }
    }
    (window as any).RTCPeerConnection = FakePeer;
  });
  await page.route(`${origin}/api/**`, route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    if (!available) return route.abort('connectionrefused');
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).pathname.endsWith('/servers/server') ? state : []) });
  });
  await page.routeWebSocket('ws://disconnect.test/gateway', ws => {
    if (!available) { ws.close({ code: 1013, reason: 'server unavailable' }); return; }
    socket = ws;
    ws.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg.op === 'identify') ws.send(JSON.stringify({ t: 'READY', d: ready }));
      if (acknowledge && msg.op === 'heartbeat') ws.send(JSON.stringify({ t: 'HEARTBEAT_ACK', d: null }));
      if (msg.op === 'voice') {
        methods.push(msg.method);
        const data = msg.method === 'join' ? { iceServers: [], canSpeak: true, canStream: true, screenAudio: true }
          : msg.method === 'getProducers' ? { producers: [] }
          : msg.method === 'publish' ? { producerId: `track-${methods.length}`, sdp: 'v=0\r\n' } : {};
        ws.send(JSON.stringify({ t: 'VOICE_REPLY', d: { id: msg.id, ok: true, data } }));
      }
    });
  });
  await page.goto('http://127.0.0.1:5178');
  await page.evaluate(async () => {
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    addAccount({ id: 'test', url: 'http://disconnect.test', userId: 'me', token: 'synthetic', instanceName: 'Instância de teste' });
  });
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().instances.test?.status)).toBe('ready');
  return { methods, writes, stop: (code: number) => { available = false; socket.close({ code, reason: 'server stopped' }); }, resume: () => { available = true; } };
}

for (const code of [1001, 4010]) test(`gateway close ${code} ends camera, screen, mic and screen audio; cached DMs stay read-only`, async ({ page }) => {
  const fixture = await setup(page);
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    client.navigate({ kind: 'home', accountId: 'test', dmId: 'dm' });
    await client.joinVoice('test', 'server', 'voice');
    await client.toggleCamera();
    await client.startScreenShare(null);
  });
  const input = page.getByRole('textbox', { name: 'Conversar em Amigo de teste' });
  await input.fill('Rascunho que não foi enviado');
  await expect.poll(() => page.evaluate(() => (window as any).__captured.filter((t: MediaStreamTrack) => t.readyState === 'live').length)).toBeGreaterThan(3);
  fixture.stop(code);
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().voice)).toBeNull();
  await expect.poll(() => page.evaluate(() => (window as any).__captured.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__peers.every((pc: any) => pc.connectionState === 'closed'))).toBe(true);
  await expect(input).toBeDisabled();
  await expect(input).toHaveValue('Rascunho que não foi enviado');
  await expect(page.getByRole('button', { name: 'Enviar mensagem', exact: true })).toBeDisabled();
  await expect(page.locator('.connection-notice')).toContainText('Sem conexão');
  expect(fixture.writes).toEqual([]);
  await expect(page.getByRole('button', { name: 'Ver conteúdo salvo' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver conteúdo salvo' }).click();
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).navigate({ kind: 'home', accountId: 'test', dmId: null }));
  await expect(page.getByRole('heading', { name: 'Status dos amigos indisponível' })).toBeVisible();
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await expect(page.locator('.friend')).toContainText('Sem conexão');
  await expect(page.locator('.friend .activity-stack')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ligar para Amigo de teste', exact: true })).toBeDisabled();
  fixture.resume();
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).reconnect('test'));
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().instances.test.status)).toBe('ready');
  expect(fixture.methods.filter(method => method === 'join')).toHaveLength(1);
  expect(fixture.methods).not.toContain('resume');
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().voice)).toBeNull();
});

test('network loss ends a private call and releases its devices', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { handleDirectCallEvent, callDeviceId } = await import(/* @vite-ignore */ `${location.origin}/src/features/direct-calls.ts`);
    await handleDirectCallEvent('test', { t: 'CALL_UPDATE', d: { id: 'call', callerId: 'me', calleeId: 'friend', callerDeviceId: callDeviceId, status: 'active', video: true, iceServers: [] } });
    window.dispatchEvent(new Event('offline'));
  });
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().directCall)).toBeNull();
  expect(await page.evaluate(() => (window as any).__captured.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__peers.every((pc: any) => pc.connectionState === 'closed'))).toBe(true);
});


test('a silent gateway loses its lease within ten seconds and stops the microphone', async ({ page }) => {
  await page.clock.install();
  await setup(page, false);
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).joinVoice('test', 'server', 'voice'));
  await page.clock.runFor(10_001);
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().voice)).toBeNull();
  expect(await page.evaluate(() => (window as any).__captured.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
});

test('microphone capture resolving after disconnect is stopped before it can publish', async ({ page }) => {
  const fixture = await setup(page);
  await page.evaluate(async () => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      await new Promise<void>(resolve => { (window as any).__finishCapture = resolve; });
      return stream;
    };
    const { joinVoice } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    (window as any).__pendingJoin = joinVoice('test', 'server', 'voice');
  });
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishCapture)).toBe('function');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(async () => { (window as any).__finishCapture(); await (window as any).__pendingJoin; });
  expect(await page.evaluate(() => (window as any).__captured.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  expect(fixture.methods).not.toContain('publish');
});

test('disconnected account rejects text, attachments and account mutations before making any request', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { apiFor } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    window.dispatchEvent(new Event('offline'));
    const api = apiFor('test');
    const tasks = [() => api.post('/relationships', { username: 'friend' }), () => api.sendMessage('dm', 'unsent', [], null), () => api.sendMessage('dm', '', [new File(['sample'], 'test.txt')], null), () => api.uploadMessage('dm', '', [], () => {}), () => api.uploadAvatar(new Blob()), () => api.uploadServerIcon('server', new Blob())];
    const errors = [];
    for (const task of tasks) { try { await task(); errors.push('unexpected success'); } catch (error) { errors.push((error as Error).message); } }
    return errors;
  });
  expect(result).toHaveLength(6);
  expect(result.every(error => error.includes('Sem conexão com o servidor'))).toBe(true);
});


for (const type of ['song', 'theater']) test(`${type} playback ends on disconnect and does not restart when the server returns`, async ({ page }) => {
  const fixture = await setup(page);
  await page.route(`${origin}/fixture.webm`, async route => route.fulfill({ contentType: 'video/webm', body: await readFile('tests/fixtures/flower.webm') }));
  await page.route(`${origin}/api/channels/media/playback`, route => {
    const now = Date.now();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ channelId: 'media', queue: [{ id: 'clip', url: '/fixture.webm', title: 'Video sintético', kind: 'file', addedBy: 'me', addedAt: new Date(now).toISOString() }], currentId: 'clip', paused: false, position: 0, updatedAt: now, serverTime: now, autoplay: false }) });
  });
  await page.evaluate(async (type) => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    await client.ensureServer('test', 'server');
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.instances.test.serverStates.server.channels.push({ id: 'media', serverId: 'server', name: 'Media de teste', type, topic: '', parentId: null, position: 1, overwrites: [] }); });
    if (type === 'song') {
      const { listenTo } = await import(/* @vite-ignore */ `${location.origin}/src/features/channels/PlaybackRooms.tsx`);
      listenTo({ accountId: 'test', serverId: 'server', channelId: 'media', name: 'Media de teste' });
    } else client.navigate({ kind: 'server', accountId: 'test', serverId: 'server', channelId: 'media' });
  }, type);
  await expect(page.locator('video')).toHaveCount(1);
  await expect.poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
  fixture.stop(4010);
  await expect(page.locator('video')).toHaveCount(0);
  fixture.resume();
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).reconnect('test'));
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().instances.test.status)).toBe('ready');
  await expect(page.locator('video')).toHaveCount(0);
});
