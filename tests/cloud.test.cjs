const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;
const Cloud = require('../cloud.js');
const { fixture } = require('./helpers/github-fixture.cjs');
const makeClient = api => Cloud.createClient({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only', fetch: api.fetch, minWriteGap: 0 });
const garment = (id = 'g_1') => ({ id, name: 'The Simone', category: 'dresses', brand: 'Réalisation Par', purchasePrice: 100, originalPrice: 290, currency: 'GBP',
  aspect: .7, image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumbnail'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }),
  createdAt: '2024-06-26', updatedAt: '2024-06-26' });
async function publish(api, garments = [garment()], outfits = []) {
  const client = makeClient(api); await client.connect(); const remote = await client.readRemote(), local = await client.prepare(garments, outfits);
  const merged = Cloud.merge(null, local, remote.manifest); assert.equal(merged.conflicts.length, 0);
  const result = await client.publish(merged.manifest, remote); return { client, local, result };
}
test('private uploads publish images, complete metadata and outfits as one atomic revision', async () => {
  const api = fixture(), g = garment(), outfit = { id: 'o_1', name: '周末', background: '#f8f7f3', layers: [{ id: 'l_1', garmentId: g.id, x: 100, y: 100, w: 300, rotation: 0, flip: false }] };
  const { result, local } = await publish(api, [g], [outfit]);
  assert.equal(api.commitCount, 1); assert.equal(result.head, api.head);
  assert.equal(api.manifest().garments[0].purchasePrice, 100); assert.equal(api.manifest().garments[0].originalPrice, 290);
  assert.equal(api.manifest().outfits[0].layers[0].garmentId, g.id);
  assert.equal(Object.keys(api.manifest().garments[0].assets).length, 3);
  assert.doesNotMatch(JSON.stringify(api.manifest()), /unit-test-only|Authorization|Bearer/);
  for (const request of api.requests) { assert.ok(request.url.startsWith('https://api.github.com/repos/')); assert.equal(request.headers.Authorization, 'Bearer unit-test-only'); assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); }
  const cached = Cloud.localRecords(result.manifest, [g], 'SuzyQi/wardrobe-studio-data', local)[0];
  assert.equal(cached.image, g.image); assert.equal(cached.original, g.original);
});
test('a new device initially loads metadata only, and fetches a verified photo on demand', async () => {
  const api = fixture(); await publish(api);
  const second = makeClient(api); await second.connect(); const remote = await second.readRemote();
  assert.equal(api.rawGets.length, 0);
  const cached = Cloud.localRecords(remote.manifest, [], 'suzyqi/wardrobe-studio-data');
  assert.equal(cached[0].image, undefined); assert.equal(cached[0].original, undefined);
  const blob = await second.getAsset(cached[0].cloudAssets.thumb, cached[0].id);
  assert.equal(await blob.text(), 'thumbnail'); assert.equal(blob.type, 'image/webp'); assert.equal(api.rawGets.length, 1);
  const count = api.requests.filter(r => r.method === 'POST').length;
  await second.prepare(cached, remote.manifest.outfits);
  assert.equal(api.requests.filter(r => r.method === 'POST').length, count, 'unchanged cloud images should be reused');
});
test('no-change syncs avoid extra commits and shared photo objects retain valid garment paths', async () => {
  const api = fixture(), a = garment(), b = { ...a, id: 'g_2' }; const { client, local, result } = await publish(api, [a, b]);
  assert.match(local.garments[1].assets.original.path, /^images\/g_2\//);
  const before = api.commitCount; await client.publish(local, { head: result.head, exists: true, manifest: result.manifest });
  assert.equal(api.commitCount, before);
});
test('public repositories and invalid destinations are rejected before any upload', async () => {
  const api = fixture({ privateRepo: false }), client = makeClient(api);
  await assert.rejects(client.connect(), /私有仓库/);
  assert.equal(api.requests.filter(r => r.method !== 'GET').length, 0);
  assert.throws(() => Cloud.createClient({ owner: 'SuzyQi', repo: '../public', token: 'unit-test-only' }), /仓库名/);
});
test('concurrent branch moves never force an overwrite or report a completed sync', async () => {
  const api = fixture(); const { client } = await publish(api), before = api.head;
  const remote = await client.readRemote(); const local = await client.prepare([{ ...garment(), name: 'Changed' }], []);
  api.moveBeforePublish(); await assert.rejects(client.publish(local, remote), /云端版本/);
  assert.notEqual(api.head, before); assert.equal(api.manifest().garments[0].name, 'The Simone');
});
test('three-way merge preserves independent changes and propagates an intentional deletion', async () => {
  const api = fixture(), { result } = await publish(api, [garment('g_1'), garment('g_2')]);
  const base = result.manifest, local = structuredClone(base), remote = structuredClone(base);
  local.garments[0].notes = '本机笔记'; remote.garments = remote.garments.filter(g => g.id !== 'g_2');
  const merged = Cloud.merge(base, local, remote);
  assert.equal(merged.conflicts.length, 0); assert.equal(merged.manifest.garments.length, 1); assert.equal(merged.manifest.garments[0].notes, '本机笔记');
});
test('simultaneous edits and delete-versus-edit require an explicit per-record choice', async () => {
  const { result } = await publish(fixture()); const base = result.manifest, local = structuredClone(base), remote = structuredClone(base);
  local.garments[0].name = '本机'; remote.garments[0].name = '云端';
  assert.equal(Cloud.merge(base, local, remote).conflicts.length, 1);
  assert.equal(Cloud.merge(base, local, remote, { 'garments:g_1': 'remote' }).manifest.garments[0].name, '云端');
  remote.garments = []; assert.equal(Cloud.merge(base, local, remote).conflicts.length, 1);
  assert.equal(Cloud.merge(base, local, remote, { 'garments:g_1': 'local' }).manifest.garments[0].name, '本机');
});
test('malformed manifests and corrupted image bytes cannot enter the local wardrobe', async () => {
  const api = fixture(), { result, client } = await publish(api), invalid = structuredClone(result.manifest);
  invalid.garments[0].assets.image.path = '../README.md'; assert.throws(() => Cloud.validateManifest(invalid), /图片记录/);
  const unsupported = structuredClone(result.manifest); unsupported.version = 2; assert.throws(() => Cloud.validateManifest(unsupported), /不受支持/);
  const g = result.manifest.garments[0]; api.corrupt(g.assets.image.sha); await assert.rejects(client.getAsset(g.assets.image, g.id), /校验失败/);
});
test('expired authorization is reported without raw server details and disconnect removes access', async () => {
  const api = fixture(), client = makeClient(api); api.failNext(401);
  await assert.rejects(client.connect(), e => /授权已失效/.test(e.message) && !/unit-test-only|raw server/.test(e.message));
  client.disconnect(); const before = api.requests.length; await assert.rejects(client.connect(), /请先连接/); assert.equal(api.requests.length, before);
});
test('choosing a remote image does not retain a locally edited image under an old cloud reference', async () => {
  const api = fixture(), source = garment(), { client, result, local } = await publish(api, [source]);
  const cached = Cloud.localRecords(result.manifest, [source], 'suzyqi/wardrobe-studio-data', local)[0];
  cached.image = new Blob(['locally changed image'], { type: 'image/png' });
  const prepared = await client.prepare([cached], []);
  const remoteChosen = Cloud.localRecords(result.manifest, [cached], 'suzyqi/wardrobe-studio-data', prepared)[0];
  assert.equal(remoteChosen.image, undefined); assert.equal(remoteChosen.original, source.original);
});
