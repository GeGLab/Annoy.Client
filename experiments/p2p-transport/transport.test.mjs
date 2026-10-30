// Isolated transport experiment. This is not the Annoy DM protocol.
// Every DHT node binds to loopback; no public bootstrap network is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import DHT from 'hyperdht';
import createTestnet from 'hyperdht/testnet.js';

test('two pinned peers exchange a message and ACK over Noise on a private local DHT', { timeout: 20_000 }, async (t) => {
  const network = await createTestnet(3);
  const streams = [];
  t.after(async () => { for (const stream of streams) stream.destroy(); await network.destroy(); });
  const aliceKeys = DHT.keyPair(), bobKeys = DHT.keyPair();
  const alice = network.createNode({ keyPair: aliceKeys });
  const bob = network.createNode({ keyPair: bobKeys });
  let accepted = 0;
  let remoteHandshakeHash = null;
  const receiver = alice.createServer({ relayThrough: null, firewall: (remoteKey) => !remoteKey.equals(bobKeys.publicKey) }, stream => {
    streams.push(stream); accepted++;
    assert.ok(stream.remotePublicKey.equals(bobKeys.publicKey));
    assert.equal(stream.relay, null);
    remoteHandshakeHash = stream.handshakeHash;
    let input = '';
    stream.on('data', chunk => {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 4096) { stream.destroy(new Error('Frame too large')); return; }
      if (!input.endsWith('\n')) return;
      const message = JSON.parse(input);
      assert.deepEqual(message, { id: 'synthetic-1', content: 'local P2P transport test' });
      stream.write(JSON.stringify({ ack: message.id }) + '\n');
    });
  });
  await receiver.listen(aliceKeys);
  const sender = bob.connect(aliceKeys.publicKey, { relayThrough: null }); streams.push(sender);
  await once(sender, 'open');
  assert.ok(sender.remotePublicKey.equals(aliceKeys.publicKey));
  assert.equal(sender.relay, null);
  const ack = once(sender, 'data');
  sender.write(JSON.stringify({ id: 'synthetic-1', content: 'local P2P transport test' }) + '\n');
  assert.deepEqual(JSON.parse(String((await ack)[0])), { ack: 'synthetic-1' });
  assert.equal(accepted, 1);
  assert.ok(sender.handshakeHash.equals(remoteHandshakeHash));

  const stranger = network.createNode();
  const rejected = stranger.connect(aliceKeys.publicKey); streams.push(rejected);
  const refused = await new Promise(resolve => {
    rejected.once('error', () => resolve(true));
    rejected.once('open', () => resolve(false));
  });
  assert.equal(refused, true);
  assert.equal(accepted, 1);
  for (const node of network.nodes) assert.equal(node.address().host, '127.0.0.1');
});
