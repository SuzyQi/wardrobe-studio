const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const transactions = [];
  const db = { close() {}, objectStoreNames: { contains: () => true }, transaction(names, mode) {
    const tx = { names, mode, writes: [], abort() { this.aborted = true; this.onabort?.(); }, objectStore(name) {
      return { put(value) { tx.writes.push({ name, value }); if (value.fail) throw new Error('write failed'); },
        delete(id) { tx.writes.push({ name, id, deleted: true }); }, getAll() { const r = {}; tx.readRequest = r; return r; } };
    } };
    transactions.push(tx); return tx;
  } };
  const context = { indexedDB: { open() { const req = { result: db }; queueMicrotask(() => req.onsuccess()); return req; } }, Promise };
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
