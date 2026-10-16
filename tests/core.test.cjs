const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const item = (id = 'g_1') => ({ id, name: '黑色半裙', category: 'bottoms', aspect: 0.7, image: PNG, original: PNG, thumb: PNG });
const layer = (id = 'l_1', gid = 'g_1') => ({ id, garmentId: gid, x: 200, y: 350, w: 300, rotation: 0, flip: false });
const backup = () => ({ app: 'wardrobe-studio', version: 1, garments: [item()], outfits: [{ id: 'o_1', name: '周末', background: '#f5f1e9', layers: [layer()] }] });

test('unknown camera filenames stay unsorted; descriptive names suggest the intended category', () => {
  for (const filename of ['IMG_3643.png', 'Screenshot 2026-10-16.png', 'DSC00912.jpg']) assert.equal(C.suggestCategory(filename), 'unsorted');
  for (const [filename, cat] of [['black-dress.png', 'dresses'], ['奶油白开衫.jpg', 'tops'], ['酒红半裙.png', 'bottoms'], ['羊毛大衣.jpg', 'outerwear'], ['Mary Jane shoe.jpg', 'shoes'], ['棕色腋下包.png', 'bags'], ['金色耳环.jpg', 'accessories']]) assert.equal(C.suggestCategory(filename), cat);
});
test('blank names can be replaced by a simple numbered label', () => {
  assert.equal(C.defaultName('unsorted', 1), '待整理 001');
  assert.equal(C.defaultName('bottoms', 23, ' 酒红 '), '酒红 下装 023');
});
test('transparent padding is removed without excluding a faint garment edge', () => {
  const data = new Uint8ClampedArray(10 * 12 * 4);
  for (let y = 3; y < 10; y++) for (let x = 2; x < 7; x++) data[(y * 10 + x) * 4 + 3] = 255;
  data[(4 * 10 + 1) * 4 + 3] = 14;
  assert.deepEqual(C.alphaBounds(data, 10, 12), { x: 1, y: 3, width: 6, height: 7 });
  assert.equal(C.alphaBounds(new Uint8ClampedArray(16), 2, 2), null);
});
test('default layout keeps every category visible and preserves the supplied aspect ratio', () => {
  for (const category of C.CATEGORIES.slice(1)) {
    const g = { ...item(), category: category.id, aspect: 0.68 };
    const l = C.positionLayer(C.defaultLayer(g), g.aspect);
    assert.ok(l.w >= 35 && l.w <= 760); assert.ok(l.x >= 0); assert.ok(l.y >= 0);
    assert.ok(l.x < C.WIDTH && l.y < C.HEIGHT); assert.ok(l.y + l.w / g.aspect <= C.HEIGHT + 1);
  }
});
test('moving and resizing cannot make a layer completely unreachable', () => {
  const l = C.positionLayer({ ...layer(), x: 100000, y: -100000, w: 10000 }, 0.7);
  assert.equal(l.w, 760); assert.ok(l.x < C.WIDTH); assert.ok(l.y + l.w / 0.7 > 0);
});
test('a full wardrobe backup round trips with layers and image payloads intact', () => {
  const source = backup(), parsed = C.validateBackup(JSON.parse(JSON.stringify(source)));
  assert.equal(parsed.garments[0].name, source.garments[0].name);
  assert.equal(parsed.garments[0].original, PNG);
  assert.deepEqual(parsed.outfits[0].layers, source.outfits[0].layers);
  assert.equal(parsed.outfits[0].background, '#f5f1e9');
});
test('foreign or future-version files are rejected before any records can be imported', () => {
  assert.throws(() => C.validateBackup({ ...backup(), app: 'another-app' }), /受支持/);
  assert.throws(() => C.validateBackup({ ...backup(), version: 5 }), /受支持/);
  assert.throws(() => C.validateBackup({ ...backup(), garments: {} }), /格式/);
});
test('broken references and duplicate IDs cannot overwrite unrelated records', () => {
  const b = backup(); b.garments.push(item()); assert.throws(() => C.validateBackup(b), /重复/);
  const c = backup(); c.outfits[0].layers[0].garmentId = 'missing'; assert.throws(() => C.validateBackup(c), /缺失/);
  const d = backup(); d.outfits[0].layers.push(layer()); assert.throws(() => C.validateBackup(d), /重复/);
  const e = backup(); e.outfits.push({ ...e.outfits[0] }); assert.throws(() => C.validateBackup(e), /重复/);
});
test('HTML, SVG, remote images, selector injection, and non-finite geometry are rejected', () => {
  for (const payload of ['data:image/svg+xml;base64,PHN2Zy8+', 'https://example.com/photo.png', 'javascript:alert(1)', 'data:image/png;base64,aaa']) {
    const b = backup(); b.garments[0].image = payload; assert.throws(() => C.validateBackup(b), /图片/);
  }
  const b = backup(); b.garments[0].id = 'g_1"]'; assert.throws(() => C.validateBackup(b), /编号/);
  const c = backup(); c.outfits[0].layers[0].x = Infinity; assert.throws(() => C.validateBackup(c), /位置/);
  const d = backup(); d.garments[0].aspect = 0; assert.throws(() => C.validateBackup(d), /比例/);
  const e = backup(); e.garments[0].category = '__proto__'; assert.throws(() => C.validateBackup(e), /分类/);
});
test('import strips unknown fields and applies safe backgrounds', () => {
  const b = JSON.parse(JSON.stringify(backup())); b.garments[0].html = '<img onerror=alert(1)>';
  b.outfits[0].background = 'url(https://example.com)';
  const parsed = C.validateBackup(b); assert.equal(parsed.garments[0].html, undefined); assert.equal(parsed.outfits[0].background, C.BACKGROUNDS[0]);
});
test('deleting one garment removes all its instances and leaves other outfit items intact', () => {
  const source = [{ id: 'o_1', name: 'one', layers: [layer(), layer('l_2'), layer('l_3', 'g_2')] }];
  const changed = C.removeGarmentReferences(source, 'g_1');
  assert.equal(changed[0].layers.length, 1); assert.equal(changed[0].layers[0].garmentId, 'g_2');
  assert.equal(source[0].layers.length, 3);
});

test('a detailed garment record survives backup restore with its purchase information', () => {
  const details = { brand: 'Réalisation Par', color: 'Chocolate Havana', subcategory: 'Maxi Dress', style: '挂脖、露背、修身长裙',
    pattern: '棕白花卉印花', size: 'XS', purchasePrice: 290, currency: 'GBP', purchaseDate: '2024-06-26', purchaseStatus: 'owned', notes: '官网购入' };
  const source = backup(); Object.assign(source.garments[0], details);
  const restored = C.validateBackup(JSON.parse(JSON.stringify(source))).garments[0];
  for (const [field, value] of Object.entries(details)) assert.equal(restored[field], value, field);
  assert.equal(C.formatPrice(restored), '£290.00');
  assert.equal(restored.image, PNG);
});
test('old records and blank purchases remain optional, while zero-price purchases are preserved', () => {
  const old = C.validateBackup(backup()).garments[0];
  assert.equal(old.brand, ''); assert.equal(old.purchasePrice, null); assert.equal(old.purchaseDate, '');
  assert.equal(old.currency, 'GBP'); assert.equal(old.purchaseStatus, 'owned'); assert.equal(C.formatPrice(old), '');
  assert.equal(C.garmentDetails({ purchasePrice: '' }).purchasePrice, null);
  assert.equal(C.garmentDetails({ purchasePrice: '0' }).purchasePrice, 0);
  assert.equal(C.formatPrice(C.garmentDetails({ purchasePrice: 0 })), '£0.00');
  assert.equal(C.garmentDetails({ purchaseDate: '2024-02-29' }).purchaseDate, '2024-02-29');
});
test('invalid purchase amounts, currencies, dates and statuses cannot silently enter a backup', () => {
  for (const purchasePrice of [-1, Infinity, 'free', true, '12.345', 1e12]) {
    const source = backup(); source.garments[0].purchasePrice = purchasePrice;
    assert.throws(() => C.validateBackup(source), /价格/);
  }
  for (const purchaseDate of ['2025-02-29', '2024-06-31', '2024-13-01', '26/06/2024']) {
    assert.throws(() => C.garmentDetails({ purchaseDate }), /日期/);
  }
  assert.throws(() => C.garmentDetails({ currency: 'invalid' }), /币种/);
  assert.throws(() => C.garmentDetails({ purchaseStatus: '__proto__' }), /状态/);
});
test('garments can be found by brand without accents, detailed category, style, pattern or size', () => {
  const g = { ...item(), brand: 'Réalisation Par', subcategory: 'Maxi Dress', style: '挂脖露背', pattern: '棕白花卉印花', size: 'XS' };
  for (const query of ['realisation', 'RÉALISATION PAR', 'maxi', '露背', '花卉', 'xs']) assert.ok(C.matchesGarment(g, query), query);
  assert.equal(C.matchesGarment(g, '纯色毛衣'), false);
});
