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
      const maps = [base || empty(), local, remote].map(m => new Map(m[kind].map(g => [g.id, g])));
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
  async function digest(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error('请在新版浏览器的 HTTPS 网页中连接 GitHub。');
    return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function createClient(options) {
    const { owner, repo } = options;
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') throw new Error('请填写有效的 GitHub 用户名和仓库名。');
    let token = String(options.token || '').trim();
    if (!token) throw new Error('请填写仅限私有数据仓库的访问授权。');
    const fetcher = options.fetch || globalThis.fetch;
    const fullName = owner + '/' + repo, prefix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    const controllers = new Set(), prepared = new WeakMap(); let branch = 'main', nextWriteAt = 0;
    const minWriteGap = options.minWriteGap ?? 900;
    function failure(status) {
      const messages = { 401: 'GitHub 授权已失效，请重新连接。', 403: 'GitHub 拒绝访问。请检查此仓库的 Contents 读写权限，或稍后重试。',
        404: '找不到私有数据仓库，或此授权没有访问权限。', 409: '云端版本发生变化，请重新同步。', 422: '云端版本或仓库规则阻止了本次提交，请重新同步。', 429: 'GitHub 请求较多，请稍后重新同步。' };
      const error = new Error(messages[status] || 'GitHub 暂时无法完成请求，本机记录已保留。'); error.status = status; return error;
    }
    async function request(path, { method = 'GET', body, raw = false } = {}) {
      if (!token) throw new Error('请先连接 GitHub。');
      if (method !== 'GET') {
        const delay = Math.max(0, nextWriteAt - Date.now()); nextWriteAt = Math.max(Date.now(), nextWriteAt) + minWriteGap;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!token) throw new Error('请先连接 GitHub。');
      }
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetcher(API + prefix + path, { method, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
          headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) throw failure(response.status);
        return raw ? new Uint8Array(await response.arrayBuffer()) : await response.json();
      } catch (error) {
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
      return { head: ref.object.sha, tree: commit.tree.sha, exists: !!entry, manifest };
    }
    async function asset(g, field) {
      const old = g.cloudOrigin === fullName.toLowerCase() ? g.cloudAssets?.[field] : null;
      const blob = g[field];
      if (!blob) {
        if (old) return validateAsset(old, g.id);
        throw new Error('单品“' + g.name + '”的图片尚未加载。请先连接原来的数据仓库，导出完整备份后再迁移。');
      }
      if (!TYPES[blob.type] || !blob.size || blob.size > 25 * 1024 * 1024 || !ID.test(g.id)) throw new Error('单品图片格式或大小不受支持。');
      if (prepared.get(blob)?.has(g.id)) return prepared.get(blob).get(g.id);
      const remember = value => { if (!prepared.has(blob)) prepared.set(blob, new Map()); prepared.get(blob).set(g.id, value); return value; };
      const bytes = new Uint8Array(await blob.arrayBuffer()), hash = await digest(bytes);
      if (old && old.hash === hash && old.type === blob.type) return remember(validateAsset(old, g.id));
      const created = await request('/git/blobs', { method: 'POST', body: { content: bytes64(bytes), encoding: 'base64' } });
      if (!SHA.test(created.sha)) throw new Error('GitHub 未返回有效的图片编号。');
      const result = { path: 'images/' + g.id + '/' + hash + '.' + TYPES[blob.type], sha: created.sha, hash, type: blob.type, size: blob.size };
      return remember(result);
    }
    async function prepare(garments, outfits, progress = () => {}) {
      const result = empty();
      for (let i = 0; i < garments.length; i++) {
        const g = garments[i]; progress('正在准备照片 ' + (i + 1) + ' / ' + garments.length + '…');
        const assets = {}; for (const field of C.imageFields(g)) assets[field] = await asset(g, field);
        result.garments.push({ ...metadata(g), assets });
      }
      result.outfits = outfits.map(o => ({ ...o, layers: o.layers.map(l => ({ ...l })) }));
      return validateManifest(result);
    }
    async function publish(manifest, remote) {
      const safe = validateManifest(manifest);
      if (remote.exists && sameRecords(safe, remote.manifest)) return { manifest: remote.manifest, head: remote.head };
      safe.updatedAt = new Date().toISOString();
      const assets = new Map();
      for (const g of safe.garments) for (const a of Object.values(g.assets)) assets.set(a.path, a.sha);
      const removed = new Set();
      for (const g of remote.manifest.garments) for (const a of Object.values(g.assets)) if (!assets.has(a.path)) removed.add(a.path);
      const tree = await request('/git/trees', { method: 'POST', body: { base_tree: remote.tree, tree: [
        ...[...assets].map(([path, sha]) => ({ path, sha, mode: '100644', type: 'blob' })),
        ...[...removed].map(path => ({ path, sha: null, mode: '100644', type: 'blob' })),
        { path: FILE, content: JSON.stringify(safe), mode: '100644', type: 'blob' }
      ] } });
      if (!SHA.test(tree.sha)) throw new Error('GitHub 未返回有效的目录编号。');
      const commit = await request('/git/commits', { method: 'POST', body: { message: 'Sync wardrobe records and photos', tree: tree.sha, parents: [remote.head] } });
      if (!SHA.test(commit.sha)) throw new Error('GitHub 未返回有效的提交编号。');
      await request('/git/refs/heads/' + branch.split('/').map(encodeURIComponent).join('/'), { method: 'PATCH', body: { sha: commit.sha, force: false } });
      return { manifest: safe, head: commit.sha };
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
    function disconnect() { token = ''; for (const controller of controllers) controller.abort(); controllers.clear(); }
    return { fullName: fullName.toLowerCase(), connect, readRemote, prepare, publish, getAsset, disconnect };
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
