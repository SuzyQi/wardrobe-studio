const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const oldGarment = id => ({ id, name: id, category: 'dresses', color: '', notes: '', aspect: .7, image: PNG, thumb: PNG, original: PNG, createdAt: '2024-01-01', updatedAt: '2024-01-01' });
class Element {
  constructor() { this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.style = { setProperty() {} }; this.classList = { toggle() {}, add() {}, remove() {} }; this.value = ''; }
  set value(value) { this._value = String(value); } get value() { return this._value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const fn of this.events.close || []) fn({}); }
  fire(type, extra = {}) { const e = { target: this, preventDefault() {}, ...extra }; for (const fn of this.events[type] || []) fn(e); }
}
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function start(records) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], new Element()]));
  const errors = [], downloads = [], writes = [];
  const document = { getElementById: id => { assert.ok(elements[id], 'missing form element: ' + id); return elements[id]; },
    createElement: () => new Element(), createElementNS: () => new Element(), querySelectorAll: () => [], addEventListener() {} };
  const DB = { open: async () => {}, read: async store => store === 'garments' ? structuredClone(records) : [],
    write: async operations => { for (const op of operations) { writes.push(op); if (op.store === 'garments') { const index = records.findIndex(g => g.id === op.value.id); if (index < 0) records.push(structuredClone(op.value)); else records[index] = structuredClone(op.value); } } } };
  const I = { dataUrl: async value => value, fromDataUrl: value => value, load: async () => ({ naturalWidth: 1, naturalHeight: 1 }), download: blob => downloads.push(blob) };
  const window = { WardrobeCore: C, WardrobeStorage: DB, WardrobeImages: I, addEventListener() {} };
  await vm.runInNewContext(source, { window, document, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, console: { error: error => errors.push(error) }, setTimeout: () => 1, clearTimeout() {} });
  return { elements, errors, downloads, writes };
}
function find(parent, className) { for (const child of parent.children) { if (child.className === className) return child; const nested = find(child, className); if (nested) return nested; } }
function openRecord(app, index = 0) { find(app.elements['garment-grid'].children[index], 'garment-title').onclick(); }

test('the real edit handlers save, reopen, export and restore every record field without losing images', async () => {
  const records = [oldGarment('g_1'), oldGarment('g_2')], app = await start(records);
  assert.equal(app.errors.length, 0); openRecord(app);
  const inputs = { 'edit-name': 'The Simone', 'edit-brand': 'Réalisation Par', 'edit-color': 'Chocolate Havana', 'edit-category': 'dresses',
    'edit-subcategory': 'Maxi Dress', 'edit-style': '挂脖、露背、修身长裙', 'edit-pattern': '棕白花卉印花', 'edit-size': 'XS',
    'edit-price': '290.00', 'edit-currency': 'GBP', 'edit-date': '2024-06-26', 'edit-status': 'owned', 'edit-notes': '官网购入' };
  for (const [id, value] of Object.entries(inputs)) app.elements[id].value = value;
  app.elements['edit-form'].fire('submit'); await flush();
  assert.equal(app.errors.length, 0); assert.equal(records[0].brand, 'Réalisation Par'); assert.equal(records[0].purchasePrice, 290);
  assert.equal(records[0].image, PNG); assert.equal(records[0].original, PNG);
  const reloaded = await start(records); openRecord(reloaded);
  for (const [id, value] of Object.entries(inputs)) assert.equal(reloaded.elements[id].value, id === 'edit-price' ? '290' : value, id);
  openRecord(reloaded, 1);
  for (const id of ['edit-brand', 'edit-subcategory', 'edit-style', 'edit-pattern', 'edit-size', 'edit-price', 'edit-date']) assert.equal(reloaded.elements[id].value, '', id + ' must not leak across garments');
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
