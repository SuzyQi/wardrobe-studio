const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const Cloud = require('../cloud.js');
const { fixture } = require('./helpers/github-fixture.cjs');
globalThis.crypto ||= require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const oldGarment = id => ({ id, name: id, category: 'dresses', color: '', notes: '', aspect: .7, image: PNG, thumb: PNG, original: PNG, createdAt: '2024-01-01', updatedAt: '2024-01-01' });
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} }; this.value = ''; }
  set value(value) { this._value = String(value); } get value() { return this._value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  querySelector(tag) { for (const child of this.children) { if (child.tagName === tag.toUpperCase()) return child; const nested = child.querySelector(tag); if (nested) return nested; } return null; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.events.close || []) fn({}); }
  fire(type, extra = {}) { const e = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events[type] || []) fn(e); }
}
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function start(records, options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const errors = [], downloads = [], writes = [], timers = [], memory = { garments: records, outfits: options.outfits || [], meta: options.meta || [] }, session = options.session || new Map(), persistent = options.persistent || new Map();
  const document = { getElementById: id => { assert.ok(elements[id], 'missing form element: ' + id); return elements[id]; },
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  const DB = { open: async () => {}, read: async store => structuredClone(memory[store]),
    write: async operations => { for (const op of operations) { writes.push(op); const items = memory[op.store], index = items.findIndex(g => g.id === (op.value?.id || op.id)); if (op.type === 'delete') { if (index >= 0) items.splice(index, 1); } else if (index < 0) items.push(structuredClone(op.value)); else items[index] = structuredClone(op.value); } } };
  const I = { dataUrl: async value => typeof value === 'string' ? value : 'data:' + value.type + ';base64,' + Buffer.from(await value.arrayBuffer()).toString('base64'), fromDataUrl: value => value, load: async () => ({ naturalWidth: 1, naturalHeight: 1 }), download: blob => downloads.push(blob) };
  const window = { WardrobeCore: C, WardrobeStorage: DB, WardrobeImages: I, WardrobeCloud: options.api ? { ...Cloud, createClient: args => Cloud.createClient({ ...args, fetch: options.api.fetch, minWriteGap: 0 }) } : Cloud,
    sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    localStorage: { getItem: key => persistent.get(key), setItem: (key, value) => { if (options.blockPersistence) throw new Error('storage blocked'); persistent.set(key, value); }, removeItem: key => persistent.delete(key) }, addEventListener() {} };
  await vm.runInNewContext(source, { window, document, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, console: { error: error => errors.push(error) },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; } });
  return { elements, errors, downloads, writes, memory, session, persistent, runStartup: () => { for (const timer of timers.slice()) if (timer?.delay === 0) timer.fn(); } };
}
function find(parent, className) { for (const child of parent.children) { if (child.className === className) return child; const nested = find(child, className); if (nested) return nested; } }
function openRecord(app, index = 0) { find(app.elements['garment-grid'].children[index], 'garment-title').onclick(); }

test('the real edit handlers save, reopen, export and restore every record field without losing images', async () => {
  const records = [oldGarment('g_1'), oldGarment('g_2')], app = await start(records);
  assert.equal(app.errors.length, 0); openRecord(app);
  const inputs = { 'edit-name': 'The Simone', 'edit-brand': 'Réalisation Par', 'edit-color': 'Chocolate Havana', 'edit-category': 'dresses',
    'edit-subcategory': 'Maxi Dress', 'edit-style': '挂脖、露背、修身长裙', 'edit-pattern': '棕白花卉印花', 'edit-size': 'XS',
    'edit-price': '290.00', 'edit-original-price': '390', 'edit-condition': 'secondhand', 'edit-purchase-type': 'sale', 'edit-source': 'Vinted',
    'edit-currency': 'GBP', 'edit-date': '2024-06-26', 'edit-status': 'owned', 'edit-notes': '官网购入' };
  for (const [id, value] of Object.entries(inputs)) app.elements[id].value = value;
  app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.errors.length, 0); assert.equal(records[0].brand, 'Réalisation Par'); assert.equal(records[0].purchasePrice, 290);
  assert.equal(records[0].image, PNG); assert.equal(records[0].original, PNG);
  const reloaded = await start(records); openRecord(reloaded);
  for (const [id, value] of Object.entries(inputs)) assert.equal(reloaded.elements[id].value, id === 'edit-price' ? '290' : value, id);
  openRecord(reloaded, 1);
  for (const id of ['edit-brand', 'edit-subcategory', 'edit-style', 'edit-pattern', 'edit-size', 'edit-price', 'edit-original-price', 'edit-condition', 'edit-purchase-type', 'edit-source', 'edit-date']) assert.equal(reloaded.elements[id].value, '', id + ' must not leak across garments');
  reloaded.elements['export-backup'].fire('click'); await flush();
  const exported = JSON.parse(await reloaded.downloads[0].text());
  const importedRecords = [], imported = await start(importedRecords);
  imported.elements['restore-input'].files = [{ size: 1000, text: async () => JSON.stringify(exported) }];
  imported.elements['restore-input'].fire('change'); await flush();
  assert.equal(imported.errors.length, 0); assert.equal(importedRecords.length, 2);
  assert.deepEqual(importedRecords[0], { ...records[0], favorite: false, demo: false });
  openRecord(imported); imported.elements['edit-price'].value = '0'; imported.elements['edit-date'].value = ''; imported.elements['edit-size'].value = '';
  imported.elements['edit-form'].fire('submit'); await flush();
  assert.equal(importedRecords[0].purchasePrice, 0); assert.equal(importedRecords[0].purchaseDate, ''); assert.equal(importedRecords[0].size, '');
  openRecord(imported); imported.elements['edit-price'].value = ''; imported.elements['edit-status'].value = 'wishlist';
  imported.elements['edit-form'].fire('submit'); await flush();
  assert.equal(importedRecords[0].purchasePrice, null); assert.equal(importedRecords[0].purchaseStatus, 'wishlist');
});

test('invalid purchase input leaves the existing record and editor intact', async () => {
  const records = [oldGarment('g_1')], before = structuredClone(records[0]), app = await start(records);
  openRecord(app); app.elements['edit-price'].value = '-5'; app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.writes.length, 0); assert.deepEqual(records[0], before); assert.equal(app.elements['edit-dialog'].open, true);
  assert.match(app.errors[0].message, /价格/);
});

test('brand selections combine with search and category without changing whole-wardrobe value', async () => {
  const records = [
    { ...oldGarment('g_1'), brand: 'Réalisation Par', purchasePrice: 100, originalPrice: 290 },
    { ...oldGarment('g_2'), brand: 'realisation par', category: 'tops', purchasePrice: 35, originalPrice: 200, purchaseCondition: 'secondhand' },
    { ...oldGarment('g_3'), brand: 'Sézane', purchasePrice: 60, originalPrice: 100 },
    { ...oldGarment('g_4'), brand: 'Réalisation Par', purchasePrice: 1000, purchaseStatus: 'wishlist' },
    { ...oldGarment('g_5'), brand: 'Réalisation Par', purchasePrice: 999, demo: true }
  ];
  const app = await start(records), el = app.elements;
  const cards = () => el['garment-grid'].children.filter(c => c.className === 'garment-card');
  const value = () => el['closet-purchase-total'].children.map(c => c.textContent).join(' ');
  assert.equal(app.errors.length, 0); assert.equal(value(), '£195.00');
  assert.equal(el['brand-filter'].children.length, 3);
  el['brand-filter'].value = 'brand:realisation par'; el['brand-filter'].fire('change');
  assert.equal(cards().length, 4); assert.match(el['filter-summary'].textContent, /£135.00/); assert.equal(value(), '£195.00');
  el['category-tabs'].children.find(c => c.textContent === '上装').onclick();
  assert.equal(cards().length, 1); assert.match(el['filter-summary'].textContent, /£35.00/);
  el.search.value = 'SEZANE'; el.search.fire('input'); assert.equal(cards().length, 0);
  el['reset-filters'].fire('click'); assert.equal(cards().length, 5); assert.equal(el['brand-filter'].value, '');
  assert.equal(value(), '£195.00'); assert.equal(app.writes.length, 0);
});

async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('asynchronous app action did not complete'); }
async function connect(app) {
  const el = app.elements; el['cloud-owner'].value = 'SuzyQi'; el['cloud-repo'].value = 'wardrobe-studio-data'; el['cloud-token'].value = 'unit-test-only';
  el['cloud-form'].fire('submit'); await until(() => el['cloud-button-label'].textContent === '已同步' || app.errors.length);
  assert.deepEqual(app.errors, []);
}
test('the real connection flow syncs private data without storing credentials in IndexedDB or backups', async () => {
  const api = fixture(), record = { ...oldGarment('g_1'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  const app = await start([record], { api }); await connect(app);
  assert.equal(api.manifest().garments.length, 1); assert.equal(app.elements['cloud-token'].value, '');
  assert.equal(app.session.size, 0); assert.equal(app.persistent.size, 0); assert.doesNotMatch(JSON.stringify(app.memory.meta), /unit-test-only/);
  openRecord(app); app.elements['edit-price'].value = '75'; app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.elements['cloud-button-label'].textContent, '待同步');
  app.elements['cloud-sync-now'].fire('click'); await until(() => api.manifest().garments[0].purchasePrice === 75); await flush();
  assert.equal(app.errors.length, 0); assert.equal(app.elements['cloud-button-label'].textContent, '已同步');
  app.elements['export-backup'].fire('click'); await until(() => app.downloads.length > 0);
  const exported = await app.downloads[0].text(); assert.doesNotMatch(exported, /unit-test-only|cloudAssets|cloudOrigin/);
  assert.match(JSON.parse(exported).garments[0].original, /^data:image\/jpeg;base64,/);
});
test('a fresh browser loads cloud metadata and thumbnails while originals remain on demand', async () => {
  const api = fixture(), original = { ...oldGarment('g_1'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  await connect(await start([original], { api }));
  const fresh = await start([], { api }); await connect(fresh); await until(() => fresh.memory.garments[0]?.thumb);
  assert.equal(fresh.memory.garments[0].image, undefined); assert.equal(fresh.memory.garments[0].original, undefined);
  const originalSha = api.manifest().garments[0].assets.original.sha;
  assert.equal(api.rawGets.includes(originalSha), false);
  fresh.elements['export-backup'].fire('click'); await until(() => fresh.downloads.length > 0);
  assert.ok(api.rawGets.includes(originalSha)); assert.equal(fresh.errors.length, 0);
});
test('device opt-in survives a new browser session, reconnects automatically, and disconnect forgets it', async () => {
  const api = fixture(), app = await start([], { api }); app.elements['cloud-remember'].checked = true; await connect(app);
  assert.equal(app.session.size, 0); assert.equal(app.persistent.size, 1); assert.doesNotMatch(JSON.stringify(app.memory.meta), /unit-test-only/);
  const reopened = await start([], { api, persistent: app.persistent }); reopened.runStartup();
  await until(() => reopened.elements['cloud-button-label'].textContent === '已同步' || reopened.errors.length);
  assert.deepEqual(reopened.errors, []); assert.equal(reopened.elements['cloud-token'].value, '');
  reopened.elements['open-cloud'].fire('click'); assert.equal(reopened.elements['cloud-remember'].checked, true);
  reopened.elements['export-backup'].fire('click'); await until(() => reopened.downloads.length);
  assert.doesNotMatch(await reopened.downloads[0].text(), /unit-test-only/);
  reopened.elements['cloud-disconnect'].fire('click'); assert.equal(app.persistent.size, 0); assert.equal(reopened.session.size, 0);
  assert.equal(reopened.elements['cloud-sync-now'].disabled, true);
  const forgotten = await start([], { api, persistent: app.persistent }); forgotten.runStartup(); await flush();
  assert.equal(forgotten.elements['cloud-button-label'].textContent, 'GitHub 同步');
});
test('a connected device can opt in or forget without entering the token again', async () => {
  const api = fixture(), app = await start([], { api }); await connect(app);
  app.elements['cloud-remember'].checked = true; app.elements['cloud-remember'].fire('change');
  assert.equal(app.persistent.size, 1); assert.equal(app.elements['cloud-token'].value, '');
  app.elements['cloud-remember'].checked = false; app.elements['cloud-remember'].fire('change');
  assert.equal(app.persistent.size, 0); assert.equal(app.elements['cloud-sync-now'].disabled, false);
  app.elements['cloud-sync-now'].fire('click'); await flush(); assert.deepEqual(app.errors, []);
});
test('blocked persistent storage reports failure while preserving the synced wardrobe', async () => {
  const api = fixture(), app = await start([], { api, blockPersistence: true }); app.elements['cloud-remember'].checked = true; await connect(app);
  assert.equal(app.persistent.size, 0); assert.equal(app.elements['cloud-button-label'].textContent, '已同步');
  assert.match(app.elements.toast.textContent, /未能保存授权/); assert.doesNotMatch(JSON.stringify(app.memory.meta), /unit-test-only/);
});
test('legacy tab authorization reconnects without silently opting into device storage', async () => {
  const api = fixture(), session = new Map([['wardrobe-github-session', JSON.stringify({ owner: 'SuzyQi', repo: 'wardrobe-studio-data', token: 'unit-test-only' })]]);
  const app = await start([], { api, session }); app.runStartup();
  await until(() => app.elements['cloud-button-label'].textContent === '已同步' || app.errors.length);
  assert.deepEqual(app.errors, []); assert.equal(app.session.size, 1); assert.equal(app.persistent.size, 0);
  app.elements['open-cloud'].fire('click'); assert.equal(app.elements['cloud-remember'].checked, false);
});
test('malformed remembered credentials do not prevent opening the local wardrobe', async () => {
  for (const value of ['{broken', 'null', '{"token":"unit-test-only"}']) {
    const app = await start([], { persistent: new Map([['wardrobe-github-device', value]]) }); app.runStartup(); await flush();
    assert.deepEqual(app.errors, []); assert.equal(app.elements['cloud-button-label'].textContent, 'GitHub 同步');
  }
});
test('a missing cloud manifest preserves local records and the previous sync checkpoint', async () => {
  const api = fixture(), record = { ...oldGarment('g_1'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  const app = await start([record], { api }); await connect(app);
  const checkpoint = app.memory.meta.find(g => g.id === 'github-sync').head; api.deleteManifest();
  app.elements['cloud-sync-now'].fire('click'); await until(() => app.errors.length > 0);
  assert.match(app.errors[0].message, /文件缺失/); assert.equal(app.memory.garments.length, 1);
  assert.equal(app.memory.meta.find(g => g.id === 'github-sync').head, checkpoint);
});
