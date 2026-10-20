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
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8') + fs.readFileSync(path.join(root, 'archive-book.js'), 'utf8');
  for (const match of app.matchAll(/\$\('([a-z0-9-]+)'\)/g)) assert.ok(ids.includes(match[1]), 'missing element: ' + match[1]);
  for (const match of app.matchAll(/listen\('([a-z0-9-]+)'/g)) assert.ok(ids.includes(match[1]), 'missing listener target: ' + match[1]);
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1].split('?')[0])), 'missing asset: ' + match[1]);
  assert.match(html, /<dialog id="busy-overlay"/); assert.match(html, /<script src="\.\/demo.js(?:\?[^\"]+)?" defer>/);
  assert.match(html, /<form id="edit-form" novalidate>/); assert.match(html, /id="edit-error"[^>]*role="alert"/);
});
test('optional cloud access is limited to GitHub and source contains no embedded credentials', () => {
  for (const file of ['index.html', 'app.js', 'archive-book.js', 'archive-book.css', 'cloud.js', 'memorial.js', 'images.js', 'storage.js', 'demo.js', 'styles.css']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const url of text.match(/https?:\/\/[^\s"'<>;]+/g) || []) assert.ok(['www.w3.org', 'api.github.com', 'github.com'].includes(new URL(url).hostname), file + ' contains an unexpected external origin');
    assert.equal(/github_pat_[a-zA-Z0-9_]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|sk-[a-zA-Z0-9]{20}/.test(text), false, file + ' contains a credential-shaped literal');
  }
  assert.match(html, /connect-src 'self' https:\/\/api.github.com/);
  assert.match(html, /script-src 'self'/);
});
test('all eight optional demos are defined and correctly classified', () => {
  const context = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'demo.js'), 'utf8'), context);
  assert.equal(context.WardrobeDemo.length, 8); const C = require('../core.js');
  for (const item of context.WardrobeDemo) { assert.ok(C.CAT_IDS.has(item.category)); assert.match(item.svg, /^<svg/); assert.doesNotMatch(item.svg, /<script|<image|href=/i); }
});
