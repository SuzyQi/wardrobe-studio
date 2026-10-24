const { createHash } = require('node:crypto');
function fixture({ privateRepo = true } = {}) {
  const blobs = new Map(), trees = new Map(), commits = new Map(), requests = [], rawGets = [];
  const sha = value => createHash('sha1').update(value).digest('hex');
  const putBlob = bytes => { const value = Buffer.from(bytes); const id = sha(Buffer.concat([Buffer.from('blob ' + value.length + '\0'), value])); blobs.set(id, value); return id; };
  const initialTree = sha('initial tree'); trees.set(initialTree, new Map([['README.md', putBlob('Private wardrobe')]]));
  let head = sha('initial commit'); commits.set(head, { sha: head, tree: { sha: initialTree }, parents: [] });
  let commitCount = 0, moved = false, nextStatus = null;
  function response(status, data, bytes) { return { status, ok: status >= 200 && status < 300, json: async () => data,
    arrayBuffer: async () => Uint8Array.from(bytes || []).buffer }; }
  async function fetch(url, options = {}) {
    const parsed = new URL(url), path = parsed.pathname.replace('/repos/SuzyQi/wardrobe-studio-data', '');
    const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body, headers: options.headers, redirect: options.redirect, credentials: options.credentials });
    if (nextStatus) { const status = nextStatus; nextStatus = null; return response(status, { message: 'raw server details are not shown' }); }
    if (parsed.origin !== 'https://api.github.com') throw new Error('unexpected host');
    if (!path) return response(200, { private: privateRepo, full_name: 'SuzyQi/wardrobe-studio-data', default_branch: 'main' });
    if (path === '/git/ref/heads/main') return response(200, { object: { sha: head } });
    if (path.startsWith('/git/commits/') && method === 'GET') return response(200, commits.get(path.split('/').pop()));
    if (path.startsWith('/git/trees/') && method === 'GET') return response(200, { tree: [...trees.get(path.split('/').pop())].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) });
    if (path.startsWith('/git/blobs/') && method === 'GET') {
      const id = path.split('/').pop(), bytes = blobs.get(id); if (!bytes) return response(404, {});
      // Track image payload requests in either raw or JSON/base64 form.
      if (trees.get(commits.get(head).tree.sha).get('wardrobe.json') !== id) rawGets.push(id);
      if (options.headers.Accept.includes('raw')) return response(200, null, bytes);
      return response(200, { sha: id, size: bytes.length, content: bytes.toString('base64'), encoding: 'base64' });
    }
    if (path === '/git/blobs' && method === 'POST') return response(201, { sha: putBlob(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')) });
    if (path === '/contents/wardrobe.json' && method === 'PUT') {
      const current = commits.get(head), tree = new Map(trees.get(current.tree.sha));
      if (body.branch !== 'main' || tree.get('wardrobe.json') !== body.sha) return response(409, {});
      const fileSHA = putBlob(Buffer.from(body.content, 'base64')); tree.set('wardrobe.json', fileSHA);
      const treeSHA = sha(JSON.stringify([...tree])); trees.set(treeSHA, tree);
      const id = sha(JSON.stringify({ tree: treeSHA, parent: head })), commit = { sha: id, tree: { sha: treeSHA }, parents: [head] };
      commits.set(id, commit); head = id; commitCount++;
      return response(200, { content: { sha: fileSHA }, commit });
    }
    if (path === '/git/trees' && method === 'POST') {
      const tree = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) { if (entry.sha === null) tree.delete(entry.path); else tree.set(entry.path, entry.sha || putBlob(entry.content)); }
      const id = sha(JSON.stringify([...tree])); trees.set(id, tree); return response(201, { sha: id });
    }
    if (path === '/git/commits' && method === 'POST') {
      const id = sha(JSON.stringify(body)); commits.set(id, { sha: id, tree: { sha: body.tree }, parents: body.parents }); return response(201, { sha: id });
    }
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      if (moved) { moved = false; const id = sha('other device ' + head); commits.set(id, { ...commits.get(head), sha: id, parents: [head] }); head = id; }
      if (body.force !== false || !commits.get(body.sha).parents.includes(head)) return response(422, {});
      head = body.sha; commitCount++; return response(200, { object: { sha: head } });
    }
    throw new Error('unhandled mock route: ' + method + ' ' + path);
  }
  function manifest() {
    const tree = trees.get(commits.get(head).tree.sha), id = tree.get('wardrobe.json');
    return id ? JSON.parse(blobs.get(id).toString()) : null;
  }
  return { fetch, requests, rawGets, blobs, manifest, get head() { return head; }, get commitCount() { return commitCount; },
    moveBeforePublish() { moved = true; }, failNext(status) { nextStatus = status; }, corrupt(id) { blobs.set(id, Buffer.from('broken')); },
    deleteManifest() { const current = commits.get(head), tree = new Map(trees.get(current.tree.sha)); tree.delete('wardrobe.json'); const id = sha('missing manifest ' + head); trees.set(id, tree); const next = sha('missing manifest commit ' + head); commits.set(next, { sha: next, tree: { sha: id }, parents: [head] }); head = next; } };
}
module.exports = { fixture };
