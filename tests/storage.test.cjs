const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const transactions = [];
  const db = { close() {}, objectStoreNames: { contains: () => true }, transaction(names, mode) {
    const tx = { names, mode, writes: [], abort() { this.aborted = true; this.onabort?.(); }, objectStore(name) {
      return { put(value) { const request = {}; tx.writes.push({ name, value, request }); if (value.fail) throw new Error('write failed'); return request; },
        delete(id) { tx.writes.push({ name, id, deleted: true }); }, getAll() { const r = {}; tx.readRequest = r; return r; } };
    } };
    transactions.push(tx); return tx;
  } };
  const context = { indexedDB: { open() { const req = { result: db }; queueMicrotask(() => req.onsuccess()); return req; } }, Promise, Blob, ArrayBuffer };
  vm.runInNewContext(fs.readFileSync(require.resolve('../storage.js'), 'utf8'), context);
  return { api: context.WardrobeStorage, transactions };
}
test('one import transaction spans clothes and outfits, and reports success only after commit', async () => {
  const { api, transactions } = harness(); await api.open(); let settled = false;
  const pending = api.write([{ store: 'garments', value: { id: 'g_1' } }, { store: 'outfits', value: { id: 'o_1' } }]).then(() => { settled = true; });
  await nextTurn(); const tx = transactions[0];
  assert.deepEqual(Array.from(tx.names), ['garments', 'outfits']); assert.equal(tx.mode, 'readwrite');
  assert.equal(tx.writes.length, 2); assert.equal(settled, false);
  tx.oncomplete(); await pending; assert.equal(settled, true);
});
test('images and new archive photos are written as bytes, then reopened as identical Blobs', async () => {
  const { api, transactions } = harness(), original = new Blob([new Uint8Array([0, 255, 128, 23])], { type: 'image/png' });
  const record = { id: 'g_bytes', image: original, original, thumb: new Blob(['thumb'], { type: 'image/webp' }), photo_p1: new Blob(['runway'], { type: 'image/jpeg' }), archive: { photos: [{ id: 'p1', kind: 'runway' }], story: '故事' } };
  const pending = api.write([{ store: 'garments', value: record }, { store: 'meta', value: { id: 'github-sync', dirty: true } }]);
  await nextTurn(); const tx = transactions[0], stored = tx.writes[0].value;
  for (const field of ['image', 'thumb', 'original', 'photo_p1']) { assert.equal(stored[field] instanceof Blob, false); assert.ok(stored[field].bytes instanceof ArrayBuffer); }
  assert.deepEqual(Array.from(new Uint8Array(stored.original.bytes)), [0, 255, 128, 23]); assert.equal(record.image, original); tx.oncomplete(); await pending;
  const read = api.read('garments'); await nextTurn(); const readTx = transactions[1];
  readTx.readRequest.result = [structuredClone(stored), { id: 'g_legacy', image: original }]; readTx.readRequest.onsuccess(); readTx.oncomplete();
  const reopened = await read;
  for (const field of ['image', 'thumb', 'original', 'photo_p1']) { assert.ok(reopened[0][field] instanceof Blob); assert.equal(reopened[0][field].type, record[field].type); assert.deepEqual(await reopened[0][field].arrayBuffer(), await record[field].arrayBuffer()); }
  assert.equal(reopened[0].archive.story, '故事'); assert.equal(reopened[1].image, original);
});
test('unreadable images reject before any transaction so metadata and checkpoint cannot partially commit', async () => {
  const { api, transactions } = harness();
  class BrokenBlob extends Blob { async arrayBuffer() { throw new Error('cached file missing'); } }
  const unreadable = new BrokenBlob(['broken'], { type: 'image/png' });
  await assert.rejects(api.write([{ store: 'meta', value: { id: 'github-sync', dirty: true } }, { store: 'garments', value: { id: 'g_broken', image: unreadable } }]), error => error.name === 'ImageReadError' && error.garmentId === 'g_broken' && error.field === 'image');
  assert.equal(transactions.length, 0); assert.equal(unreadable.size, 6);
});
test('quota aborts reject the operation instead of reporting a successful save', async () => {
  const { api, transactions } = harness(); await api.open();
  const pending = api.write([{ store: 'garments', value: { id: 'g_1' } }]); await nextTurn();
  transactions[0].error = new Error('QuotaExceededError'); transactions[0].onabort();
  await assert.rejects(pending, /QuotaExceeded/);
});
test('a synchronous write failure aborts the transaction', async () => {
  const { api, transactions } = harness(); await api.open();
  await assert.rejects(api.write([{ store: 'garments', value: { id: 'g_1', fail: true } }]), /write failed/);
  assert.equal(transactions[0].aborted, true);
});
test('reads wait for transaction completion and propagate read aborts', async () => {
  const { api, transactions } = harness(); await api.open();
  const pending = api.read('garments'); await nextTurn();
  const tx = transactions[0]; tx.readRequest.result = [{ id: 'g_1' }]; tx.readRequest.onsuccess(); tx.oncomplete();
  assert.equal((await pending)[0].id, 'g_1');
  const aborted = api.read('outfits'); await nextTurn(); const t2 = transactions[1]; t2.error = new Error('read aborted'); t2.onabort();
  await assert.rejects(aborted, /read aborted/);
});
test('Safari request errors are preserved when transaction.error is still null, and wait for abort', async () => {
  const { api, transactions } = harness(); await api.open(); let settled = false;
  const pending = api.write([{ store: 'garments', value: { id: 'g_1' } }]).finally(() => { settled = true; });
  await nextTurn(); const tx = transactions[0], req = tx.writes[0].request;
  req.error = Object.assign(new Error('Error preparing Blob/File data'), { name: 'UnknownError' }); req.onerror();
  tx.onerror({ target: req }); await nextTurn(); assert.equal(settled, false); assert.equal(tx.error, undefined);
  tx.onabort(); await assert.rejects(pending, error => error.name === 'UnknownError' && /Blob\/File/.test(error.message) && !/空间不足/.test(error.message));
});
