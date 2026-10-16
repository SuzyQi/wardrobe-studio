const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
test('every app element reference exists, IDs are unique, and static entrypoints resolve', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate element IDs');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const match of app.matchAll(/\$\('([a-z0-9-]+)'\)/g)) assert.ok(ids.includes(match[1]), 'missing element: ' + match[1]);
  for (const match of app.matchAll(/listen\('([a-z0-9-]+)'/g)) assert.ok(ids.includes(match[1]), 'missing listener target: ' + match[1]);
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])), 'missing asset: ' + match[1]);
  assert.match(html, /<dialog id="busy-overlay"/); assert.match(html, /<script src="\.\/demo.js" defer>/);
});
test('app has no external service dependencies or API credentials', () => {
  for (const file of ['index.html', 'app.js', 'images.js', 'storage.js', 'demo.js', 'styles.css']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /https?:\/\/(?!www\.w3\.org)/, file + ' should work without external endpoints');
    assert.doesNotMatch(text, /api[_-]?key|sk-[a-zA-Z0-9]{20}/i);
  }
});
test('all eight optional demos are defined and correctly classified', () => {
  const context = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'demo.js'), 'utf8'), context);
  assert.equal(context.WardrobeDemo.length, 8); const C = require('../core.js');
  for (const item of context.WardrobeDemo) { assert.ok(C.CAT_IDS.has(item.category)); assert.match(item.svg, /^<svg/); assert.doesNotMatch(item.svg, /<script|<image|href=/i); }
});
