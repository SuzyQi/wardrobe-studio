const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const M = require('../memorial.js');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
const archive = () => ({ year: '2020', season: 'resort', collection: 'Collection name', look: '24', relation: 'runway_match', verification: 'pending',
  story: '第一次看见它\n终于找到自己的尺码。', sourceUrl: 'https://www.zimmermann.com/', photos: [{ id: 'p_runway', kind: 'runway', caption: 'Look 24', sourceUrl: 'https://www.zimmermann.com/' }] });
const record = () => ({ id: 'g_1', name: '我的藏品', category: 'dresses', brand: 'Zimmermann', aspect: .5, purchasePrice: 1500, originalPrice: 3000, currency: 'CNY',
  archive: archive(), image: PNG, thumb: PNG, original: PNG, photo_p_runway: PNG });
test('archive metadata and every image round-trip through a portable backup and are searchable', () => {
  const g = record(), result = C.validateBackup({ app: 'wardrobe-studio', version: 2, garments: [g], outfits: [] }).garments[0];
  assert.deepEqual(result.archive, archive()); assert.equal(result.photo_p_runway, PNG);
  assert.deepEqual(C.imageFields(result), ['image', 'thumb', 'original', 'photo_p_runway']);
  for (const query of ['2020', 'collection NAME', '终于找到']) assert.equal(C.matchesGarment(result, query), true);
  assert.equal(C.garmentDetails({}).archive, undefined);
});
test('unsafe sources, malformed photos, missing payloads and excessive galleries are rejected', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,test', 'http://example.com', 'https://name:password@example.com']) assert.throws(() => C.archiveDetails({ ...archive(), sourceUrl }), /来源/);
  for (const value of [{ photos: [archive().photos[0], archive().photos[0]] }, { photos: [{ id: '../x', kind: 'runway' }] }, { photos: [{ id: 'p_1', kind: '__proto__' }] }, { photos: Array.from({ length: 13 }, (_, i) => ({ id: 'p_' + i, kind: 'detail' })) }, { year: '20201' }]) assert.throws(() => C.archiveDetails(value));
  const g = record(); delete g.photo_p_runway;
  assert.throws(() => C.validateBackup({ app: 'wardrobe-studio', version: 2, garments: [g], outfits: [] }), /图片/);
});
test('memorial card selects runway photo, hides prices by default and wraps long text without clipping', () => {
  const g = record(); g.archive.photos.unshift({ id: 'p_detail', kind: 'detail', caption: '', sourceUrl: '' });
  g.archive.story = '回忆'.repeat(1500); g.archive.photos[1].caption = '秀场说明'.repeat(40);
  const measure = (text, font) => [...text].length * parseInt(font, 10);
  const plan = M.layout(g, false, measure), text = plan.ops.map(x => x.text).join('');
  assert.equal(plan.images[1].field, 'photo_p_runway'); assert.doesNotMatch(text, /实付|原价|1,500|3,000/);
  assert.ok(text.includes(g.archive.story)); assert.ok(plan.height > 2500 && plan.height < 12000);
  for (const op of plan.ops) { const width = op.x === 615 ? 505 : 1040; assert.ok(measure(op.text, op.font) <= width); assert.ok(op.y + parseInt(op.font) <= plan.height); }
  const priced = M.layout(g, true, measure).ops.map(x => x.text).join(''); assert.match(priced, /实付.*1,500/); assert.match(priced, /原价.*3,000/);
  const plain = M.layout({ ...g, archive: undefined }, false, measure); assert.equal(plain.images.length, 1);
});
