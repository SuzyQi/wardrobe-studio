(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.WardrobeCloud = factory(root.WardrobeCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const API = 'https://api.github.com';
  const FILE = 'wardrobe.json';
  const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };
  const SHA = /^[a-f0-9]{40}$/;
  const HASH = /^[a-f0-9]{64}$/;
  const ID = /^[a-zA-Z0-9_-]{1,100}$/;
  const PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0f8AAAAASUVORK5CYII=';
  function empty() { return { app: 'wardrobe-studio-cloud', version: 2, updatedAt: '', garments: [], outfits: [] }; }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function metadata(g) {
    return { id: g.id, name: g.name, category: g.category, ...C.garmentDetails(g), favorite: !!g.favorite, demo: !!g.demo,
      aspect: g.aspect, createdAt: g.createdAt || '', updatedAt: g.updatedAt || '' };
  }
  function validateAsset(asset, id) {
    if (!asset || !TYPES[asset.type] || !SHA.test(asset.sha) || !HASH.test(asset.hash) || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > 25 * 1024 * 1024 || asset.path !== 'images/' + id + '/' + asset.hash + '.' + TYPES[asset.type]) throw new Error('云端图片记录无效，尚未更改本机衣橱。');
    return { path: asset.path, sha: asset.sha, hash: asset.hash, type: asset.type, size: asset.size };
  }
  function validateManifest(input) {
    if (!input || input.app !== 'wardrobe-studio-cloud' || ![1, 2].includes(input.version) || !Array.isArray(input.garments) || !Array.isArray(input.outfits)) throw new Error('云端衣橱格式不受支持，请刷新网站；尚未更改本机衣橱。');
    const safe = C.validateBackup({ app: 'wardrobe-studio', version: 2, garments: input.garments.map(g => ({ ...g, ...Object.fromEntries(C.imageFields(g).map(field => [field, PLACEHOLDER])) })), outfits: input.outfits });
    return { app: input.app, version: 2, updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt.slice(0, 40) : '',
      garments: safe.garments.map((g, index) => ({ ...metadata(g), assets: Object.fromEntries(C.imageFields(g).map(field => [field, validateAsset(input.garments[index].assets?.[field], g.id)])) })), outfits: safe.outfits };
  }
  function merge(base, local, remote, resolutions = {}) {
    const result = empty(), conflicts = [];
    for (const kind of ['garments', 'outfits']) {
      // Casing-only changes must not conflict with genuine edits on another device.
      const maps = [base || empty(), local, remote].map(m => new Map(m[kind].map(g => [g.id, kind === 'garments' ? { ...g, brand: C.formatBrand(g.brand) } : g])));
      const ids = new Set(maps.flatMap(m => [...m.keys()]));
      for (const id of [...ids].sort()) {
        const [b, l, r] = maps.map(m => m.get(id)); let winner;
        if (canonical(l) === canonical(r)) winner = l;
        else if (canonical(l) === canonical(b)) winner = r;
        else if (canonical(r) === canonical(b)) winner = l;
        else if (resolutions[kind + ':' + id] === 'local') winner = l;
        else if (resolutions[kind + ':' + id] === 'remote') winner = r;
        else { conflicts.push({ key: kind + ':' + id, kind, id, name: l?.name || r?.name || b?.name || id, local: l || null, remote: r || null }); continue; }
        if (winner) result[kind].push(winner);
      }
    }
    if (!conflicts.length) {
      const ids = new Set(result.garments.map(g => g.id));
      result.outfits = result.outfits.map(o => ({ ...o, layers: o.layers.filter(l => ids.has(l.garmentId)) }));
    }
    return { manifest: result, conflicts };
  }
  function sameRecords(a, b) {
    const ordered = m => ({ garments: [...m.garments].sort((x, y) => x.id.localeCompare(y.id)), outfits: [...m.outfits].sort((x, y) => x.id.localeCompare(y.id)) });
    return canonical(ordered(a)) === canonical(ordered(b));
  }
  function bytes64(bytes) {
    let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary);
  }
  function from64(text) {
    const binary = atob(text.replace(/\s/g, '')); return Uint8Array.from(binary, char => char.charCodeAt(0));
  }
  async function digest(bytes, algorithm = 'SHA-256') {
    if (!globalThis.crypto?.subtle) throw new Error('请在新版浏览器的 HTTPS 网页中连接 GitHub。');
    return [...new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function createClient(options) {
    const { owner, repo } = options;
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') throw new Error('请填写有效的 GitHub 用户名和仓库名。');
    let token = String(options.token || '').trim();
    if (!token) throw new Error('请填写仅限私有数据仓库的访问授权。');
    const fetcher = options.fetch || globalThis.fetch;
    const fullName = owner + '/' + repo, prefix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    const controllers = new Set(), prepared = new WeakMap(); let branch = 'main', nextWriteAt = 0, cancelEpoch = 0, remoteCache = null;
    const cached = options.cachedRemote;
    if (cached?.origin === fullName.toLowerCase() && SHA.test(cached.head)) {
      try { remoteCache = { head: cached.head, tree: SHA.test(cached.tree) ? cached.tree : null, fileSHA: SHA.test(cached.fileSHA) ? cached.fileSHA : null, exists: true, manifest: validateManifest(cached.manifest) }; }
      catch { /* Invalid local checkpoints fall back to a full remote read. */ }
    }
    function cancelled() { const error = new Error('已停止本次同步，本机记录已保留；可稍后重试。'); error.name = 'SyncCancelled'; return error; }
    const minWriteGap = options.minWriteGap ?? 900;
    function failure(status) {
      const messages = { 401: 'GitHub 授权已失效，请重新连接。', 403: 'GitHub 拒绝访问。请检查此仓库的 Contents 读写权限，或稍后重试。',
        404: '找不到私有数据仓库，或此授权没有访问权限。', 409: '云端版本发生变化，请重新同步。', 422: '云端版本或仓库规则阻止了本次提交，请重新同步。', 429: 'GitHub 请求较多，请稍后重新同步。' };
      const error = new Error(messages[status] || 'GitHub 暂时无法完成请求，本机记录已保留。'); error.status = status; return error;
    }
    async function request(path, { method = 'GET', body, raw = false } = {}) {
      if (!token) throw new Error('请先连接 GitHub。');
      const epoch = cancelEpoch;
      if (method !== 'GET') {
        const delay = Math.max(0, nextWriteAt - Date.now()); nextWriteAt = Math.max(Date.now(), nextWriteAt) + minWriteGap;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!token) throw new Error('请先连接 GitHub。');
      }
      if (epoch !== cancelEpoch) throw cancelled();
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetcher(API + prefix + path, { method, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
          headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw failure(response.status);
        const result = raw ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        if (epoch !== cancelEpoch) throw cancelled();
        return result;
      } catch (error) {
        if (epoch !== cancelEpoch || error.name === 'SyncCancelled') throw cancelled();
        if (error.status) throw error;
        throw new Error('网络连接中断或请求超时，本机记录已保留，请重新同步。');
      } finally { clearTimeout(timer); controllers.delete(controller); }
    }
    async function connect() {
      const info = await request('');
      if (info.private !== true || String(info.full_name).toLowerCase() !== fullName.toLowerCase()) throw new Error('为保护衣橱隐私，只能连接你指定的私有仓库。');
      branch = info.default_branch;
      if (!branch || !/^[a-zA-Z0-9_./-]{1,200}$/.test(branch) || branch.startsWith('/') || branch.includes('..') || branch.split('/').some(part => !part || part === '.')) throw new Error('请先为数据仓库添加 README，初始化有效的默认分支。');
      return { owner, repo, branch, fullName };
    }
    async function readRemote() {
      const ref = await request('/git/ref/heads/' + branch.split('/').map(encodeURIComponent).join('/'));
      if (!SHA.test(ref.object?.sha)) throw new Error('云端分支记录无效。');
      // Still check the branch every time; reuse only a version with the exact same head.
      if (remoteCache?.head === ref.object.sha) {
        // Older checkpoints have no tree. Resolve it once without downloading
        // the already saved manifest; never use a checkpoint for another head.
        if (!remoteCache.tree) {
          const commit = await request('/git/commits/' + ref.object.sha);
          if (!SHA.test(commit.tree?.sha)) throw new Error('云端文件目录无效。');
          remoteCache.tree = commit.tree.sha;
        }
        return { ...remoteCache, manifest: validateManifest(remoteCache.manifest) };
      }
      const commit = await request('/git/commits/' + ref.object.sha);
      if (!SHA.test(commit.tree?.sha)) throw new Error('云端文件目录无效。');
      const tree = await request('/git/trees/' + commit.tree.sha);
      const entry = tree.tree?.find(e => e.path === FILE && e.type === 'blob' && e.mode === '100644');
      let manifest = empty();
      if (entry) {
        if (!SHA.test(entry.sha)) throw new Error('云端衣橱文件编号无效。');
        const file = await request('/git/blobs/' + entry.sha);
        if (file.encoding !== 'base64' || file.size > 25 * 1024 * 1024) throw new Error('云端衣橱文件过大或格式无效。');
        let value; try { value = JSON.parse(new TextDecoder().decode(from64(file.content))); } catch { throw new Error('云端衣橱文件损坏，尚未更改本机衣橱。'); }
        manifest = validateManifest(value);
      }
      remoteCache = { head: ref.object.sha, tree: commit.tree.sha, fileSHA: entry?.sha || null, exists: !!entry, manifest };
      return { ...remoteCache, manifest: validateManifest(manifest) };
    }
    async function asset(g, field, stats) {
      const epoch = cancelEpoch;
      const old = g.cloudOrigin === fullName.toLowerCase() ? g.cloudAssets?.[field] : null;
      const blob = g[field];
      if (!blob) {
        if (old) { stats.reused++; return validateAsset(old, g.id); }
        throw new Error('单品“' + g.name + '”的图片尚未加载。请先连接原来的数据仓库，导出完整备份后再迁移。');
      }
      if (!TYPES[blob.type] || !blob.size || blob.size > 25 * 1024 * 1024 || !ID.test(g.id)) throw new Error('单品图片格式或大小不受支持。');
      // Only an explicitly trusted, identical immutable Blob can skip reading and hashing.
      // A replacement photo with an old cloud reference must still be verified/uploaded.
      if (old && old.size === blob.size && old.type === blob.type && options.canReuseAsset?.(g, field)) { stats.reused++; return validateAsset(old, g.id); }
      if (prepared.get(blob)?.has(g.id)) { stats.reused++; return prepared.get(blob).get(g.id); }
      const remember = value => { if (!prepared.has(blob)) prepared.set(blob, new Map()); prepared.get(blob).set(g.id, value); return value; };
      let bytes;
      stats.read++; stats.readBytes += blob.size;
      try { bytes = new Uint8Array(await blob.arrayBuffer()); }
      catch (error) {
        if (!old || !options.canRecoverAsset?.(g, field)) throw error;
        const recovered = await getAsset(old, g.id);
        bytes = new Uint8Array(await recovered.arrayBuffer());
        g[field] = recovered; options.onRecoveredAsset?.(g, field, blob, recovered);
      }
      const hash = await digest(bytes);
      if (epoch !== cancelEpoch) throw cancelled();
      if (old && old.hash === hash && old.type === blob.type) { stats.reused++; return remember(validateAsset(old, g.id)); }
      const created = await request('/git/blobs', { method: 'POST', body: { content: bytes64(bytes), encoding: 'base64' } });
      if (!SHA.test(created.sha)) throw new Error('GitHub 未返回有效的图片编号。');
      stats.uploaded++; stats.uploadBytes += bytes.length;
      const result = { path: 'images/' + g.id + '/' + hash + '.' + TYPES[blob.type], sha: created.sha, hash, type: blob.type, size: blob.size };
      return remember(result);
    }
    async function prepare(garments, outfits, progress = () => {}) {
      const result = empty(), epoch = cancelEpoch;
      const stats = { reused: 0, read: 0, uploaded: 0, readBytes: 0, uploadBytes: 0 };
      for (let i = 0; i < garments.length; i++) {
        const g = garments[i]; progress('正在准备照片 ' + (i + 1) + ' / ' + garments.length + '…', { ...stats });
        const assets = {}; for (const field of C.imageFields(g)) { assets[field] = await asset(g, field, stats); if (epoch !== cancelEpoch) throw cancelled(); }
        result.garments.push({ ...metadata(g), assets });
      }
      result.outfits = outfits.map(o => ({ ...o, layers: o.layers.map(l => ({ ...l })) }));
      progress('图片准备完成', { ...stats });
      return validateManifest(result);
    }
    async function publish(manifest, remote, progress = () => {}) {
      const epoch = cancelEpoch;
      const safe = validateManifest(manifest);
      if (remote.exists && sameRecords(safe, remote.manifest)) return { manifest: remote.manifest, head: remote.head, tree: remote.tree, fileSHA: remote.fileSHA };
      safe.updatedAt = new Date().toISOString();
      const assets = new Map();
      for (const g of safe.garments) for (const a of Object.values(g.assets)) assets.set(a.path, a.sha);
      const previousAssets = new Map();
      for (const g of remote.manifest.garments) for (const a of Object.values(g.assets)) previousAssets.set(a.path, a.sha);
      const removed = new Set();
      for (const g of remote.manifest.garments) for (const a of Object.values(g.assets)) if (!assets.has(a.path)) removed.add(a.path);
      const changedAssets = [...assets].filter(([path, sha]) => previousAssets.get(path) !== sha);
      const content = JSON.stringify(safe), bytes = new TextEncoder().encode(content);
      if (remote.exists && SHA.test(remote.fileSHA) && !changedAssets.length && !removed.size) {
        progress('正在保存云端资料…');
        // The file SHA is the compare-and-swap guard. A concurrent wardrobe
        // edit rejects instead of overwriting the other device's records.
        const saved = await request('/contents/' + FILE, { method: 'PUT', body: { message: 'Sync wardrobe details', content: bytes64(bytes), sha: remote.fileSHA, branch } });
        if (!SHA.test(saved.content?.sha) || !SHA.test(saved.commit?.sha) || !SHA.test(saved.commit?.tree?.sha)) throw new Error('GitHub 未返回有效的保存版本。');
        remoteCache = { manifest: safe, head: saved.commit.sha, tree: saved.commit.tree.sha, fileSHA: saved.content.sha, exists: true };
        return { manifest: safe, head: remoteCache.head, tree: remoteCache.tree, fileSHA: remoteCache.fileSHA };
      }
      // Keep the blob identity for the next metadata-only update, including
      // after reopening. Compute it locally rather than adding a network read.
      const header = new TextEncoder().encode('blob ' + bytes.length + '\0'), gitBytes = new Uint8Array(header.length + bytes.length);
      gitBytes.set(header); gitBytes.set(bytes, header.length);
      const fileSHA = await digest(gitBytes, 'SHA-1');
      if (epoch !== cancelEpoch) throw cancelled();
      progress('正在保存云端版本（1 / 3）…');
      const tree = await request('/git/trees', { method: 'POST', body: { base_tree: remote.tree, tree: [
        ...changedAssets.map(([path, sha]) => ({ path, sha, mode: '100644', type: 'blob' })),
        ...[...removed].map(path => ({ path, sha: null, mode: '100644', type: 'blob' })),
        { path: FILE, content, mode: '100644', type: 'blob' }
      ] } });
      if (!SHA.test(tree.sha)) throw new Error('GitHub 未返回有效的目录编号。');
      progress('正在保存云端版本（2 / 3）…');
      const commit = await request('/git/commits', { method: 'POST', body: { message: 'Sync wardrobe records and photos', tree: tree.sha, parents: [remote.head] } });
      if (!SHA.test(commit.sha)) throw new Error('GitHub 未返回有效的提交编号。');
      progress('正在保存云端版本（3 / 3）…');
      await request('/git/refs/heads/' + branch.split('/').map(encodeURIComponent).join('/'), { method: 'PATCH', body: { sha: commit.sha, force: false } });
      remoteCache = { manifest: safe, head: commit.sha, tree: tree.sha, fileSHA, exists: true };
      return { manifest: safe, head: commit.sha, tree: tree.sha, fileSHA };
    }
    async function getAsset(reference, id) {
      const a = validateAsset(reference, id), file = await request('/git/blobs/' + a.sha);
      // JSON/base64 uses the same private API response format as the manifest, avoiding
      // a separate binary media negotiation path on mobile browsers.
      if (file?.sha !== a.sha || file.size !== a.size || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > a.size * 2 + 4096) throw new Error('云端图片校验失败（响应格式或大小不符），请重新同步；本机记录已保留。');
      const encoded = file.content.replace(/\s/g, '');
      if (encoded.length !== Math.ceil(a.size / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('云端图片编码无效，请重新同步；本机记录已保留。');
      let bytes; try { bytes = from64(encoded); } catch { throw new Error('云端图片编码无效，请重新同步；本机记录已保留。'); }
      if (bytes.length !== a.size || await digest(bytes) !== a.hash) throw new Error('云端图片校验失败，请重新同步；本机记录已保留。');
      return new Blob([bytes], { type: a.type });
    }
    function cancelPending() { cancelEpoch++; for (const controller of controllers) controller.abort(); controllers.clear(); }
    function disconnect() { token = ''; cancelPending(); }
    return { fullName: fullName.toLowerCase(), connect, readRemote, prepare, publish, getAsset, cancelPending, disconnect };
  }
  function localRecords(manifest, oldGarments, origin, preparedManifest = empty()) {
    const existing = new Map(oldGarments.map(g => [g.id, g]));
    const prepared = new Map(preparedManifest.garments.map(g => [g.id, g]));
    return manifest.garments.map(g => {
      const old = existing.get(g.id), value = { ...metadata(g), cloudAssets: g.assets, cloudOrigin: origin.toLowerCase() };
      for (const field of C.imageFields(g)) {
        const known = prepared.get(g.id)?.assets[field] || (old?.cloudOrigin === value.cloudOrigin ? old.cloudAssets?.[field] : null);
        if (old?.[field] && known?.sha === g.assets[field].sha) value[field] = old[field];
      }
      return value;
    });
  }
  async function withoutBackedImageCaches(record, origin) {
    if (!origin || record.cloudOrigin !== origin.toLowerCase()) return record;
    let value = record;
    for (const field of C.imageFields(record)) {
      const blob = record[field], reference = record.cloudAssets?.[field];
      if (!blob || !reference) continue;
      try {
        const asset = validateAsset(reference, record.id);
        // Never discard an unsynced replacement, even if an old cloud reference remains.
        if (blob.type !== asset.type || blob.size !== asset.size || await digest(await blob.arrayBuffer()) !== asset.hash) continue;
        if (value === record) value = { ...record };
        delete value[field];
      } catch { /* Unreadable or unverified local photos must remain available for recovery. */ }
    }
    return value;
  }
  return { empty, metadata, validateManifest, validateAsset, merge, sameRecords, createClient, localRecords, withoutBackedImageCaches };
});
