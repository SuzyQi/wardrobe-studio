const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.crypto ||= require('node:crypto').webcrypto;
const Cloud = require('../cloud.js');
const { fixture } = require('./helpers/github-fixture.cjs');
const C = require('../core.js');
test('brand casing upgrades do not conflict with other-device edits or mask genuine brand changes', () => {
  const g = { id: 'g_brand', name: 'Original', brand: 'paloma wool', assets: { image: { sha: 'unchanged' } }, updatedAt: 'unchanged' };
  const base = { ...Cloud.empty(), garments: [g] };
  const local = { ...base, garments: [{ ...g, name: 'My edit', brand: 'Paloma Wool' }] };
  const remote = { ...base, garments: [{ ...g, brand: 'Paloma Wool' }] };
  const merged = Cloud.merge(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.manifest.garments[0].name, 'My edit');
  assert.equal(merged.manifest.garments[0].brand, 'Paloma Wool');
  assert.deepEqual(merged.manifest.garments[0].assets, g.assets);
  assert.equal(merged.manifest.garments[0].updatedAt, 'unchanged');
  assert.equal(g.brand, 'paloma wool', 'merge must not mutate old checkpoints');
  assert.equal(Cloud.merge(base, {...base,garments:[{...g,brand:'Zara'}]}, {...base,garments:[{...g,brand:'Ganni'}]}).conflicts.length, 1);
});
const makeClient = api => Cloud.createClient({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only', fetch: api.fetch, minWriteGap: 0 });
const garment = (id = 'g_1') => ({ id, name: 'The Simone', category: 'dresses', brand: 'Réalisation Par', purchasePrice: 100, originalPrice: 290, currency: 'GBP',
  aspect: .7, image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumbnail'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }),
  createdAt: '2024-06-26', updatedAt: '2024-06-26' });
test('metadata-only sync uses one atomic request, preserves all photos, and checks the cached head', async () => {
  const api=fixture(), garments=Array.from({length:30},(_,i)=>garment('g_'+i));
  const {client,result}=await publish(api,garments);const previousAssets=result.manifest.garments.map(g=>g.assets);
  const before=api.requests.length,remote=await client.readRemote();
  assert.equal(api.requests.length-before,1,'the unchanged head only needs a branch lookup');
  const local=structuredClone(result.manifest);local.garments[0].brand='Jaded London';
  const steps=[],start=api.requests.length;await client.publish(local,remote,message=>steps.push(message));
  const writes=api.requests.slice(start);assert.equal(writes.length,1);assert.equal(writes[0].method,'PUT');assert.ok(writes[0].url.endsWith('/contents/wardrobe.json'));assert.equal(writes[0].body.sha,result.fileSHA);
  assert.deepEqual(api.manifest().garments.map(g=>g.assets),previousAssets);
  assert.equal(api.manifest().garments[0].brand,'Jaded London');assert.equal(steps.length,1);
  const cached=await client.readRemote();cached.manifest.garments[0].brand='Caller mutation';
  assert.equal((await client.readRemote()).manifest.garments[0].brand,'Jaded London');
});
test('a fresh client reuses trusted immutable cached photos without reading bytes, but verifies same-size replacements', async () => {
  const api=fixture(),source=Array.from({length:30},(_,i)=>garment('g_'+i));
  const {result,local}=await publish(api,source);
  const cached=Cloud.localRecords(result.manifest,source,'suzyqi/wardrobe-studio-data',local),trusted=new WeakSet();
  for(const g of cached)for(const field of C.imageFields(g)){trusted.add(g[field]);Object.defineProperty(g[field],'arrayBuffer',{value:async()=>{throw new Error('trusted photo must not be reread');}});}
  const client=Cloud.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',minWriteGap:0,fetch:api.fetch,canReuseAsset:(g,field)=>trusted.has(g[field])});
  await client.connect();let stats;const prepared=await client.prepare(cached,[],(message,value)=>stats=value);
  assert.equal(stats.read,0);assert.equal(stats.readBytes,0);assert.equal(stats.reused,90);assert.equal(stats.uploaded,0);
  assert.deepEqual(prepared.garments.map(g=>g.assets),result.manifest.garments.map(g=>g.assets));
  cached[0].image=new Blob(['changed'],{type:'image/png'});assert.equal(cached[0].image.size,source[0].image.size);
  const changed=await client.prepare(cached,[],(message,value)=>stats=value);
  assert.equal(stats.read,1);assert.equal(stats.uploaded,1);assert.equal(stats.reused,89);
  assert.notEqual(changed.garments[0].assets.image.hash,result.manifest.garments[0].assets.image.hash);
});
test('stopping a pending cloud save leaves the last revision intact and the same authorization can retry', async () => {
  const api=fixture(),{result}=await publish(api);let paused=false,entered;
  const started=new Promise(resolve=>entered=resolve);
  const client=Cloud.createClient({owner:'SuzyQi',repo:'wardrobe-studio-data',token:'unit-test-only',minWriteGap:0,fetch:async(url,options)=>{
    if(paused&&url.endsWith('/contents/wardrobe.json')&&options.method==='PUT') {entered();return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}
    return api.fetch(url,options);
  }});
  await client.connect();const remote=await client.readRemote(),local=structuredClone(result.manifest);local.garments[0].brand='Chanel';
  paused=true;const saving=client.publish(local,remote);await started;client.cancelPending();
  await assert.rejects(saving,error=>error.name==='SyncCancelled');assert.equal(api.head,result.head);
  paused=false;await client.publish(local,await client.readRemote());assert.equal(api.manifest().garments[0].brand,'Chanel');
});
test('stopping during image preparation prevents a later image upload', async () => {
  const api=fixture(),client=makeClient(api);await client.connect();const g=garment();let release,entered;
  const started=new Promise(resolve=>entered=resolve),bytes=g.image.arrayBuffer.bind(g.image);
  Object.defineProperty(g.image,'arrayBuffer',{value:async()=>{entered();await new Promise(resolve=>release=resolve);return bytes();}});
  const pending=client.prepare([g],[]);await started;client.cancelPending();release();
  await assert.rejects(pending,error=>error.name==='SyncCancelled');assert.equal(api.requests.filter(r=>r.method==='POST').length,0);
});
async function publish(api, garments = [garment()], outfits = []) {
  const client = makeClient(api); await client.connect(); const remote = await client.readRemote(), local = await client.prepare(garments, outfits);
  const merged = Cloud.merge(null, local, remote.manifest); assert.equal(merged.conflicts.length, 0);
  const result = await client.publish(merged.manifest, remote); return { client, local, result };
}
test('reopening an unchanged saved cloud revision needs only privacy and branch checks', async () => {
  const api = fixture(), { result } = await publish(api);
  const checkpoint = { origin: 'suzyqi/wardrobe-studio-data', ...result };
  const client = Cloud.createClient({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only', fetch: api.fetch, minWriteGap: 0, cachedRemote: checkpoint });
  const before = api.requests.length;
  await client.connect(); const remote = await client.readRemote();
  assert.equal(api.requests.length - before, 2);
  assert.deepEqual(remote.manifest, result.manifest); assert.equal(remote.fileSHA, result.fileSHA); assert.equal(remote.tree, result.tree);
  checkpoint.manifest.garments[0].brand = 'Caller mutation';
  assert.notEqual((await client.readRemote()).manifest.garments[0].brand, 'Caller mutation');
});
test('saved revisions are ignored after a remote edit, for other repositories, or when malformed', async () => {
  const api = fixture(), { client: writer, result } = await publish(api);
  const seed = { origin: 'suzyqi/wardrobe-studio-data', ...result };
  const change = structuredClone(result.manifest); change.garments[0].brand = 'Gucci';
  await writer.publish(change, await writer.readRemote());
  for (const cachedRemote of [seed, { ...seed, origin: 'other/repository' }, { ...seed, manifest: {} }]) {
    const reader = Cloud.createClient({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only', fetch: api.fetch, minWriteGap: 0, cachedRemote });
    const before = api.requests.length; await reader.connect(); const remote = await reader.readRemote();
    assert.equal(remote.manifest.garments[0].brand, 'Gucci'); assert.equal(api.requests.length - before, 5);
  }
});
test('older checkpoints resolve their tree once and retain a working multi-file fallback', async () => {
  const api = fixture(), { result } = await publish(api);
  const client = Cloud.createClient({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only', fetch: api.fetch, minWriteGap: 0,
    cachedRemote: { origin: 'suzyqi/wardrobe-studio-data', head: result.head, manifest: result.manifest } });
  const before = api.requests.length; await client.connect(); const remote = await client.readRemote();
  assert.equal(api.requests.length - before, 3); assert.equal(remote.tree, result.tree);
  const changed = structuredClone(remote.manifest); changed.garments[0].brand = 'Chanel';
  const saved = await client.publish(changed, remote);
  assert.equal(api.manifest().garments[0].brand, 'Chanel');
  assert.equal((await makeClient(api).readRemote()).fileSHA, saved.fileSHA);
});
test('one-request metadata saves reject concurrent wardrobe edits and preserve the newer version', async () => {
  const api = fixture(), { client, result } = await publish(api), other = makeClient(api);
  await other.connect(); const remote = await client.readRemote(), otherRemote = await other.readRemote();
  const mine = structuredClone(result.manifest), theirs = structuredClone(result.manifest);
  mine.garments[0].brand = 'Chanel'; theirs.garments[0].brand = 'Gucci';
  await other.publish(theirs, otherRemote); const head = api.head;
  await assert.rejects(client.publish(mine, remote), /云端版本/);
  assert.equal(api.head, head); assert.equal(api.manifest().garments[0].brand, 'Gucci');
});
test('cache recovery removes only byte-verified cloud copies and preserves unsynced or unreadable images', async () => {
  const api = fixture(), g = garment(); const { result, local } = await publish(api, [g]);
  const cached = Cloud.localRecords(result.manifest, [g], 'suzyqi/wardrobe-studio-data', local)[0];
  const lean = await Cloud.withoutBackedImageCaches(cached, 'SuzyQi/wardrobe-studio-data');
  for (const field of ['image', 'thumb', 'original']) { assert.equal(lean[field], undefined); assert.equal(cached[field], g[field]); }
  assert.deepEqual(lean.cloudAssets, cached.cloudAssets);
  const changed = { ...cached, image: new Blob(['changed'], { type: cached.image.type }) };
  assert.equal((await Cloud.withoutBackedImageCaches(changed, cached.cloudOrigin)).image, changed.image);
  assert.equal(await Cloud.withoutBackedImageCaches(cached, 'other/repo'), cached);
  const unreadable = { ...cached, image: { size: cached.image.size, type: cached.image.type, arrayBuffer: async () => { throw new Error('unreadable'); } } };
  assert.equal((await Cloud.withoutBackedImageCaches(unreadable, cached.cloudOrigin)).image, unreadable.image);
  const noRef = { ...g }; assert.equal(await Cloud.withoutBackedImageCaches(noRef, cached.cloudOrigin), noRef);
});
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
test('image-changing multi-file sync rejects concurrent branch moves without forcing an overwrite', async () => {
  const api = fixture(); const { client } = await publish(api), before = api.head;
  const remote = await client.readRemote(); const local = await client.prepare([{ ...garment(), name: 'Changed', image: new Blob(['new photo'], { type: 'image/png' }) }], []);
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
  const unsupported = structuredClone(result.manifest); unsupported.version = 5; assert.throws(() => Cloud.validateManifest(unsupported), /不受支持/);
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

test('gallery assets and archive metadata sync across devices, retain verified caches and delete safely', async () => {
  const api = fixture(), g = garment();
  g.archive = C.archiveDetails({ year: '2020', relation: 'runway_match', story: 'Found at last', photos: [{ id: 'p_1', kind: 'runway', caption: 'Reference', sourceUrl: 'https://www.zimmermann.com/' }] });
  g.photo_p_1 = new Blob(['runway photo'], { type: 'image/jpeg' });
  const { client, result, local } = await publish(api, [g]);
  assert.equal(result.manifest.version, 2); assert.equal(api.manifest().garments[0].archive.story, g.archive.story);
  const remote = await client.readRemote(), fresh = Cloud.localRecords(remote.manifest, [], 'suzyqi/wardrobe-studio-data')[0];
  assert.equal(fresh.photo_p_1, undefined); assert.equal(Object.keys(fresh.cloudAssets).length, 4);
  const picture = await client.getAsset(fresh.cloudAssets.photo_p_1, fresh.id); assert.equal(await picture.text(), 'runway photo');
  const cached = Cloud.localRecords(result.manifest, [g], 'suzyqi/wardrobe-studio-data', local)[0]; assert.equal(cached.photo_p_1, g.photo_p_1);
  const before = api.requests.filter(r => r.method === 'POST').length; await client.prepare([fresh], []);
  assert.equal(api.requests.filter(r => r.method === 'POST').length, before);
  const invalid = structuredClone(remote.manifest); delete invalid.garments[0].assets.photo_p_1; assert.throws(() => Cloud.validateManifest(invalid), /图片记录/);
  const updated = { ...cached, archive: { ...cached.archive, photos: [] } }, prepared = await client.prepare([updated], []);
  await client.publish(prepared, remote); assert.equal(api.manifest().garments[0].assets.photo_p_1, undefined);
  const removedPath = result.manifest.garments[0].assets.photo_p_1.path;
  assert.ok(api.requests.some(r => Array.isArray(r.body?.tree) && r.body.tree.some(entry => entry.path === removedPath && entry.sha === null)));
  const legacy = structuredClone(api.manifest()); legacy.version = 1; assert.equal(Cloud.validateManifest(legacy).garments.length, 1);
});

test('private photo downloads use validated JSON/base64 and reject same-size byte corruption', async () => {
  const api = fixture(), { client, result } = await publish(api), a = result.manifest.garments[0].assets.image;
  const blob = await client.getAsset(a, 'g_1'); assert.equal(await blob.text(), 'display'); assert.equal(blob.type, 'image/png');
  assert.equal(api.requests.at(-1).headers.Accept, 'application/vnd.github+json');
  api.blobs.set(a.sha, Buffer.from('CORRUPT')); await assert.rejects(client.getAsset(a, 'g_1'), /校验失败/);
});
