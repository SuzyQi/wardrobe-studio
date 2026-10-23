const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const K = require('../color-core.js');
const Cloud = require('../cloud.js');
const Memorial = require('../memorial.js');
const ArchiveBook = require('../archive-book.js');
const { fixture } = require('./helpers/github-fixture.cjs');
globalThis.crypto ||= require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';

test('brand choices include requested brands and existing names, and choosing or typing a brand persists', async () => {
  const records = [{ ...oldGarment('first'), brand: 'COS' }, { ...oldGarment('second'), brand: 'COS' }];
  const app = await start(records), el = app.elements; openRecord(app);
  const labels = el['edit-brand-choice'].children.map(o => o.value);
  for (const brand of ['Gucci', 'Chanel', 'Uniqlo', 'Crocs', 'COS', 'Paloma Wool', 'Rarely Alike', 'Moon Boot', 'Zara', 'Lululemon', 'Rab', 'Skims', 'Vintage', 'Tory Burch', 'Max Mara', 'Ganni', 'Balmain', 'LK Bennett', 'Moncler', 'Burberry', 'Renlisu', 'Shiatzy Chen', 'Dolce & Gabbana', 'New Balance', 'Abra', 'Needle And Thread', 'Givenchy']) assert.ok(labels.includes(brand), brand);
  assert.equal(labels[1], 'COS');
  el['edit-brand-choice'].value = 'Gucci'; el['edit-brand-choice'].fire('change');
  assert.equal(el['edit-brand'].value, 'Gucci');
  el['edit-form'].fire('submit'); await flush();
  assert.equal(records[0].brand, 'Gucci'); assert.equal(records[1].brand, 'COS');
  assert.ok(el['brand-filter'].children.some(o => o.value === 'brand:gucci'));
  const reloaded = await start(records); openRecord(reloaded);
  assert.equal(reloaded.elements['edit-brand-choice'].value, 'Gucci');
  reloaded.elements['edit-brand-choice'].value = '__custom__'; reloaded.elements['edit-brand-choice'].fire('change');
  assert.equal(reloaded.elements['edit-brand'].hidden, false);
  reloaded.elements['edit-brand'].value = 'Independent Studio'; reloaded.elements['edit-brand'].fire('input');
  assert.equal(reloaded.elements['edit-brand-choice'].value, '__custom__');
  reloaded.elements['edit-form'].fire('submit'); await flush();
  assert.equal(records[0].brand, 'Independent Studio');
  const again = await start(records); openRecord(again);
  assert.equal(again.elements['edit-brand-choice'].value, 'Independent Studio');
  assert.deepEqual(app.errors, []); assert.deepEqual(reloaded.errors, []); assert.deepEqual(again.errors, []);
});
test('upload cards save a selected brand and a manually entered new brand independently', async () => {
  const app = await start([]), el = app.elements; el['batch-category'].value = 'auto';
  el['file-input'].files = ['dress.png', 'shirt.png'].map(name => Object.assign(new Blob(['photo'], { type: 'image/png' }), { name }));
  el['file-input'].fire('change'); await flush();
  const first = find(el['upload-list'].children[0], 'upload-brand'), second = find(el['upload-list'].children[1], 'upload-brand');
  first.querySelector('select').value = 'Chanel'; first.querySelector('select').fire('change');
  second.querySelector('select').value = '__custom__'; second.querySelector('select').fire('change');
  second.querySelector('input').value = 'New Label'; second.querySelector('input').fire('input');
  el['confirm-upload'].fire('click'); await flush();
  assert.equal(app.memory.garments[0].brand, 'Chanel'); assert.equal(app.memory.garments[1].brand, 'New Label');
  assert.ok(el['brand-filter'].children.some(o => o.value === 'brand:chanel'));
  assert.ok(el['brand-filter'].children.some(o => o.value === 'brand:new label'));
  assert.deepEqual(app.errors, []);
});
const oldGarment = id => ({ id, name: id, category: 'dresses', color: '', notes: '', aspect: .7, image: PNG, thumb: PNG, original: PNG, createdAt: '2024-01-01', updatedAt: '2024-01-01' });
test('existing brands display normalized before editing and manual lowercase input saves normalized without changing assets or prices', async () => {
  const g = { ...oldGarment('existing'), brand: 'maison margiela', purchasePrice: 123, originalPrice: 200, notes: 'Keep me' };
  const app = await start([g]), el = app.elements;
  assert.ok(textOf(el['garment-grid']).includes('Maison Margiela'));
  assert.ok(el['brand-filter'].children.some(o => o.textContent === 'Maison Margiela（1）'));
  openRecord(app);
  assert.equal(el['edit-brand-choice'].value, 'Maison Margiela');
  el['edit-brand-choice'].value = '__custom__'; el['edit-brand-choice'].fire('change');
  el['edit-brand'].value = '  rarely   alike '; el['edit-brand'].fire('input');
  el['edit-form'].fire('submit'); await flush();
  const saved = app.memory.garments[0];
  assert.equal(saved.brand, 'Rarely Alike');
  for (const key of ['id','image','thumb','original','purchasePrice','originalPrice','notes','createdAt']) assert.deepEqual(saved[key],g[key],key);
  assert.equal(el['edit-brand-choice'].children.filter(o=>o.value==='Rarely Alike').length, 1);
  const reloaded=await start(app.memory.garments); openRecord(reloaded);
  assert.equal(reloaded.elements['edit-brand-choice'].value,'Rarely Alike');
  assert.deepEqual(app.errors, []);
});
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} }; this.value = ''; this.isConnected = false; }
  set value(value) { this._value = String(value); } get value() { return this._value; }
  setConnected(value) { this.isConnected = value; for (const child of this.children) child.setConnected?.(value); }
  append(...children) { this.children.push(...children); for (const child of children) child.setConnected?.(this.isConnected); }
  replaceChildren(...children) { for (const child of this.children) child.setConnected?.(false); this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  querySelector(tag) { for (const child of this.children) { if (child.tagName === tag.toUpperCase()) return child; const nested = child.querySelector(tag); if (nested) return nested; } return null; }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.events.close || []) fn({}); }
  fire(type, extra = {}) { const e = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events[type] || []) fn(e); this['on' + type]?.(e); }
}
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function start(records, options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  for (const element of Object.values(elements)) element.setConnected(true);
  const navigation = [...html.matchAll(/<button[^>]*data-view="([^"]+)"[^>]*>/g)].map(match => { const el = new Element('button'); el.dataset.view = match[1]; return el; });
  const errors = [], downloads = [], writes = [], timers = [], memory = { garments: records, outfits: options.outfits || [], meta: options.meta || [] }, session = options.session || new Map(), persistent = options.persistent || new Map();
  const windowEvents = {}, documentEvents = {}, objectUrls = [], revokedUrls = [];
  const document = { getElementById: id => { assert.ok(elements[id], 'missing form element: ' + id); return elements[id]; }, visibilityState: 'visible',
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: text => Object.assign(new Element('text'), { textContent: text }), querySelectorAll: selector => selector === '[data-view]' ? navigation : [],
    querySelector: selector => selector.startsWith('dialog[open]') ? Object.entries(elements).find(([id, el]) => el.open && !(selector.includes(':not(#archive-dialog)') && id === 'archive-dialog'))?.[1] || null : null,
    addEventListener: (type, fn) => { (documentEvents[type] ||= []).push(fn); } };
  const DB = { open: async () => {}, read: async store => {
      const values = structuredClone(memory[store]);
      if (store === 'garments' && options.unreadableCaches) for (const g of values) for (const field of options.unreadableCaches) if (g[field] instanceof Blob) Object.defineProperty(g[field], 'arrayBuffer', { value: async () => { throw new Error('cached file missing'); } });
      return values;
    },
    write: async operations => { if (options.failWrites > 0) { options.failWrites--; throw new Error('本机存储空间不足，请导出备份后重试。'); }
      if (options.rejectWrite?.(operations)) throw Object.assign(new Error('Error preparing Blob/File data'), { name: 'UnknownError' });
      if (options.validateImageReads) for (const op of operations) if (op.store === 'garments' && op.value) for (const field of C.imageFields(op.value)) if (op.value[field] instanceof Blob) {
        try { await op.value[field].arrayBuffer(); } catch { throw Object.assign(new Error('本机图片缓存无法读取'), { name: 'ImageReadError', garmentId: op.value.id, field }); }
      }
      for (const op of operations) { writes.push(op); const items = memory[op.store], index = items.findIndex(g => g.id === (op.value?.id || op.id)); if (op.type === 'delete') { if (index >= 0) items.splice(index, 1); } else if (index < 0) items.push(structuredClone(op.value)); else items[index] = structuredClone(op.value); } } };
  const drawings = [];
  const I = { dataUrl: async value => typeof value === 'string' ? value : 'data:' + value.type + ';base64,' + Buffer.from(await value.arrayBuffer()).toString('base64'), fromDataUrl: value => value, load: async () => ({ naturalWidth: 1, naturalHeight: 1 }), download: blob => downloads.push(blob),
    prepare: async file => { if (file.type !== 'image/png') throw new Error('不支持的图片'); return { image: file }; },
    canvas: (width, height) => { const lines = [], context = { fillRect() {}, drawImage: (...args) => drawings.push(args), fillText: text => lines.push(text), measureText(text) { return { width: [...text].length * parseInt(this.font) }; } }; return { width, height, lines, getContext: () => context }; },
    blob: async canvas => new Blob([JSON.stringify({ width: canvas.width, height: canvas.height, text: canvas.lines.join('') })], { type: 'image/png' }) };
  I.suggestColor = options.suggestColor || (async () => ({ mainColor: 'blue', colorSource: 'auto' }));
  const window = { WardrobeColor: K, WardrobeCore: C, WardrobeStorage: DB, WardrobeImages: I, WardrobeMemorial: Memorial, WardrobeArchiveBook: ArchiveBook, WardrobeCloud: options.api ? { ...Cloud, createClient: args => Cloud.createClient({ ...args, fetch: options.api.fetch, minWriteGap: 0 }) } : Cloud,
    sessionStorage: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    localStorage: { getItem: key => persistent.get(key), setItem: (key, value) => { if (options.blockPersistence) throw new Error('storage blocked'); persistent.set(key, value); }, removeItem: key => persistent.delete(key) }, addEventListener: (type, fn) => { (windowEvents[type] ||= []).push(fn); } };
  await vm.runInNewContext(source, { window, document, Blob, URL: { createObjectURL: blob => { const url = 'blob:test-' + objectUrls.length; objectUrls.push({ url, blob }); return url; }, revokeObjectURL: url => revokedUrls.push(url) }, console: { error: error => errors.push(error) },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; } });
  return { elements, navigation, errors, downloads, drawings, writes, memory, session, persistent, objectUrls, revokedUrls,
    fireWindow: (type, event = {}) => { for (const fn of windowEvents[type] || []) fn(event); }, fireDocument: type => { for (const fn of documentEvents[type] || []) fn({}); },
    runStartup: () => { for (const timer of timers.slice()) if (timer?.delay === 0) timer.fn(); },
    runSyncTimer: () => { const index = timers.findIndex(timer => timer?.delay === 3000); if (index < 0) return false; const timer = timers[index]; timers[index] = null; timer.fn(); return true; } };
}
function find(parent, className) { for (const child of parent.children) { if (child.className === className) return child; const nested = find(child, className); if (nested) return nested; } }
function openRecord(app, index = 0) { find(app.elements['garment-grid'].children[index], 'icon-button card-edit').onclick(); }
function openBook(app) { app.navigation.find(button => button.dataset.view === 'book').onclick(); if (app.elements['book-index'].hidden) app.elements['book-directory-toggle'].fire('click'); if (!app.elements['book-show-record'].disabled) app.elements['book-show-record'].fire('click'); }
function textOf(el) { return [el.textContent || '', ...el.children.map(textOf)].join(' '); }
function bookGarment() { return { ...oldGarment('g_book'), brand: 'Zimmermann', name: '秀款露背旗袍', purchasePrice: 1500, currency: 'CNY', archive: { year: '2020', season: 'resort', relation: 'runway_match', verification: 'pending', sourceUrl: 'Vogue Runway / 卖家提供', story: '找到这件衣服的故事', photos: [{ id: 'p_runway', kind: 'runway', caption: '秀场参考图', sourceUrl: 'https://example.com/runway' }, { id: 'p_detail', kind: 'detail', caption: '面料与标签', sourceUrl: '' }] }, photo_p_runway: PNG, photo_p_detail: PNG }; }

test('color chips combine colors with OR and brand/category/search with AND; reset restores all clothes', async()=>{
 const records=[{...oldGarment('blue'),brand:'COS',mainColor:'blue',color:'Navy'},{...oldGarment('white'),brand:'COS',mainColor:'white'},{...oldGarment('pink'),brand:'Other',mainColor:'pink'},oldGarment('pending')],app=await start(records),el=app.elements;
 const chip=id=>el['primary-color-list'].children.find(b=>b.dataset.color===id),count=()=>el['garment-grid'].children.filter(c=>c.className==='garment-card').length;
 chip('blue').onclick();assert.equal(count(),1);assert.match(textOf(el['garment-grid']),/blue/);chip('white').onclick();assert.equal(count(),2);
 el['brand-filter'].value='brand:other';el['brand-filter'].fire('change');assert.equal(count(),0);assert.equal(el['no-results'].hidden,false);chip('all').onclick();assert.equal(count(),1);
 el['reset-filters'].fire('click');assert.equal(count(),4);chip('unknown').onclick();assert.match(textOf(el['garment-grid']),/pending/);assert.equal(app.writes.length,0);assert.equal(records[0].color,'Navy');assert.deepEqual(app.errors,[]);
});
test('bulk color completion preserves manual choices and original color names, and manual correction survives reopening',async()=>{
 const records=[{...oldGarment('manual'),mainColor:'red',colorSource:'manual'},{...oldGarment('new'),color:'Chocolate Havana'}],app=await start(records),el=app.elements;el['complete-colors'].fire('click');await flush();
 assert.equal(records[0].mainColor,'red');assert.equal(records[1].mainColor,'blue');assert.equal(records[1].color,'Chocolate Havana');assert.equal(records[1].colorSource,'auto');assert.match(el['primary-color-status'].textContent,/已补全 1 件/);
 openRecord(app,1);el['edit-main-color'].value='brown';el['edit-main-color'].fire('change');el['edit-form'].fire('submit');await flush();assert.equal(records[1].mainColor,'brown');assert.equal(records[1].colorSource,'manual');assert.equal(records[1].color,'Chocolate Havana');
 const reload=await start(records);openRecord(reload,1);assert.equal(reload.elements['edit-main-color'].value,'brown');assert.deepEqual(app.errors,[]);
});
test('cancelling bulk analysis leaves pending records unchanged; a failed storage write can be retried',async()=>{
 let resolve;const records=[oldGarment('g1')],app=await start(records,{suggestColor:()=>new Promise(r=>resolve=r)});app.elements['complete-colors'].fire('click');await flush();app.elements['color-scan-cancel'].fire('click');resolve({mainColor:'blue',colorSource:'auto'});await flush();assert.equal(records[0].mainColor,undefined);assert.equal(app.writes.filter(op=>op.store==='garments').length,0);
 const retry=[oldGarment('retry')],other=await start(retry,{failWrites:1});other.elements['complete-colors'].fire('click');await flush();assert.equal(retry[0].mainColor,undefined);assert.equal(other.elements['complete-colors'].disabled,false);other.elements['complete-colors'].fire('click');await flush();assert.equal(retry[0].mainColor,'blue');
});

test('new uploads receive automatic main colors and a manual change on the upload card is saved',async()=>{
 const app=await start([]),el=app.elements;el['batch-category'].value='auto';el['file-input'].files=[Object.assign(new Blob(['photo'],{type:'image/png'}),{name:'blue-dress.png'}),Object.assign(new Blob(['photo'],{type:'image/png'}),{name:'shirt.png'})];el['file-input'].fire('change');await flush();
 const choose=find(el['upload-list'].children[0],'upload-color').querySelector('select');assert.equal(choose.value,'blue');choose.value='brown';choose.onchange();el['confirm-upload'].fire('click');await flush();assert.equal(app.memory.garments[0].mainColor,'brown');assert.equal(app.memory.garments[0].colorSource,'manual');assert.equal(app.memory.garments[1].mainColor,'blue');assert.equal(app.memory.garments[1].colorSource,'auto');assert.deepEqual(app.errors,[]);
});

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

test('the real archive editor saves photos and stories, opens a read-only card, exports PNG and restores all photos', async () => {
  const records = [oldGarment('g_archive')], app = await start(records), el = app.elements;
  find(el['garment-grid'].children[0], 'garment-title').onclick();
  assert.equal(el['archive-dialog'].open, true); assert.equal(el['edit-dialog'].open, undefined);
  el['archive-edit'].fire('click'); assert.equal(el['archive-dialog'].open, false); assert.equal(el['edit-dialog'].open, true);
  el['archive-year'].value = '2020'; el['archive-season'].value = 'resort'; el['archive-relation'].value = 'runway_match';
  el['archive-collection'].value = 'Collection'; el['archive-source'].value = 'https://www.zimmermann.com/'; el['archive-story'].value = '终于找到它\n属于我的纪念';
  el['edit-brand'].value = 'Zimmermann'; el['edit-price'].value = '1500'; el['edit-currency'].value = 'CNY';
  el['archive-files'].files = [new Blob(['runway'], { type: 'image/png' })]; el['archive-files'].fire('change');
  await until(() => el['archive-photo-editors'].children.length === 1 || app.errors.length); assert.deepEqual(app.errors, []);
  assert.equal(records[0].archive, undefined, 'upload is staged until Save');
  el['edit-form'].fire('submit'); await flush(); assert.deepEqual(app.errors, []);
  const saved = records[0], field = 'photo_' + saved.archive.photos[0].id;
  assert.equal(saved.archive.story, '终于找到它\n属于我的纪念'); assert.ok(saved[field] instanceof Blob);
  assert.equal(el['archive-dialog'].open, true); assert.equal(el['archive-gallery'].children.length, 2);
  assert.equal(el['archive-story-text'].textContent, saved.archive.story);
  el['archive-export'].fire('click'); await until(() => app.downloads.length || app.errors.length); assert.deepEqual(app.errors, []);
  const card = JSON.parse(await app.downloads[0].text()); assert.equal(card.width, 1200); assert.match(card.text, /终于找到它/); assert.doesNotMatch(card.text, /实付|1,500/); assert.equal(app.drawings.length, 2);
  el['archive-export-price'].checked = true; el['archive-export'].fire('click'); await until(() => app.downloads.length === 2 || app.errors.length);
  assert.match(JSON.parse(await app.downloads[1].text()).text, /1,500/);
  el['export-backup'].fire('click'); await until(() => app.downloads.length === 3 || app.errors.length);
  const backup = JSON.parse(await app.downloads[2].text()); assert.equal(backup.version, 2); assert.match(backup.garments[0][field], /^data:image\/png;base64,/);
  const restored = await start([]); restored.elements['restore-input'].files = [{ size: 1000, text: async () => JSON.stringify(backup) }]; restored.elements['restore-input'].fire('change'); await flush();
  assert.deepEqual(restored.errors, []); assert.deepEqual(restored.memory.garments[0].archive, saved.archive); assert.equal(restored.memory.garments[0][field], backup.garments[0][field]);
  openRecord(app); const remove = el['archive-photo-editors'].children[0].children[1].children.at(-1); remove.onclick();
  el['edit-dialog'].close(); assert.equal(records[0].archive.photos.length, 1, 'cancelling removal retains the saved photo');
});
test('a failed image batch and unsafe archive source leave the saved garment untouched', async () => {
  const app = await start([oldGarment('g_1')]); openRecord(app);
  app.elements['archive-files'].files = [new Blob(['valid'], { type: 'image/png' }), new Blob(['invalid'], { type: 'text/plain' })]; app.elements['archive-files'].fire('change');
  await until(() => app.errors.length); assert.equal(app.elements['archive-photo-editors'].children.length, 0); assert.equal(app.writes.length, 0);
  app.elements['archive-source'].value = 'javascript:alert(1)'; app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.writes.length, 0); assert.equal(app.elements['edit-dialog'].open, true); assert.match(app.errors.at(-1).message, /来源/);
});

test('cached images receive sources before attachment and survive mobile page hiding and return', async () => {
  const g = { ...oldGarment('g_mobile'), image: new Blob(['image'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }) }, app = await start([g]);
  let img = app.elements['garment-grid'].children[0].querySelector('img');
  assert.match(img.src, /^blob:test-/); assert.equal(img.loading, 'eager'); const first = img.src;
  app.fireWindow('pagehide', { persisted: true }); assert.equal(app.revokedUrls.includes(first), false);
  app.fireWindow('pageshow', { persisted: true }); img = app.elements['garment-grid'].children[0].querySelector('img');
  assert.match(img.src, /^blob:test-/); assert.equal(app.revokedUrls.includes(img.src), false);
  openRecord(app); app.elements['edit-name'].value = '尚未保存的名称'; app.fireDocument('visibilitychange');
  assert.equal(app.elements['edit-name'].value, '尚未保存的名称'); assert.equal(app.memory.garments[0].name, 'g_mobile');
  assert.match(app.elements['edit-image'].src, /^blob:test-/); assert.equal(app.writes.length, 0);
});
test('image decode errors renew the URL, use the full image, and stop retries without losing records', async () => {
  const g = { ...oldGarment('g_mobile'), image: new Blob(['png'], { type: 'image/png' }), thumb: new Blob(['webp'], { type: 'image/webp' }) }, app = await start([g]);
  const img = app.elements['garment-grid'].children[0].querySelector('img'), first = img.src;
  img.fire('error'); await flush(); assert.notEqual(img.src, first);
  img.fire('error'); await flush(); assert.equal(await app.objectUrls.find(x => x.url === img.src).blob.text(), await g.image.text());
  img.fire('load'); assert.equal(img.style.opacity, '');
  img.fire('error'); await flush(); assert.match(img.title, /立即同步/);
  const attempts = app.objectUrls.length; img.fire('error'); await flush(); assert.equal(app.objectUrls.length, attempts);
  assert.equal(app.writes.length, 0); assert.equal(app.memory.garments[0].thumb, g.thumb); assert.equal(app.memory.garments[0].image, g.image);
});
test('a fresh connected phone can recover a failed thumbnail using a verified full photo', async () => {
  const api = fixture(), g = { ...oldGarment('g_mobile'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumbnail'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  await connect(await start([g], { api }));
  const phone = await start([], { api }); await connect(phone); await until(() => phone.memory.garments[0]?.thumb);
  const img = phone.elements['garment-grid'].children[0].querySelector('img');
  img.fire('error'); await flush(); img.fire('error');
  await until(() => phone.memory.garments[0].image); await flush(); img.fire('load');
  assert.equal(await phone.memory.garments[0].image.text(), 'display'); assert.equal(img.style.opacity, '');
  assert.ok(api.rawGets.includes(api.manifest().garments[0].assets.image.sha));
  assert.equal(phone.elements['cloud-button-label'].textContent, '已同步'); assert.deepEqual(phone.errors, []);
});

test('plain provenance and scheme-less links save in the actual form and render as text or safe links', async () => {
  const app = await start([oldGarment('g_sources')]); openRecord(app);
  app.elements['archive-source'].value = 'Vogue Runway / 卖家提供'; app.elements['edit-form'].fire('submit'); await flush();
  assert.deepEqual(app.errors, []); assert.equal(app.memory.garments[0].archive.sourceUrl, 'Vogue Runway / 卖家提供');
  const note = app.elements['archive-reference'].children[0]; assert.equal(note.tagName, 'P'); assert.equal(note.textContent, 'Vogue Runway / 卖家提供');
  openRecord(app); app.elements['archive-source'].value = 'www.zimmermann.com/'; app.elements['edit-form'].fire('submit'); await flush();
  const link = app.elements['archive-reference'].children[0]; assert.equal(link.tagName, 'A'); assert.equal(link.href, 'https://www.zimmermann.com/');
  assert.equal(app.elements['edit-save'].disabled, false);
});
test('save validation errors are visible inside the dialog, retain input and allow retry', async () => {
  const app = await start([oldGarment('g_validation')]); openRecord(app);
  app.elements['archive-year'].value = '20'; app.elements['archive-story'].value = '不要丢掉的故事';
  app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.elements['edit-error'].hidden, false); assert.match(app.elements['edit-error'].textContent, /四位年份/);
  assert.equal(app.elements['archive-story'].value, '不要丢掉的故事'); assert.equal(app.elements['edit-dialog'].open, true); assert.equal(app.writes.length, 0);
  app.elements['archive-year'].value = ''; app.elements['edit-price'].validity = { badInput: true }; app.elements['edit-form'].fire('submit'); await flush();
  assert.match(app.elements['edit-error'].textContent, /实际购入价/); assert.equal(app.writes.length, 0);
  app.elements['edit-price'].validity = { badInput: false }; app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.memory.garments[0].archive.story, '不要丢掉的故事'); assert.equal(app.elements['edit-error'].hidden, true); assert.equal(app.elements['edit-dialog'].open, false);
});
test('storage errors keep the editor intact, show an inline error and allow a successful second save', async () => {
  const app = await start([oldGarment('g_quota')], { failWrites: 1 }); openRecord(app);
  app.elements['edit-name'].value = '新名称'; app.elements['archive-story'].value = '保留这段故事'; app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.memory.garments[0].name, 'g_quota'); assert.equal(app.elements['edit-dialog'].open, true);
  assert.equal(app.elements['edit-error'].hidden, false); assert.match(app.elements['edit-error'].textContent, /空间不足/); assert.equal(app.elements['edit-save'].disabled, false);
  app.elements['edit-form'].fire('submit'); await flush(); assert.equal(app.memory.garments[0].name, '新名称'); assert.equal(app.memory.garments[0].archive.story, '保留这段故事');
  assert.equal(app.elements['archive-dialog'].open, true); assert.equal(app.elements['edit-save'].textContent, '保存档案');
});
test('a Blob cache write failure recovers the archive, retains new photos and syncs it to another device', async () => {
  const api = fixture(), options = { api }, record = { ...oldGarment('g_blob'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  const app = await start([record], options); await connect(app);
  options.rejectWrite = ops => ops.some(op => op.store === 'garments' && op.value?.image instanceof Blob);
  openRecord(app); const el = app.elements; el['archive-story'].value = '秀款的收藏故事'; el['edit-price'].value = '1500';
  el['archive-files'].files = [new Blob(['new runway'], { type: 'image/png' })]; el['archive-files'].fire('change');
  await until(() => el['archive-photo-editors'].children.length === 1 || app.errors.length);
  el['edit-form'].fire('submit'); await until(() => el['edit-dialog'].open === false || app.errors.length);
  assert.deepEqual(app.errors, []); const saved = app.memory.garments[0], field = 'photo_' + saved.archive.photos[0].id;
  assert.equal(saved.archive.story, '秀款的收藏故事'); assert.equal(saved.purchasePrice, 1500); assert.equal(saved.image, undefined);
  assert.equal(await saved[field].text(), 'new runway'); assert.ok(saved.cloudAssets.original);
  assert.equal(app.memory.meta.find(m => m.id === 'github-sync').dirty, true);
  el['cloud-sync-now'].fire('click'); await until(() => el['cloud-button-label'].textContent === '已同步' || app.errors.length);
  assert.deepEqual(app.errors, []); assert.equal(api.manifest().garments[0].archive.story, '秀款的收藏故事');
  const phone = await start([], { api }); await connect(phone); openRecord(phone);
  assert.equal(phone.elements['archive-story'].value, '秀款的收藏故事');
  await until(() => phone.memory.garments[0][field] instanceof Blob);
  assert.equal(await phone.memory.garments[0][field].text(), 'new runway');
});
test('if the retry also fails, neither the archive nor checkpoint is reported saved and the new photo remains staged', async () => {
  const api = fixture(), options = { api }, record = { ...oldGarment('g_blocked'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) };
  const app = await start([record], options); await connect(app); options.rejectWrite = () => true; openRecord(app);
  const el = app.elements; el['archive-story'].value = '待恢复故事'; el['archive-files'].files = [new Blob(['unsynced photo'], { type: 'image/png' })]; el['archive-files'].fire('change');
  await until(() => el['archive-photo-editors'].children.length === 1); el['edit-form'].fire('submit'); await until(() => app.errors.length);
  assert.equal(el['edit-dialog'].open, true); assert.equal(el['archive-story'].value, '待恢复故事'); assert.equal(app.memory.garments[0].archive, undefined);
  assert.equal(app.memory.meta.find(m => m.id === 'github-sync').dirty, false); assert.equal(el['edit-error'].hidden, false);
  options.rejectWrite = null; el['edit-form'].fire('submit'); await until(() => el['edit-dialog'].open === false);
  const saved = app.memory.garments[0]; assert.equal(saved.archive.story, '待恢复故事'); assert.equal(await saved['photo_' + saved.archive.photos[0].id].text(), 'unsynced photo');
});
test('saving auto-syncs while the read-only archive stays open, and the card shows completion', async () => {
  const api = fixture(), app = await start([{ ...oldGarment('g_auto'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  await connect(app); openRecord(app); app.elements['archive-story'].value = '保存后自动同步';
  app.elements['edit-form'].fire('submit'); await until(() => app.elements['edit-dialog'].open === false);
  assert.equal(app.elements['archive-dialog'].open, true); assert.match(app.elements['archive-sync-status'].textContent, /等待自动同步/);
  app.elements['archive-export-price'].checked = true; app.elements['archive-gallery'].scrollLeft = 80;
  assert.equal(app.runSyncTimer(), true);
  await until(() => api.manifest().garments[0].archive?.story === '保存后自动同步');
  await until(() => app.elements['cloud-button-label'].textContent === '已同步');
  assert.equal(app.elements['archive-dialog'].open, true); assert.match(app.elements['archive-sync-status'].textContent, /已同步/);
  assert.equal(app.elements['archive-export-price'].checked, true); assert.equal(app.elements['archive-gallery'].scrollLeft, 80); assert.deepEqual(app.errors, []);
});
test('auto-sync waits for active editing and does not include changes the user has not saved', async () => {
  const api = fixture(), app = await start([{ ...oldGarment('g_draft'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  await connect(app); openRecord(app); app.elements['archive-story'].value = '已保存的故事'; app.elements['edit-form'].fire('submit');
  await until(() => app.elements['edit-dialog'].open === false); openRecord(app); app.elements['archive-story'].value = '尚未保存的改动';
  assert.equal(app.runSyncTimer(), true); await flush();
  assert.equal(api.manifest().garments[0].archive, undefined); assert.equal(app.elements['archive-story'].value, '尚未保存的改动');
  app.elements['edit-dialog'].close(); assert.equal(app.runSyncTimer(), true);
  await until(() => app.elements['cloud-button-label'].textContent === '已同步'); assert.equal(api.manifest().garments[0].archive.story, '已保存的故事'); assert.deepEqual(app.errors, []);
});
test('an archive stays saved locally and shows a retry message when automatic network sync fails', async () => {
  const api = fixture(), app = await start([{ ...oldGarment('g_offline'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  await connect(app); openRecord(app); app.elements['archive-story'].value = '网络失败也保留'; app.elements['edit-form'].fire('submit');
  await until(() => app.elements['edit-dialog'].open === false); api.failNext(503); app.runSyncTimer(); await until(() => app.errors.length);
  assert.equal(app.elements['archive-dialog'].open, true); assert.match(app.elements['archive-sync-status'].textContent, /同步未完成/);
  assert.equal(app.memory.garments[0].archive.story, '网络失败也保留'); assert.equal(app.memory.meta.find(m => m.id === 'github-sync').dirty, true);
  assert.equal(api.manifest().garments[0].archive, undefined);
});
test('the archive respects disabled auto-sync and explains that manual sync is required', async () => {
  const api = fixture(), app = await start([{ ...oldGarment('g_manual'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  await connect(app); app.elements['cloud-auto'].checked = false; app.elements['cloud-auto'].fire('change'); await flush();
  openRecord(app); app.elements['archive-story'].value = '手动同步'; app.elements['edit-form'].fire('submit'); await until(() => app.elements['edit-dialog'].open === false);
  assert.equal(app.runSyncTimer(), false); assert.match(app.elements['archive-sync-status'].textContent, /自动同步已关闭/); assert.equal(api.manifest().garments[0].archive, undefined);
  assert.equal(app.memory.garments[0].archive.story, '手动同步'); assert.deepEqual(app.errors, []);
});
test('a clean remembered cloud session recovers unreadable legacy caches, then saves and syncs a new archive photo', async () => {
  const api = fixture(), initial = await start([{ ...oldGarment('g_legacy'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  initial.elements['cloud-remember'].checked = true; await connect(initial);
  const phone = await start(initial.memory.garments, { api, meta: initial.memory.meta, persistent: initial.persistent, unreadableCaches: ['image', 'thumb', 'original'], validateImageReads: true });
  phone.runStartup(); await until(() => phone.elements['cloud-status'].textContent === '已同步，照片和档案保存在私有仓库' || phone.errors.length); assert.deepEqual(phone.errors, []);
  for (const field of ['image', 'thumb', 'original']) assert.equal(await phone.memory.garments[0][field].text(), field === 'image' ? 'display' : field);
  openRecord(phone); phone.elements['archive-story'].value = '旧缓存恢复后保存'; phone.elements['archive-files'].files = [new Blob(['new photo'], { type: 'image/png' })]; phone.elements['archive-files'].fire('change');
  await until(() => phone.elements['archive-photo-editors'].children.length === 1); phone.elements['edit-form'].fire('submit'); await until(() => phone.elements['edit-dialog'].open === false || phone.errors.length);
  assert.deepEqual(phone.errors, []); assert.equal(phone.memory.garments[0].archive.story, '旧缓存恢复后保存');
  phone.runSyncTimer(); await until(() => phone.elements['cloud-button-label'].textContent === '已同步' || phone.errors.length);
  assert.deepEqual(phone.errors, []); assert.equal(api.manifest().garments[0].archive.photos.length, 1);
});
test('a dirty legacy cache is not silently replaced with an older cloud image', async () => {
  const api = fixture(), initial = await start([{ ...oldGarment('g_unsynced'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], { api });
  await connect(initial); const metadata = structuredClone(initial.memory.meta); metadata.find(value => value.id === 'github-sync').dirty = true;
  const phone = await start(initial.memory.garments, { api, meta: metadata, unreadableCaches: ['image'], validateImageReads: true });
  openRecord(phone); phone.elements['archive-story'].value = '保留未同步的输入'; phone.elements['edit-form'].fire('submit'); await until(() => phone.errors.length);
  assert.equal(phone.elements['edit-dialog'].open, true); assert.equal(phone.elements['archive-story'].value, '保留未同步的输入');
  assert.equal(phone.memory.garments[0].archive, undefined); assert.equal(api.manifest().garments[0].archive, undefined);
});
test('a cached image that becomes unreadable during local save is downloaded once and the save is retried', async () => {
  const api = fixture(), options = { api }, app = await start([{ ...oldGarment('g_recover'), image: new Blob(['display'], { type: 'image/png' }), thumb: new Blob(['thumb'], { type: 'image/webp' }), original: new Blob(['original'], { type: 'image/jpeg' }) }], options);
  await connect(app); let failed = false;
  options.rejectWrite = ops => { if (!failed && ops.some(op => op.value?.id === 'g_recover')) { failed = true; throw Object.assign(new Error('unreadable'), { name: 'ImageReadError', garmentId: 'g_recover', field: 'image' }); } return false; };
  openRecord(app); app.elements['archive-story'].value = '保存时恢复缓存'; app.elements['edit-form'].fire('submit');
  await until(() => app.elements['edit-dialog'].open === false || app.errors.length); assert.deepEqual(app.errors, []);
  assert.equal(app.memory.garments[0].archive.story, '保存时恢复缓存'); assert.equal(await app.memory.garments[0].image.text(), 'display');
  assert.equal(api.rawGets.filter(sha => sha === api.manifest().garments[0].assets.image.sha).length, 1);
});
test('the new navigation opens an independent index, preserving the original closet and its filters', async () => {
  const records = [bookGarment(), { ...oldGarment('g_other'), brand: 'House of CB', name: '另一条裙子' }], app = await start(records), el = app.elements;
  const oldCards = el['garment-grid'].children, before = structuredClone(records); openBook(app);
  assert.equal(el.workspace.hidden, true); assert.equal(el['outfits-view'].hidden, true); assert.equal(el['book-view'].hidden, false); assert.equal(el['book-grid'].children.length, 2);
  assert.equal(app.navigation.find(button => button.dataset.view === 'book').attributes['aria-current'], 'page');
  assert.equal(el['garment-grid'].children, oldCards); assert.deepEqual(records, before); assert.equal(app.writes.length, 0);
  el['book-search'].value = 'Zimmermann'; el['book-search'].fire('input'); assert.equal(el['book-grid'].children.length, 1); assert.equal(el.search.value, '');
  el['book-brand'].value = 'brand:house of cb'; el['book-brand'].fire('change'); assert.equal(el['book-grid'].children.length, 0); assert.equal(el['book-no-results'].hidden, false);
  el['book-reset'].fire('click'); assert.equal(el['book-grid'].children.length, 2);
  el['book-filter'].value = 'runway'; el['book-filter'].fire('change'); assert.equal(el['book-grid'].children.length, 1); assert.doesNotMatch(textOf(el['book-grid']), /1,500/);
  el['book-prices'].checked = true; el['book-prices'].fire('change'); assert.match(textOf(el['book-grid']), /1,500/);
  app.navigation.find(button => button.dataset.view === 'closet').onclick(); assert.equal(el.workspace.hidden, false); assert.equal(el['book-view'].hidden, true); assert.equal(el['garment-grid'].children, oldCards); assert.deepEqual(app.errors, []);
});
test('the book opens every photo and provenance, edits shared records, exports cards and adds a garment to the existing board', async () => {
  const records = [bookGarment()], app = await start(records), el = app.elements; openBook(app); el['book-grid'].children[0].fire('click'); await flush();
  assert.equal(el['book-index'].hidden, false); assert.equal(el['book-record'].hidden, false); const text = textOf(el['book-record-body']);
  for (const value of ['秀款露背旗袍', '2020', '待确认', '秀场参考图', '面料与标签', 'Vogue Runway / 卖家提供', '找到这件衣服的故事']) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /1,500/); assert.equal(el['archive-dialog'].open, undefined);
  el['book-edit'].fire('click'); assert.equal(el['edit-dialog'].open, true); el['archive-story'].value = '补充后的共同故事'; el['edit-name'].value = '共同的新名称'; el['edit-form'].fire('submit'); await flush();
  assert.deepEqual(app.errors, []); assert.equal(records[0].archive.story, '补充后的共同故事'); assert.equal(el['book-record'].hidden, false); assert.equal(el['archive-dialog'].open, undefined);
  assert.match(textOf(el['book-record-body']), /共同的新名称/); assert.match(textOf(el['garment-grid']), /共同的新名称/);
  el['book-export'].fire('click'); await until(() => app.downloads.length || app.errors.length); assert.deepEqual(app.errors, []);
  assert.doesNotMatch(JSON.parse(await app.downloads[0].text()).text, /1,500/);
  el['book-export-price'].checked = true; el['book-export'].fire('click'); await until(() => app.downloads.length === 2 || app.errors.length);
  assert.match(JSON.parse(await app.downloads[1].text()).text, /1,500/);
  el['book-style'].fire('click'); await flush(); assert.equal(el.workspace.hidden, false); assert.equal(el['book-view'].hidden, true); assert.equal(el['board-layers'].children.length, 1); assert.deepEqual(app.errors, []);
  find(el['garment-grid'].children[0], 'garment-title').onclick(); assert.equal(el['archive-dialog'].open, true); assert.equal(el['archive-story-text'].textContent, '补充后的共同故事');
});
test('book edits retain unsaved text on storage failure and return to the book after retry', async () => {
  const app = await start([bookGarment()], { failWrites: 1 }), el = app.elements; openBook(app); el['book-grid'].children[0].fire('click'); el['book-edit'].fire('click');
  el['archive-story'].value = '失败后仍在这里'; el['edit-form'].fire('submit'); await flush(); assert.equal(el['edit-dialog'].open, true); assert.equal(el['archive-story'].value, '失败后仍在这里');
  el['edit-form'].fire('submit'); await flush(); assert.equal(el['edit-dialog'].open, false); assert.equal(el['book-record'].hidden, false); assert.match(textOf(el['book-record-body']), /失败后仍在这里/); assert.equal(el['archive-dialog'].open, undefined);
});
test('the book uses fresh private cloud data, loads gallery photos and syncs edits without changing the old viewer', async () => {
  const api = fixture(), g = bookGarment(); for (const field of C.imageFields(g)) g[field] = new Blob([field], { type: 'image/png' });
  await connect(await start([g], { api })); const phone = await start([], { api }); await connect(phone); const el = phone.elements; openBook(phone); el['book-grid'].children[0].fire('click');
  await until(() => phone.memory.garments[0].photo_p_detail); assert.deepEqual(phone.errors, []);
  assert.equal(await phone.memory.garments[0].photo_p_runway.text(), 'photo_p_runway'); assert.match(el['book-sync-status'].textContent, /已同步/);
  el['book-edit'].fire('click'); el['archive-story'].value = '从档案册同步的故事'; el['edit-form'].fire('submit'); await until(() => el['edit-dialog'].open === false || phone.errors.length);
  phone.runSyncTimer(); await until(() => el['cloud-status'].textContent === '已同步，照片和档案保存在私有仓库' || phone.errors.length);
  assert.deepEqual(phone.errors, []); assert.equal(api.manifest().garments[0].archive.story, '从档案册同步的故事'); assert.match(textOf(el['book-record-body']), /从档案册同步的故事/);
});
test('the book handles an empty collection, page turns, return to index and stable references without writes', async () => {
  const empty = await start([]); openBook(empty); assert.equal(empty.elements['book-empty'].hidden, false); assert.equal(empty.elements['book-grid'].children.length, 0); assert.deepEqual(empty.errors, []);
  const records = [bookGarment(), { ...oldGarment('g_z'), brand: 'Zzz', name: '<script>文字名称</script>' }], app = await start(records), el = app.elements;
  const number = ArchiveBook.reference(records[0]); assert.equal(ArchiveBook.reference({ ...records[0], name: '修改名称' }), number);
  openBook(app); el['book-grid'].children[0].fire('click'); assert.equal(el['book-previous'].disabled, true); assert.equal(el['book-next'].disabled, false);
  el['book-next'].fire('click'); assert.match(textOf(el['book-record-body']), /<script>文字名称<\/script>/); assert.equal(el['book-next'].disabled, true);
  el['book-back'].fire('click'); assert.equal(el['book-index'].hidden, false); assert.equal(el['book-record'].hidden, true); assert.equal(el['book-overview'].hidden, false);
  assert.equal(app.writes.length, 0); assert.deepEqual(app.errors, []);
});
test('a persistent vertical index opens the collage immediately, highlights selection and handles an empty filter', async () => {
  const records = [bookGarment(), { ...oldGarment('g_second'), brand: 'House of CB', name: '另一件衣服' }], app = await start(records), el = app.elements;
  openBook(app); assert.equal(el['book-index'].hidden, false); assert.equal(el['book-record'].hidden, false);
  assert.match(textOf(el['book-record-body']), /秀款露背旗袍/);
  let current = el['book-grid'].children.filter(card => card.attributes['aria-current'] === 'true'); assert.equal(current.length, 1); assert.equal(current[0].dataset.garmentId, 'g_book');
  el['book-grid'].children.find(card => card.dataset.garmentId === 'g_second').fire('click');
  assert.equal(el['book-index'].hidden, false); assert.match(textOf(el['book-record-body']), /另一件衣服/);
  current = el['book-grid'].children.filter(card => card.attributes['aria-current'] === 'true'); assert.equal(current.length, 1); assert.equal(current[0].dataset.garmentId, 'g_second');
  el['book-export-price'].checked = true; el['book-search'].value = 'Zimmermann'; el['book-search'].fire('input');
  assert.equal(el['book-grid'].children.length, 1); assert.match(textOf(el['book-record-body']), /秀款露背旗袍/); assert.equal(el['book-export-price'].checked, false);
  el['book-search'].value = '找不到的名字'; el['book-search'].fire('input'); assert.equal(el['book-record'].hidden, true); assert.equal(el['book-no-results'].hidden, false); assert.equal(el['book-index'].hidden, false);
  el['book-reset'].fire('click'); assert.equal(el['book-grid'].children.length, 2); assert.equal(el['book-record'].hidden, false);
  assert.equal(app.writes.length, 0); assert.deepEqual(app.errors, []);
});
test('catalogue cards choose one own runway or garment photo, keeping stories in the reading page', async () => {
  const records = [bookGarment(), { ...oldGarment('g_no_reference'), name: '没有附图的单品', brand: 'Zzz' }], app = await start(records), el = app.elements;
  const before = structuredClone(records); openBook(app);
  const withReference = el['book-grid'].children.find(card => card.dataset.garmentId === 'g_book'), withoutReference = el['book-grid'].children.find(card => card.dataset.garmentId === 'g_no_reference');
  assert.match(find(withReference, 'book-index-photo').querySelector('img').alt, /秀场图：秀款露背旗袍/);
  assert.doesNotMatch(textOf(find(withReference, 'book-index-label')), /找到这件衣服的故事/);
  assert.match(find(withoutReference, 'book-index-photo').querySelector('img').alt, /实物：没有附图的单品/);
  assert.equal(find(withoutReference, 'book-index-reference'), undefined); assert.doesNotMatch(textOf(withoutReference), /REFERENCE|秀场/);
  withReference.fire('click'); assert.match(textOf(el['book-record-body']), /秀款露背旗袍/);
  assert.equal(app.writes.length, 0); assert.deepEqual(records, before); assert.deepEqual(app.errors, []);
});

test('reading layouts adapt to available photographs without inventing history or losing gallery captions', async () => {
  const single = { ...oldGarment('g_single'), name: '只有实物的衣服', brand: 'A' };
  const study = bookGarment(); study.id = 'g_study'; study.brand = 'B'; study.archive.photos = study.archive.photos.filter(p => p.kind === 'detail');
  const contact = bookGarment(); contact.id = 'g_contact'; contact.brand = 'C';
  for (const n of [2, 3]) { const id = 'p_detail_' + n; contact.archive.photos.push({ id, kind: 'detail', caption: '细节 ' + n, sourceUrl: '' }); contact['photo_' + id] = PNG; }
  const records = [single, study, contact], before = structuredClone(records), app = await start(records), el = app.elements;
  openBook(app); el['book-grid'].children[0].fire('click');
  assert.equal(find(el['book-record-body'], 'book-collage').dataset.layout, 'single');
  assert.doesNotMatch(textOf(el['book-record-body']), /2020|第一次遇见|慢慢补齐/);
  find(el['book-record-body'], 'book-text-button book-add-reference').fire('click'); assert.equal(el['edit-dialog'].open, true); el['edit-dialog'].close();
  el['book-next'].fire('click'); assert.equal(find(el['book-record-body'], 'book-collage').dataset.layout, 'study');
  assert.match(textOf(el['book-record-body']), /面料与标签/);
  el['book-next'].fire('click'); assert.equal(find(el['book-record-body'], 'book-collage').dataset.layout, 'comparison');
  const firstPage = find(el['book-record-body'], 'book-stage');
  const continuation = el['book-record-body'].children.find(child => child.className === 'book-stage');
  assert.equal(firstPage.dataset.count, '3'); assert.equal(continuation.dataset.count, '2'); assert.equal(continuation.dataset.page, '2');
  function imageCount(parent) { return (parent.tagName === 'IMG' ? 1 : 0) + parent.children.reduce((sum, child) => sum + imageCount(child), 0); }
  assert.equal(imageCount(el['book-record-body']), 5, 'main image plus every attachment appears exactly once');
  for (const text of ['面料与标签', '细节 2', '细节 3', '找到这件衣服的故事', '待确认']) assert.match(textOf(el['book-record-body']), new RegExp(text));
  assert.equal(app.writes.length, 0); assert.deepEqual(records, before); assert.deepEqual(app.errors, []);
});

test('editing a filtered item keeps its collage selected after its name no longer matches the search', async () => {
  const records = [bookGarment(), { ...oldGarment('g_second'), brand: 'House of CB', name: '另一件衣服' }], app = await start(records), el = app.elements;
  openBook(app); el['book-search'].value = '露背'; el['book-search'].fire('input'); assert.equal(el['book-grid'].children.length, 1);
  el['book-edit'].fire('click'); el['edit-name'].value = '改名后的藏品'; el['edit-form'].fire('submit'); await flush();
  assert.match(textOf(el['book-record-body']), /改名后的藏品/); assert.equal(el['book-search'].value, ''); assert.equal(el['book-grid'].children.length, 2);
  const active = el['book-grid'].children.filter(card => card.dataset.selected === 'true'); assert.equal(active.length, 1); assert.equal(active[0].dataset.garmentId, 'g_book'); assert.equal(el['book-index'].hidden, false); assert.deepEqual(app.errors, []);
});

test('layered photographs open unobstructed with their own full caption and source, without changing the archive', async () => {
  const g = bookGarment(); g.archive.photos[0].caption = '完整秀场图注 '.repeat(24).trim();
  const records = [g], before = structuredClone(records), app = await start(records), el = app.elements; openBook(app);
  const foreground = find(el['book-record-body'], 'book-plate book-layer-front'); foreground.querySelector('button').fire('click');
  assert.equal(el['book-photo-viewer'].open, true); assert.match(el['book-photo-image'].alt, /秀场图：秀款露背旗袍/);
  assert.match(el['book-photo-title'].textContent, /秀场图/); assert.ok(textOf(el['book-photo-note']).includes(g.archive.photos[0].caption));
  assert.equal(el['book-photo-note'].querySelector('a').href, 'https://example.com/runway');
  el['book-photo-close'].fire('click'); assert.equal(el['book-photo-viewer'].open, false);
  const main = find(el['book-record-body'], 'book-plate book-layer-base'); main.querySelector('button').fire('click');
  assert.match(el['book-photo-image'].alt, /实物：秀款露背旗袍/); assert.equal(el['book-photo-note'].querySelector('a'), null);
  el['book-photo-close'].fire('click'); assert.equal(app.writes.length, 0); assert.deepEqual(records, before); assert.deepEqual(app.errors, []);
});

test('the archive directory folds left by default and preserves the active photo page, filters and prices when toggled', async () => {
  const records = [bookGarment()], app = await start(records), el = app.elements;
  app.navigation.find(button => button.dataset.view === 'book').onclick();
  assert.equal(el['book-index'].hidden, true); assert.equal(el['book-overview'].hidden, false); assert.equal(el['book-directory-toggle'].attributes['aria-expanded'], 'false');
  el['book-show-record'].fire('click'); assert.equal(el['book-record'].hidden, false);
  const body = el['book-record-body'].children; el['book-export-price'].checked = true;
  el['book-directory-toggle'].fire('click'); assert.equal(el['book-index'].hidden, false); assert.equal(el['book-shell'].dataset.directory, 'open');
  assert.equal(el['book-record-body'].children, body); assert.equal(el['book-export-price'].checked, true);
  el['book-search'].value = 'Zimmermann'; el['book-search'].fire('input');
  el['book-directory-toggle'].fire('click'); assert.equal(el['book-index'].hidden, true);
  el['book-next'].fire('click'); assert.equal(el['book-index'].hidden, true);
  el['book-directory-toggle'].fire('click'); assert.equal(el['book-index'].hidden, false); assert.equal(el['book-directory-toggle'].attributes['aria-expanded'], 'true');
  assert.equal(el['book-search'].value, 'Zimmermann'); assert.equal(el['book-grid'].children[0].dataset.selected, 'true');
  el['book-directory-toggle'].fire('click'); app.navigation.find(button => button.dataset.view === 'closet').onclick(); app.navigation.find(button => button.dataset.view === 'book').onclick();
  assert.equal(el['book-index'].hidden, true); assert.match(textOf(el['book-record-body']), /秀款露背旗袍/); assert.equal(app.writes.length, 0); assert.deepEqual(app.errors, []);
});

test('the default collection wall contains every garment once and connects its own reference, filters and shared editor', async () => {
  const records = [bookGarment(), ...Array.from({ length: 18 }, (_, i) => ({ ...oldGarment('g_wall_' + i), name: '收藏单品 ' + i, brand: i % 2 ? 'House of CB' : 'Zzz' }))];
  const app = await start(records), el = app.elements;
  app.navigation.find(button => button.dataset.view === 'book').onclick();
  const pieces = () => el['book-wall'].children.flatMap(sheet => sheet.children.filter(child => child.dataset.role === 'hero'));
  assert.equal(el['book-overview'].hidden, false); assert.equal(el['book-record'].hidden, true); assert.equal(el['book-index'].hidden, true);
  assert.equal(pieces().length, 19); assert.equal(new Set(pieces().map(p => p.dataset.garmentId)).size, 19); assert.match(el['book-wall-count'].textContent, /19 件收藏/);
  const zimmermann = pieces().find(p => p.dataset.garmentId === 'g_book');
  assert.equal(find(zimmermann, 'book-wall-photo').children[0].alt, '实物：秀款露背旗袍');
  const ownPhotos = find(el['book-wall'].children.find(sheet => sheet.dataset.garmentId === 'g_book'), 'book-wall-satellites');
  assert.deepEqual(ownPhotos.children.map(mini => mini.querySelector('img').alt), ['秀场图：秀款露背旗袍', '实物细节：秀款露背旗袍']);
  assert.equal(el['book-wall'].children.length, 19, 'every garment gets its own complete collage');
  for (const p of pieces().filter(p => p.dataset.garmentId !== 'g_book')) assert.equal(find(p, 'book-wall-reference'), undefined);
  assert.doesNotMatch(textOf(el['book-wall']), /1,500/); zimmermann.fire('click'); assert.equal(el['book-record'].hidden, false); assert.equal(el['book-overview'].hidden, true);
  el['book-edit'].fire('click'); el['edit-name'].value = '拼贴里修改的藏品'; el['edit-form'].fire('submit'); await flush();
  el['book-back'].fire('click'); assert.equal(el['book-overview'].hidden, false); assert.equal(pieces().length, 19); assert.match(textOf(el['book-wall']), /拼贴里修改的藏品/);
  el['book-directory-toggle'].fire('click'); el['book-brand'].value = 'brand:zimmermann'; el['book-brand'].fire('change'); assert.equal(pieces().length, 1);
  el['book-prices'].checked = true; el['book-prices'].fire('change'); assert.match(textOf(el['book-wall']), /1,500/);
  el['book-search'].value = '找不到'; el['book-search'].fire('input'); assert.equal(el['book-overview'].hidden, true); assert.equal(el['book-record'].hidden, true); assert.equal(el['book-no-results'].hidden, false); assert.equal(pieces().length, 0);
  el['book-reset'].fire('click'); assert.equal(pieces().length, 19); assert.equal(el['book-show-wall'].attributes['aria-pressed'], 'true'); assert.deepEqual(app.errors, []);
});

test('each collage leads with its actual garment, uses only its own attachments and leaves unillustrated garments alone', async () => {
  const dress = bookGarment();
  dress.archive.photos.push(...Array.from({ length: 4 }, (_, i) => ({ id: 'p_extra_' + i, kind: 'reference', caption: '本件参考 ' + i, sourceUrl: '' })));
  for (const p of dress.archive.photos) dress['photo_' + p.id] = PNG;
  const records = [dress, { ...oldGarment('g_bag'), category: 'bags', brand: 'Celine', name: '自己的包' }, { ...oldGarment('g_shoes'), category: 'shoes', brand: 'Tabi', name: '自己的鞋' }];
  const before = structuredClone(records), app = await start(records), el = app.elements;
  app.navigation.find(button => button.dataset.view === 'book').onclick();
  assert.equal(el['book-wall'].children.length, 3);
  for (const sheet of el['book-wall'].children) {
    const g = records.find(item => item.id === sheet.dataset.garmentId);
    const heroes = sheet.children.filter(child => child.dataset.role === 'hero'); assert.equal(heroes.length, 1); assert.equal(heroes[0].dataset.garmentId, g.id);
    assert.equal(find(heroes[0], 'book-wall-photo').querySelector('img').alt, '实物：' + g.name);
    const satellites = find(sheet, 'book-wall-satellites');
    if (!g.archive?.photos.length) { assert.equal(satellites, undefined); assert.equal(sheet.dataset.photos, 'single'); continue; }
    assert.equal(satellites.children.length, g.archive.photos.length);
    for (const mini of satellites.children) {
      assert.equal(mini.dataset.garmentId, g.id);
      const photo = g.archive.photos.find(p => p.id === mini.dataset.photoId); assert.ok(photo);
      assert.equal(mini.querySelector('img').alt, C.PHOTO_KINDS[photo.kind] + '：' + g.name);
      mini.fire('click'); assert.equal(el['book-photo-viewer'].open, true);
      assert.equal(el['book-photo-image'].alt, C.PHOTO_KINDS[photo.kind] + '：' + g.name);
      assert.ok(textOf(el['book-photo-note']).includes(photo.caption));
      el['book-photo-close'].fire('click'); assert.equal(el['book-photo-viewer'].open, false);
      assert.equal(el['book-overview'].hidden, false);
    }
  }
  const dressSheet = el['book-wall'].children.find(sheet => sheet.dataset.garmentId === dress.id);
  const story = find(dressSheet, 'book-wall-story'); assert.ok(story); assert.equal(find(story, 'book-wall-story-text').textContent, dress.archive.story);
  assert.equal(find(el['book-wall'].children.find(sheet => sheet.dataset.garmentId === 'g_bag'), 'book-wall-story'), undefined);
  story.fire('click'); assert.equal(el['book-record-body'].dataset.garmentId, dress.id); assert.ok(textOf(el['book-record-body']).includes(dress.archive.story));
  el['book-back'].fire('click');
  const hero = el['book-wall'].children.find(sheet => sheet.dataset.garmentId === dress.id).children[0];
  hero.fire('click'); assert.equal(el['book-record-body'].dataset.garmentId, dress.id);
  el['book-back'].fire('click'); assert.equal(el['book-wall'].children.length, 3);
  assert.equal(app.writes.length, 0); assert.deepEqual(records, before); assert.deepEqual(app.errors, []);
});
