(async function () {
  'use strict';
  const C = window.WardrobeCore, DB = window.WardrobeStorage, I = window.WardrobeImages;
  const K = window.WardrobeColor;
  let colorScanCancelled = false;
  const $ = id => document.getElementById(id);
  const detailInputs = { brand: 'edit-brand', color: 'edit-color', subcategory: 'edit-subcategory', style: 'edit-style',
    pattern: 'edit-pattern', size: 'edit-size', notes: 'edit-notes', purchasePrice: 'edit-price', currency: 'edit-currency',
    purchaseDate: 'edit-date', purchaseStatus: 'edit-status', originalPrice: 'edit-original-price', purchaseCondition: 'edit-condition',
    purchaseType: 'edit-purchase-type', purchaseSource: 'edit-source' };
  const state = { garments: [], outfits: [], layers: [], background: C.BACKGROUNDS[0],
    activeId: null, selected: null, category: 'all', brand: '', colors: [], colorExpanded: false, favorites: false, query: '', sort: 'newest',
    view: 'closet', history: [], future: [], ready: false };
  const archiveInputs = { year: 'archive-year', season: 'archive-season', collection: 'archive-collection', look: 'archive-look', relation: 'archive-relation', verification: 'archive-verification', sourceUrl: 'archive-source', story: 'archive-story' };
  let staged = [], editing = null, viewed = null, processing = false, busy = false, toastTimer, draftTimer;
  let archiveBook = null, editingFromBook = false;
  const bulkBrand = { active: false, selected: new Set(), previous: null, undo: null, message: '' };
  let requestedArchive = window.location?.search ? new URLSearchParams(window.location.search).get('garment') : null;
  let draftChain = Promise.resolve(), sliderStart = null;
  const Cloud = window.WardrobeCloud, rawLocalWrite = DB.write.bind(DB);
  const cloud = { client: null, saved: { id: 'github-sync', config: { owner: 'SuzyQi', repo: 'wardrobe-studio-data' }, base: null, dirty: true },
    auto: true, timer: null, message: '尚未连接 GitHub', conflict: null, authorization: null };
  const assetLoads = new Map(); let activeAssetLoads = 0, cacheWriteChain = Promise.resolve(); const assetQueue = [];
  const trustedImageCaches = new WeakMap();
  const dirtyImageCaches = new Map();
  function markImageCache(id) { dirtyImageCaches.set(id, (dirtyImageCaches.get(id) || 0) + 1); }
  function cacheIdentity(record, field) { return record.cloudOrigin + ':' + record.id + ':' + field + ':' + record.cloudAssets?.[field]?.sha; }
  function trustImage(record, field) {
    const blob = record[field]; if (!(blob instanceof Blob)) return;
    if (!trustedImageCaches.has(blob)) trustedImageCaches.set(blob, new Set());
    trustedImageCaches.get(blob).add(cacheIdentity(record, field));
  }
  function canRecoverImage(record, field) { return !!trustedImageCaches.get(record[field])?.has(cacheIdentity(record, field)); }
  function replaceRecoveredImage(record, field, oldBlob, blob) {
    markImageCache(record.id);
    record[field] = blob; trustImage(record, field);
    for (const target of [garment(record.id), editing, viewed]) {
      if (target?.id === record.id && target[field] === oldBlob && cacheIdentity(target, field) === cacheIdentity(record, field)) { target[field] = blob; trustImage(target, field); }
    }
  }
  async function localWrite(operations) {
    const recovered = new Set();
    for (;;) {
      try { await rawLocalWrite(operations); return; }
      catch (error) {
        const record = error.name === 'ImageReadError' ? operations.find(op => op.store === 'garments' && op.value?.id === error.garmentId)?.value : null;
        const field = error.field, key = record && cacheIdentity(record, field);
        if (record && cloud.client?.fullName === record.cloudOrigin && canRecoverImage(record, field) && !recovered.has(key)) {
          recovered.add(key);
          const oldBlob = record[field], blob = await cloud.client.getAsset(record.cloudAssets[field], record.id);
          replaceRecoveredImage(record, field, oldBlob, blob); continue;
        }
        const origin = cloud.saved.config.owner + '/' + cloud.saved.config.repo;
        let compacted = false;
        const lean = await Promise.all(operations.map(async op => {
          if (op.store !== 'garments' || op.type === 'delete') return op;
          const value = await Cloud.withoutBackedImageCaches(op.value, origin);
          if (value === op.value) return op;
          compacted = true; return { ...op, value };
        }));
        if (!compacted) throw error;
        // Retry all records and the sync
        // checkpoint atomically; only byte-verified cloud-backed caches are omitted.
        await rawLocalWrite(lean); return;
      }
    }
  }
  DB.write = async operations => {
    const changed = operations.some(op => op.store === 'garments' || op.store === 'outfits');
    const checkpoint = { ...cloud.saved, dirty: true };
    await localWrite(changed ? [...operations, { store: 'meta', value: checkpoint }] : operations);
    if (changed) { cloud.saved = checkpoint; cloud.message = cloud.client ? '本机已保存，等待同步' : '本机已保存，连接后同步'; renderCloudStatus(); scheduleCloud(); }
  };
  function updateStorageStatus() {
    $('storage-status').textContent = cloud.client ? (cloud.saved.dirty ? '本机已保存 · 等待 GitHub 同步' : '已保存至私有 GitHub 仓库') : '本机缓存 · 可连接 GitHub 同步';
  }
  function renderCloudStatus() {
    $('cloud-status').textContent = cloud.message;
    $('cloud-repository').textContent = cloud.saved.config.owner + '/' + cloud.saved.config.repo;
    $('cloud-sync-now').disabled = !cloud.client;
    $('cloud-disconnect').hidden = !cloud.client;
    $('cloud-button-label').textContent = cloud.client ? (cloud.message.startsWith('正在同步') ? '同步中' : cloud.saved.dirty ? '待同步' : '已同步') : 'GitHub 同步';
    $('cloud-last-sync').textContent = cloud.saved.lastSyncAt ? '上次同步：' + new Date(cloud.saved.lastSyncAt).toLocaleString('zh-CN') : '同步照片、单品档案和已保存的搭配。';
    $('archive-sync-status').textContent = !cloud.client ? '已保存到本机 · 连接 GitHub 后可同步到其他设备'
      : cloud.conflict ? '本机已保存 · 存在同步冲突，请在 GitHub 同步窗口处理'
      : cloud.message.startsWith('正在同步') ? '本机已保存 · 正在同步至 GitHub…'
      : cloud.message.includes('未完成') ? '同步未完成 · 本机记录保留，请在 GitHub 同步窗口重试'
      : cloud.saved.dirty ? (cloud.auto ? '本机已保存 · 等待自动同步至 GitHub' : '本机已保存 · 自动同步已关闭，请手动同步')
      : '已同步至 GitHub · 其他设备连接后可查看';
    archiveBook?.setSync($('archive-sync-status').textContent);
    if (state.ready) updateStorageStatus();
  }
  const authorizationStores = [['device', 'localStorage', 'wardrobe-github-device'], ['session', 'sessionStorage', 'wardrobe-github-session']];
  function storedAuthorization() {
    for (const [mode, storage, key] of authorizationStores) {
      try {
        const config = JSON.parse(window[storage].getItem(key) || 'null');
        if (config && ['owner', 'repo', 'token'].every(field => typeof config[field] === 'string' && config[field].trim())) return { config, mode };
        window[storage].removeItem(key);
      } catch { /* A browser may block one storage area while allowing the other. */ }
    }
    return null;
  }
  function saveAuthorization(config, mode = 'memory') {
    let saved = true;
    for (const [target, storage, key] of authorizationStores) {
      try {
        if (config && mode === target) window[storage].setItem(key, JSON.stringify({ owner: config.owner, repo: config.repo, token: config.token }));
        else window[storage].removeItem(key);
      } catch { saved = false; }
    }
    return saved;
  }
  function scheduleCloud() {
    clearTimeout(cloud.timer);
    if (!cloud.client || !cloud.auto || !cloud.saved.dirty || cloud.conflict) return;
    cloud.timer = setTimeout(() => {
      if (bulkBrand.active || busy || document.querySelector('dialog[open]:not(#archive-dialog)')) return scheduleCloud();
      syncCloud().catch(report);
    }, 3000);
  }
  function queuedAsset(task) {
    return new Promise((resolve, reject) => {
      assetQueue.push({ task, resolve, reject }); runAssetQueue();
    });
  }
  function runAssetQueue() {
    while (activeAssetLoads < 3 && assetQueue.length) {
      const { task, resolve, reject } = assetQueue.shift(); activeAssetLoads++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { activeAssetLoads--; runAssetQueue(); });
    }
  }
  async function ensureAsset(record, field, refresh = false) {
    if (record[field] && !refresh) return record[field];
    if (!cloud.client || record.cloudOrigin !== cloud.client.fullName || !record.cloudAssets?.[field]) throw new Error('请先连接 GitHub，以加载这件衣服的图片或原图。');
    const reference = record.cloudAssets[field], key = record.cloudOrigin + ':' + reference.sha;
    if (!assetLoads.has(key)) {
      const client = cloud.client;
      assetLoads.set(key, queuedAsset(() => client.getAsset(reference, record.id)).finally(() => assetLoads.delete(key)));
    }
    const blob = await assetLoads.get(key); record[field] = blob; trustImage(record, field);
    const current = garment(record.id);
    if (current?.cloudOrigin === record.cloudOrigin && current.cloudAssets?.[field]?.sha === reference.sha) {
      current[field] = blob;
      markImageCache(current.id);
      if (!cloud.applying && !busy) {
        const version = dirtyImageCaches.get(current.id);
        cacheWriteChain = cacheWriteChain.catch(() => {}).then(async () => { await localWrite([{ store: 'garments', value: current }]); if (dirtyImageCaches.get(current.id) === version) dirtyImageCaches.delete(current.id); });
        try { await cacheWriteChain; } catch { $('storage-status').textContent = '图片已加载，本机缓存未写入；云端仍保留图片'; }
      }
    }
    if (editing?.id === record.id && editing.cloudAssets?.[field]?.sha === reference.sha) editing[field] = blob;
    return blob;
  }
  const observedImages = new WeakMap();
  const imageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { const load = observedImages.get(entry.target); imageObserver.unobserve(entry.target); if (load) load(); }
  }, { rootMargin: '240px' }) : null;
  function showAsset(img, record, field) {
    const marker = {}; img.wardrobeImage = marker;
    let lastBlob, failures = 0;
    const current = () => img.wardrobeImage === marker && img.isConnected !== false;
    const pending = () => { img.classList.add('cloud-image-pending'); img.classList.remove('cloud-image-failed'); img.style.opacity = '0'; img.title = '正在加载图片…'; };
    const failed = () => {
      if (!current()) return;
      img.classList.remove('cloud-image-pending'); img.classList.add('cloud-image-failed'); img.style.opacity = '0';
      img.title = '图片暂未加载，请连接 GitHub 后点击「立即同步」重试';
    };
    const assign = (blob, renew = false) => { if (img.wardrobeImage === marker) { lastBlob = blob; img.src = url(blob, renew); } };
    // Avoid combining native lazy loading of blob URLs with the network observer below.
    img.loading = 'eager'; img.decoding = 'async'; pending();
    img.onload = () => { if (current()) { img.classList.remove('cloud-image-pending', 'cloud-image-failed'); img.style.opacity = ''; img.title = ''; } };
    img.onerror = () => {
      if (!current()) return; pending();
      const sourceField = field === 'thumb' ? 'image' : field;
      const recovery = ++failures === 1 && lastBlob ? Promise.resolve(lastBlob)
        : failures === 2 && field === 'thumb' ? ensureAsset(record, 'image')
        : failures === (field === 'thumb' ? 3 : 2) ? ensureAsset(record, sourceField, true) : null;
      if (!recovery) return failed();
      recovery.then(blob => assign(blob, true)).catch(failed);
    };
    const load = () => ensureAsset(record, field).then(blob => { if (current()) assign(blob); }).catch(failed);
    if (record[field]) { assign(record[field]); return; }
    if (imageObserver && (field === 'thumb' || field.startsWith('photo_'))) { observedImages.set(img, load); imageObserver.observe(img); } else load();
  }
  async function applyCloud(published, prepared, client) {
    cloud.applying = true;
    await cacheWriteChain.catch(() => {});
    const nextGarments = Cloud.localRecords(published.manifest, state.garments, client.fullName, prepared);
    for (const g of nextGarments) {
      const preparedRecord = prepared.garments.find(value => value.id === g.id);
      for (const field of C.imageFields(g)) if (preparedRecord?.assets[field]?.sha === g.cloudAssets[field]?.sha) trustImage(g, field);
    }
    const nextOutfits = published.manifest.outfits, ids = new Set(nextGarments.map(g => g.id)), outfitIds = new Set(nextOutfits.map(o => o.id));
    const layers = state.layers.filter(l => ids.has(l.garmentId));
    const checkpoint = { id: 'github-sync', config: { ...cloud.saved.config }, base: published.manifest, head: published.head, tree: published.tree, fileSHA: published.fileSHA,
      lastSyncAt: new Date().toISOString(), dirty: false, auto: cloud.auto };
    const sameCachedRecord = (a, b) => {
      if (!a || Object.keys(a).length !== Object.keys(b).length) return false;
      return Object.keys(b).every(key => Object.hasOwn(a, key) && (a[key] instanceof Blob || b[key] instanceof Blob ? a[key] === b[key] : JSON.stringify(a[key]) === JSON.stringify(b[key])));
    };
    const oldGarments = new Map(state.garments.map(g => [g.id, g])), oldOutfits = new Map(state.outfits.map(o => [o.id, o]));
    const changedGarments = nextGarments.filter(g => dirtyImageCaches.has(g.id) || !sameCachedRecord(oldGarments.get(g.id), g));
    const cacheVersions = new Map(changedGarments.map(g => [g.id, dirtyImageCaches.get(g.id)]));
    const operations = [
      ...state.garments.filter(g => !ids.has(g.id)).map(g => ({ store: 'garments', type: 'delete', id: g.id })),
      ...state.outfits.filter(o => !outfitIds.has(o.id)).map(o => ({ store: 'outfits', type: 'delete', id: o.id })),
      ...changedGarments.map(value => ({ store: 'garments', value })),
      ...nextOutfits.filter(o => !sameCachedRecord(oldOutfits.get(o.id), o)).map(value => ({ store: 'outfits', value })),
      { store: 'meta', value: checkpoint }, { store: 'meta', value: draftRecord({ ...snap(), layers, activeId: outfitIds.has(state.activeId) ? state.activeId : null }) }
    ];
    try { await localWrite(operations); } finally { cloud.applying = false; }
    for (const [id, version] of cacheVersions) if (dirtyImageCaches.get(id) === version) dirtyImageCaches.delete(id);
    state.garments = nextGarments; state.outfits = nextOutfits; state.layers = layers; state.selected = null;
    if (!outfitIds.has(state.activeId)) state.activeId = null;
    state.history = []; state.future = []; cloud.saved = checkpoint; cloud.conflict = null;
    renderCloset(); renderBoard(); renderOutfits();
    refreshViewedArchive();
  }
  function showConflicts(conflicts) {
    $('cloud-conflict-list').replaceChildren();
    for (const conflict of conflicts) {
      const row = node('label', 'cloud-conflict-row'); row.append(node('strong', '', conflict.name));
      row.append(node('span', 'subtle', '本机：' + (conflict.local ? '已修改' : '已删除') + ' · GitHub：' + (conflict.remote ? '已修改' : '已删除')));
      const select = node('select'); select.dataset.key = conflict.key; select.setAttribute('aria-label', conflict.name + '保留哪个版本');
      for (const [value, label] of [['', '请选择保留的版本'], ['local', '保留本机版本'], ['remote', '保留 GitHub 版本']]) { const opt = node('option', '', label); opt.value = value; select.append(opt); }
      row.append(select); $('cloud-conflict-list').append(row);
    }
    if ($('cloud-dialog').open) $('cloud-dialog').close(); $('cloud-conflict-dialog').showModal();
  }
  function renderSyncTiming() {
    const timing = cloud.timing; if (!timing) return;
    const seconds = ms => (ms / 1000).toFixed(1) + ' 秒';
    const rows = [...timing.stages];
    if (timing.current) rows.push({ label: timing.current, ms: Date.now() - timing.at });
    const container = $('cloud-sync-timings'); container.replaceChildren();
    container.append(node('p', '', (timing.finished ? '最近一次总耗时：' : '本次已等待：') + seconds((timing.ended || Date.now()) - timing.started)));
    for (const row of rows) container.append(node('p', '', row.label + '：' + seconds(row.ms)));
    if (timing.photos) container.append(node('p', '', '图片校验读取 ' + (timing.photos.readBytes / 1048576).toFixed(1) + ' MB · 复用 ' + timing.photos.reused + ' 张 · 新上传 ' + timing.photos.uploaded + ' 张'));
    $('sync-elapsed').textContent = timing.finished ? '' : '已等待 ' + seconds(Date.now() - timing.started) + ' · ' + timing.current;
  }
  async function syncCloud(resolutionPackage) {
    if (!cloud.client || busy || !state.ready) return;
    clearTimeout(cloud.timer); let conflicts = null;
    cloud.message = '正在同步至私有 GitHub 仓库…'; renderCloudStatus();
    cloud.cancelled = false;
    const timing = cloud.timing = { started: Date.now(), at: Date.now(), current: '等待本机保存', stages: [] };
    const phase = label => { if (timing.current) timing.stages.push({ label: timing.current, ms: Date.now() - timing.at }); timing.current = label; timing.at = Date.now(); renderSyncTiming(); };
    let timingTimer;
    const tick = () => { if (!timing.finished) { renderSyncTiming(); timingTimer = setTimeout(tick, 1000); } };
    $('sync-elapsed').hidden = false; tick();
    const checkCancellation = () => { if (cloud.cancelled) { const error = new Error('已停止本次同步，本机记录已保留；可稍后重试。'); error.name = 'SyncCancelled'; throw error; } };
    $('cloud-sync-cancel').hidden = false; $('cloud-sync-cancel').disabled = false;
    try {
      await work('正在检查云端衣橱…', async () => {
        await draftChain;
        checkCancellation();
        phase('连接 GitHub'); const client = cloud.client; await client.connect();
        phase('读取云端资料');
        const remote = await client.readRemote(); checkCancellation();
        if (!remote.exists && cloud.saved.base) throw new Error('云端衣橱文件缺失，本机记录已保留。请先在 GitHub 恢复 wardrobe.json，再重新同步。');
        phase('图片校验与上传');
        const prepared = await client.prepare(state.garments, state.outfits, (message, stats) => { $('busy-message').textContent = message; if (stats) timing.photos = stats; renderSyncTiming(); });
        phase('合并衣橱资料');
        let merged = Cloud.merge(cloud.saved.base, prepared, remote.manifest);
        if (merged.conflicts.length && resolutionPackage) {
          const choices = {};
          for (const conflict of merged.conflicts) {
            const old = resolutionPackage.conflicts.find(c => c.key === conflict.key);
            if (old && JSON.stringify(old.local) === JSON.stringify(conflict.local) && JSON.stringify(old.remote) === JSON.stringify(conflict.remote)) choices[conflict.key] = resolutionPackage.choices[conflict.key];
          }
          merged = Cloud.merge(cloud.saved.base, prepared, remote.manifest, choices);
        }
        if (merged.conflicts.length) { conflicts = merged.conflicts; cloud.conflict = conflicts; cloud.message = '发现不同设备的修改，请选择保留版本'; return; }
        $('busy-message').textContent = '正在保存云端版本…';
        phase('检查云端变更');
        const published = await client.publish(merged.manifest, remote, message => { $('busy-message').textContent = message; const labels = ['云端：建立目录', '云端：建立版本', '云端：确认保存']; const step = /（([123]) \/ 3）/.exec(message); if (step) phase(labels[Number(step[1]) - 1]); else if (message === '正在保存云端资料…') phase('云端：保存资料'); });
        checkCancellation();
        $('cloud-sync-cancel').disabled = true; $('busy-message').textContent = '正在更新本机记录…';
        phase('写入本机记录');
        await applyCloud(published, prepared, client);
        cloud.message = '已同步，照片和档案保存在私有仓库';
      });
    } catch (error) { cloud.message = error.name === 'SyncCancelled' ? '已暂停同步，本机记录已保留' : '同步未完成，本机记录已保留'; renderCloudStatus(); throw error; }
    finally { phase(''); timing.finished = true; timing.ended = Date.now(); clearTimeout(timingTimer); renderSyncTiming(); $('sync-elapsed').hidden = true; $('cloud-sync-cancel').hidden = true; }
    renderCloudStatus();
    if (conflicts) showConflicts(conflicts);
  }
  async function connectCloud(remembered) {
    if (!state.ready || busy) return;
    const config = remembered?.config || { owner: $('cloud-owner').value.trim(), repo: $('cloud-repo').value.trim(), token: $('cloud-token').value.trim() };
    $('cloud-token').value = '';
    const mode = remembered?.mode || ($('cloud-remember').checked ? 'device' : 'memory'), previousClient = cloud.client, previousSaved = cloud.saved;
    const candidate = Cloud.createClient({ ...config, cachedRemote: { origin: (cloud.saved.config.owner + '/' + cloud.saved.config.repo).toLowerCase(), head: cloud.saved.head, tree: cloud.saved.tree, fileSHA: cloud.saved.fileSHA, manifest: cloud.saved.base }, canRecoverAsset: canRecoverImage, canReuseAsset: canRecoverImage, onRecoveredAsset: replaceRecoveredImage });
    try {
      const same = (cloud.saved.config.owner + '/' + cloud.saved.config.repo).toLowerCase() === candidate.fullName;
      cloud.client = candidate; cloud.saved = { ...cloud.saved, config: { owner: config.owner, repo: config.repo }, base: same ? cloud.saved.base : null };
      await syncCloud();
      if (previousClient && previousClient !== candidate) previousClient.disconnect();
      cloud.authorization = config;
      const saved = saveAuthorization(config, mode);
      if (!cloud.conflict) {
        $('cloud-dialog').close();
        toast(saved ? (mode === 'device' ? '已同步并记住此设备，下次打开自动连接。' : 'GitHub 已连接，衣橱已同步。') : '衣橱已同步，但浏览器未能保存授权；下次打开仍需重新输入。', !saved);
      }
    } catch (error) {
      candidate.disconnect(); cloud.client = previousClient; cloud.saved = previousSaved; cloud.message = error.name === 'SyncCancelled' ? '已暂停同步，本机记录已保留' : '连接或同步未完成，本机记录已保留'; renderCloudStatus(); throw error;
    }
  }
  const urls = new Map();
  function url(blob, renew = false) { if (renew || !urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); }
  function cleanupUrls() {
    const used = new Set();
    for (const g of [...state.garments, ...staged, ...[editing, viewed].filter(Boolean)]) for (const value of Object.values(g)) if (urls.has(value)) used.add(value);
    for (const [blob, value] of urls) if (!used.has(blob)) { URL.revokeObjectURL(value); urls.delete(blob); }
  }
  function node(tag, className, text) {
    const e = document.createElement(tag); if (className) e.className = className;
    if (text !== undefined) e.textContent = text; return e;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
  }
  function action(label, name, className = 'icon-button') {
    const b = node('button', className); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.append(icon(name)); return b;
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    $('toast').style.background = error ? '#77625f' : ''; toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3200);
  }
  function report(error) { if (error?.name === 'SyncCancelled') { toast(error.message); return; } console.error(error); toast(error?.message || '这次操作没有完成，请重试。', true); }
  function listen(target, event, handler) {
    (typeof target === 'string' ? $(target) : target).addEventListener(event, e => {
      try { Promise.resolve(handler(e)).catch(report); } catch (error) { report(error); }
    });
  }
  async function work(message, fn) {
    if (busy) return;
    busy = true; $('busy-message').textContent = message;
    $('busy-overlay').hidden = false; $('busy-overlay').showModal();
    try { return await fn(); }
    finally { $('busy-overlay').close(); $('busy-overlay').hidden = true; busy = false; }
  }
  async function confirmAction(title, message, label = '确定') {
    const d = $('confirm-dialog'); $('confirm-title').textContent = title;
    $('confirm-message').textContent = message; $('confirm-yes').textContent = label;
    return new Promise(resolve => {
      const close = () => { d.removeEventListener('close', close); resolve(d.returnValue === 'yes'); };
      d.returnValue = ''; d.addEventListener('close', close);
      $('confirm-yes').onclick = () => d.close('yes'); $('confirm-no').onclick = () => d.close('no'); d.showModal();
    });
  }
  const garment = id => state.garments.find(g => g.id === id);
  const selected = () => state.layers.find(l => l.id === state.selected);
  const snap = () => ({ layers: state.layers.map(l => ({ ...l })), background: state.background,
    name: $('outfit-name').value, activeId: state.activeId });
  function pushHistory(value = snap()) { state.history.push(value); if (state.history.length > 45) state.history.shift(); state.future = []; }
  function draftRecord(value = snap()) { return { id: 'draft', ...value }; }
  function saveDraft() {
    if (!state.ready) return Promise.resolve();
    clearTimeout(draftTimer); const value = draftRecord();
    $('storage-status').textContent = '正在保存画布…';
    draftChain = draftChain.catch(() => {}).then(() => DB.write([{ store: 'meta', value }])).then(() => {
      updateStorageStatus();
    }).catch(error => { $('storage-status').textContent = '本机保存失败，请导出备份'; report(error); });
    return draftChain;
  }
  function applySnapshot(value) {
    state.layers = value.layers.filter(l => garment(l.garmentId)).map(l => ({ ...l }));
    state.background = C.normalizeBackground(value.background);
    state.activeId = state.outfits.some(o => o.id === value.activeId) ? value.activeId : null;
    state.selected = null; $('outfit-name').value = typeof value.name === 'string' ? value.name.slice(0, 100) : '';
    renderBoard(); saveDraft();
  }
  function undo() {
    if (!state.history.length) return;
    state.future.push(snap()); applySnapshot(state.history.pop());
  }
  function categorySelect(select, includeAuto = false) {
    select.replaceChildren();
    if (includeAuto) { const opt = node('option', '', '按文件名建议分类'); opt.value = 'auto'; select.append(opt); }
    for (const c of C.CATEGORIES.slice(1)) { const opt = node('option', '', c.label); opt.value = c.id; select.append(opt); }
  }
  function renderTabs() {
    $('category-tabs').replaceChildren();
    for (const c of C.CATEGORIES) {
      const b = node('button', 'category-tab' + (state.category === c.id ? ' active' : ''), c.label);
      b.type = 'button'; b.setAttribute('aria-pressed', String(state.category === c.id));
      b.onclick = () => { state.category = c.id; renderCloset(); };
      $('category-tabs').append(b);
    }
  }
  const addedBrandChoices = ['Gucci', 'Chanel', 'Uniqlo', 'Crocs', 'Paloma Wool', 'Rarely Alike', 'Moon Boot', 'Zara', 'Lululemon', 'Rab', 'Skims', 'Vintage', 'Tory Burch', 'Max Mara', 'Ganni', 'Balmain', 'LK Bennett', 'Moncler', 'Burberry', 'Renlisu', 'Shiatzy Chen', 'Dolce & Gabbana', 'New Balance', 'Abra', 'Needle And Thread', 'Givenchy', 'Jaded London'];
  function brandChoices() {
    const used = C.brandOptions([...state.garments, ...staged]).filter(b => b.value !== 'unbranded');
    return C.brandOptions([...used.map(b => ({ brand: b.label })), ...addedBrandChoices.map(brand => ({ brand }))])
      .map(b => ({ ...b, count: used.find(x => x.value === b.value)?.count || 0 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
  }
  function bindBrandChoice(select, input, value, onChange) {
    const choices = brandChoices();
    select.replaceChildren();
    const empty = node('option', '', '选择品牌（可选）'); empty.value = ''; select.append(empty);
    for (const brand of choices) { const option = node('option', '', brand.label); option.value = brand.label; select.append(option); }
    const custom = node('option', '', '其他品牌，手动输入'); custom.value = '__custom__'; select.append(custom);
    input.value = C.formatBrand(value);
    const syncSelection = () => {
      const selected = choices.find(b => C.matchesBrand({ brand: input.value }, b.value));
      select.value = selected ? selected.label : input.value.trim() ? '__custom__' : '';
    };
    syncSelection(); input.hidden = select.value !== '__custom__';
    select.onchange = () => {
      input.hidden = select.value !== '__custom__';
      if (select.value === '__custom__') { input.focus?.(); return; }
      input.value = select.value; onChange?.(input.value);
    };
    input.oninput = () => { syncSelection(); onChange?.(input.value); };
  }
  function renderBrands() {
    const options = C.brandOptions(state.garments), select = $('brand-filter');
    if (state.brand && !options.some(b => b.value === state.brand)) state.brand = '';
    select.replaceChildren(); const all = node('option', '', '全部品牌'); all.value = ''; select.append(all);
    $('brand-suggestions').replaceChildren();
    for (const brand of options) {
      const opt = node('option', '', brand.label + '（' + brand.count + '）'); opt.value = brand.value; select.append(opt);

    }
    select.value = state.brand;
    for (const brand of brandChoices()) { const suggestion = node('option'); suggestion.value = brand.label; $('brand-suggestions').append(suggestion); }
  }
  function missingBrand(g) { return !C.formatBrand(g.brand); }
  function renderBulkBrand() {
    const missing = state.garments.filter(missingBrand);
    const eligible = new Set(missing.map(g => g.id));
    for (const id of bulkBrand.selected) if (!eligible.has(id)) bulkBrand.selected.delete(id);
    $('bulk-brand-start').hidden = bulkBrand.active || !missing.length;
    $('bulk-brand-start').textContent = '补品牌 · ' + missing.length;
    $('bulk-brand-header').hidden = !bulkBrand.active;
    $('bulk-brand-remaining').textContent = '还剩 ' + missing.length + ' 件 · 勾选同品牌的衣服';
    $('brand-filter').disabled = bulkBrand.active;
    $('workspace').classList.toggle('bulk-brand-mode', bulkBrand.active);
    $('bulk-brand-empty').hidden = !bulkBrand.active || !!missing.length;
    $('bulk-brand-bar').hidden = !bulkBrand.active || !bulkBrand.selected.size || state.view !== 'closet';
    const visible = new Set([...$('garment-grid').children].map(card => card.dataset?.garmentId));
    const outside = [...bulkBrand.selected].filter(id => !visible.has(id)).length;
    $('bulk-brand-count').textContent = '已选 ' + bulkBrand.selected.size + ' 件' + (outside ? '（筛选外 ' + outside + ' 件）' : '');
    $('bulk-brand-apply').disabled = !bulkBrand.selected.size || !$('bulk-brand-input').value.trim();
    $('bulk-brand-notice').hidden = !bulkBrand.message;
    $('bulk-brand-message').textContent = bulkBrand.message;
    $('bulk-brand-undo').hidden = !bulkBrand.undo;
  }
  function startBulkBrand() {
    if (bulkBrand.active || busy) return;
    bulkBrand.previous = { category: state.category, brand: state.brand, colors: [...state.colors], favorites: state.favorites, query: state.query, sort: state.sort };
    bulkBrand.active = true; bulkBrand.selected.clear();
    Object.assign(state, { category: 'all', brand: 'unbranded', colors: [], favorites: false, query: '' });
    $('search').value = ''; $('bulk-brand-error').hidden = true;
    bindBrandChoice($('bulk-brand-choice'), $('bulk-brand-input'), '', renderBulkBrand);
    renderCloset(); $('bulk-brand-finish').focus?.();
  }
  function finishBulkBrand() {
    if (!bulkBrand.active || busy) return;
    bulkBrand.active = false; bulkBrand.selected.clear();
    Object.assign(state, bulkBrand.previous || {}); bulkBrand.previous = null;
    $('search').value = state.query; $('sort').value = state.sort; $('bulk-brand-error').hidden = true;
    renderCloset(); ( $('bulk-brand-start').hidden ? $('brand-filter') : $('bulk-brand-start') ).focus?.();
    scheduleCloud();
  }
  async function applyBulkBrand() {
    if (busy || !bulkBrand.active) return;
    const brand = C.formatBrand($('bulk-brand-input').value).slice(0, 100);
    if (!brand || !bulkBrand.selected.size) return;
    $('bulk-brand-error').hidden = true;
    try {
      await work('正在补充品牌…', async () => {
        await cacheWriteChain.catch(() => {});
        const targets = state.garments.filter(g => bulkBrand.selected.has(g.id) && missingBrand(g));
        if (!targets.length) { renderCloset(); return; }
        const now = new Date().toISOString(), values = targets.map(g => ({ ...g, brand, updatedAt: now }));
        await DB.write(values.map(value => ({ store: 'garments', value })));
        const updates = new Map(values.map(g => [g.id, g]));
        state.garments = state.garments.map(g => updates.get(g.id) || g);
        bulkBrand.undo = targets.map(g => ({ id: g.id, before: g.brand || '', applied: brand }));
        bulkBrand.message = '已为 ' + values.length + ' 件衣服设置 ' + brand + ' · 本机已保存' + (cloud.client && cloud.auto ? '，点击「完成」后统一同步' : '');
        bulkBrand.selected.clear();
        bindBrandChoice($('bulk-brand-choice'), $('bulk-brand-input'), '', renderBulkBrand);
        renderCloset(); refreshViewedArchive(); toast(bulkBrand.message + '，可撤销本次修改。');
      });
    } catch (error) { $('bulk-brand-error').textContent = '本次未保存：' + error.message; $('bulk-brand-error').hidden = false; throw error; }
  }
  async function undoBulkBrand() {
    if (busy || !bulkBrand.undo) return;
    $('bulk-brand-error').hidden = true;
    try {
      await work('正在撤销品牌修改…', async () => {
        await cacheWriteChain.catch(() => {});
        const pending = new Map(bulkBrand.undo.map(g => [g.id, g]));
        // Revert only our brand assignment. Preserve later edits and never recreate deleted clothes.
        const values = state.garments.filter(g => pending.has(g.id) && g.brand === pending.get(g.id).applied)
          .map(g => ({ ...g, brand: pending.get(g.id).before, updatedAt: new Date().toISOString() }));
        if (values.length) await DB.write(values.map(value => ({ store: 'garments', value })));
        const updates = new Map(values.map(g => [g.id, g]));
        state.garments = state.garments.map(g => updates.get(g.id) || g);
        bulkBrand.undo = null; bulkBrand.message = values.length ? '已撤销 ' + values.length + ' 件衣服的品牌修改' : '这些衣服的品牌已再次修改，本次未覆盖。';
        renderCloset(); refreshViewedArchive(); toast(bulkBrand.message);
      });
    } catch (error) { $('bulk-brand-error').textContent = '撤销未完成：' + error.message; $('bulk-brand-error').hidden = false; throw error; }
  }
  function colorSelect(select, value) {
    select.replaceChildren(); for (const c of K.COLORS) { const o = node('option', '', c.label); o.value = c.id; select.append(o); } select.value = value || 'unknown';
  }
  function renderColorFilters() {
    const candidates = state.garments.filter(g => (state.category === 'all' || state.category === g.category) && C.matchesBrand(g, state.brand) && (!state.favorites || g.favorite) && (!state.query || C.matchesGarment(g, state.query)));
    const list = $('primary-color-list'); list.replaceChildren(); list.dataset.expanded = String(state.colorExpanded);
    $('expand-colors').textContent = state.colorExpanded ? '收起颜色' : '展开颜色'; $('expand-colors').setAttribute('aria-expanded', String(state.colorExpanded));
    const add = (id, label, count, hex) => {
      const b = node('button', 'color-chip'), selected = id === 'all' ? !state.colors.length : state.colors.includes(id); b.type = 'button'; b.dataset.color = id; b.setAttribute('aria-pressed', String(selected)); b.setAttribute('aria-label', label + '，' + count + ' 件' + (selected ? '，已选中' : ''));
      const dot = node('span', 'color-dot'); dot.dataset.color = id; dot.setAttribute('aria-hidden', 'true'); if (hex) dot.style.backgroundColor = hex;
      b.append(dot, node('span', '', label), node('span', 'color-chip-count', count));
      b.onclick = () => { state.colors = id === 'all' ? [] : state.colors.includes(id) ? state.colors.filter(c => c !== id) : [...state.colors, id]; renderCloset(); };
      list.append(b);
    };
    add('all', '全部', candidates.length); for (const c of K.COLORS) add(c.id, c.label, candidates.filter(g => (g.mainColor || 'unknown') === c.id).length, c.hex);
    const missing = state.garments.filter(g => !g.mainColor).length;
    $('complete-colors').textContent = missing ? '补全主色（' + missing + '）' : '主色已补全'; $('complete-colors').disabled = !missing;
    $('primary-color-section').hidden = !state.garments.length;
  }
  async function colorSuggestion(file) { return I.suggestColor ? I.suggestColor(file) : { mainColor: 'unknown', colorSource: 'auto' }; }
  async function completeColors() {
    if (busy || processing) return;
    const ids = state.garments.filter(g => !g.mainColor).map(g => g.id); if (!ids.length) return;
    colorScanCancelled = false; $('color-scan-cancel').hidden = false; $('color-scan-cancel').textContent = '停止补全';
    let saved = 0, unknown = 0, failed = 0;
    try {
      await work('正在分析服装主色…', async () => {
        for (let i = 0; i < ids.length; i++) {
          if (colorScanCancelled) break; const before = garment(ids[i]); if (!before || before.mainColor) continue; const revision = before.updatedAt;
          $('busy-message').textContent = '正在分析主色 ' + (i + 1) + ' / ' + ids.length + ' · 已保存 ' + saved + ' 件';
          let suggestion;
          try { let photo; try { photo = await ensureAsset(before, 'thumb'); } catch { photo = await ensureAsset(before, 'image'); } suggestion = await colorSuggestion(photo); } catch { failed++; continue; }
          if (colorScanCancelled) break; const current = garment(ids[i]); if (!current || current.mainColor || current.updatedAt !== revision) continue;
          const value = { ...current, ...suggestion, updatedAt: new Date().toISOString() };
          await DB.write([{ store: 'garments', value }]); state.garments = state.garments.map(g => g.id === value.id ? value : g); saved++; if (value.mainColor === 'unknown') unknown++;
        }
      });
    } finally {
      $('color-scan-cancel').hidden = true; renderCloset();
      $('primary-color-status').textContent = (colorScanCancelled ? '已停止。' : '') + '已补全 ' + saved + ' 件，其中 ' + unknown + ' 件待确认。' + (failed ? failed + ' 件图片未能读取，连接同步后可重试。' : '可在单品档案中修改主色。');
    }
  }
  function renderValue() {
    const value = C.wardrobeValue(state.garments);
    for (const [id, key] of [['closet-purchase-total', 'purchaseTotal'], ['closet-original-total', 'originalTotal']]) {
      const amounts = value.totals.filter(g => g[key] !== null); const el = $(id); el.replaceChildren();
      if (!amounts.length) el.append(node('span', 'value-placeholder', '暂无记录'));
      for (const g of amounts) { const amount = node('span', 'value-amount', C.formatMoney(g[key], g.currency)); amount.dataset.currency = g.currency; el.append(amount); }
    }
    $('closet-value-note').textContent = value.count ? '已购入 ' + value.count + ' 件 · 实付已记录 ' + value.pricedCount + ' 件 · ' + value.unpricedCount + ' 件未填 · 原价已记录 ' + value.originalCount + ' 件。想买与示例不计入，不同币种分别统计。' : '填写实际购入价后自动汇总。仅统计已购入单品，想买与示例不计入；不同币种分别统计。';
  }
  function renderCloset() {
    if (bulkBrand.active) state.brand = 'unbranded';
    renderTabs(); renderBrands(); renderColorFilters(); renderValue(); $('garment-count').textContent = state.garments.length;
    $('favorite-filter').setAttribute('aria-pressed', String(state.favorites));
    let items = state.garments.filter(g => (!bulkBrand.active || missingBrand(g)) && (state.category === 'all' || state.category === g.category) && C.matchesBrand(g, state.brand) &&
      (!state.favorites || g.favorite) && K.matches(g, state.colors) && (!state.query || C.matchesGarment(g, state.query)));
    items.sort((a, b) => state.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : state.sort === 'category' ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'zh-CN') : b.createdAt.localeCompare(a.createdAt));
    const grid = $('garment-grid'); grid.replaceChildren();
    const allEmpty = state.garments.length === 0;
    $('closet-empty').hidden = !allEmpty; $('no-results').hidden = allEmpty || items.length > 0;
    if (bulkBrand.active && !state.garments.some(missingBrand)) $('no-results').hidden = true;
    grid.hidden = allEmpty || items.length === 0; $('closet-tip').hidden = bulkBrand.active || allEmpty || !items.length;
    const filtering = state.category !== 'all' || state.brand || state.colors.length || state.favorites || state.query;
    $('filter-summary').hidden = !filtering || allEmpty;
    const filteredValue = C.wardrobeValue(items);
    const subtotal = filteredValue.totals.filter(g => g.purchaseTotal !== null).map(g => C.formatMoney(g.purchaseTotal, g.currency)).join('、');
    $('filter-summary').textContent = '找到 ' + items.length + ' 件单品' + (state.colors.length ? ' · 主色：' + state.colors.map(K.label).join('、') : '') + ' · 已购入实付小计：' + (subtotal || '未记录') + (filteredValue.unpricedCount ? ' · ' + filteredValue.unpricedCount + ' 件未填实付价' : '');
    if (bulkBrand.active) $('filter-summary').textContent = '当前显示 ' + items.length + ' 件未填品牌的衣服';
    for (const g of items) {
      const card = node('article', 'garment-card'); card.dataset.garmentId = g.id;
      const visual = node('div', 'garment-visual');
      const imageButton = node('button', 'garment-image-button'); imageButton.type = 'button';
      imageButton.setAttribute('aria-label', '查看藏品档案：' + g.name); imageButton.onclick = () => openArchive(g.id);
      const img = node('img'); img.alt = g.name; img.loading = 'lazy'; img.draggable = false; imageButton.append(img); showAsset(img, g, 'thumb');
      const favorite = action(g.favorite ? '取消收藏' : '收藏单品', 'heart', 'icon-button card-favorite'); favorite.setAttribute('aria-pressed', String(g.favorite));
      favorite.onclick = async () => {
        favorite.disabled = true;
        try { const updated = { ...g, favorite: !g.favorite }; await DB.write([{ store: 'garments', value: updated }]); state.garments = state.garments.map(x => x.id === g.id ? updated : x); renderCloset(); }
        catch (error) { favorite.disabled = false; report(error); }
      };
      const edit = action('编辑' + g.name, 'edit', 'icon-button card-edit'); edit.onclick = () => openEdit(g.id);
      const add = action('加入搭配：' + g.name, 'plus', 'card-add'); add.onclick = () => addLayer(g.id);
      visual.append(imageButton);
      if (bulkBrand.active) {
        const check = node('button', 'bulk-brand-check'); check.type = 'button'; check.setAttribute('role', 'checkbox');
        check.setAttribute('aria-label', '选择衣服：' + g.name);
        const paint = () => { const selected = bulkBrand.selected.has(g.id); check.setAttribute('aria-checked', String(selected)); check.textContent = selected ? '✓' : ''; card.dataset.bulkSelected = String(selected); };
        check.onclick = () => { if (bulkBrand.selected.has(g.id)) bulkBrand.selected.delete(g.id); else bulkBrand.selected.add(g.id); paint(); renderBulkBrand(); };
        paint(); visual.append(check);
      } else visual.append(favorite, edit, add);
      if (g.demo) visual.append(node('span', 'demo-badge', 'DEMO'));
      const heading = node('h3', 'garment-name'), title = node('button', 'garment-title', g.name);
      title.type = 'button'; title.setAttribute('aria-label', '查看藏品档案：' + g.name); title.onclick = () => openArchive(g.id); heading.append(title);
      card.append(visual, heading);
      if (g.brand) card.append(node('p', 'garment-brand', g.brand));
      const meta = node('div', 'garment-meta'); meta.append(node('span', '', [g.subcategory || C.categoryLabel(g.category), g.size].filter(Boolean).join(' · '))); card.append(meta);
      if (g.mainColor || g.color) {
        const color = K.COLORS.find(c => c.id === g.mainColor), originalColor = (g.color || '').trim();
        const shortLabel = K.label(g.mainColor);
        const colorName = g.mainColor ? (['multi', 'unknown'].includes(g.mainColor) || shortLabel.endsWith('色') ? shortLabel : shortLabel + '色') : originalColor;
        const detail = g.mainColor && originalColor && originalColor !== colorName && originalColor !== shortLabel ? ' · ' + originalColor : '';
        const colorRow = node('p', 'garment-color-label'), dot = node('span', 'color-dot garment-color-dot');
        dot.dataset.color = color?.id || 'unknown'; dot.setAttribute('aria-hidden', 'true'); if (color?.hex) dot.style.backgroundColor = color.hex;
        colorRow.append(dot, node('span', '', colorName + detail)); card.append(colorRow);
      }
      const price = C.formatPrice(g), original = C.formatPrice(g, 'originalPrice');
      if (price || original || g.purchaseStatus === 'wishlist' || g.purchaseCondition || g.purchaseType) {
        const purchase = node('div', 'garment-purchase');
        if (price) purchase.append(node('span', 'garment-price', '实付 ' + price));
        if (original) purchase.append(node('span', 'garment-original', '原价 ' + original));
        purchase.append(node('span', 'purchase-badge', C.PURCHASE_STATUSES[g.purchaseStatus] || '已购入')); card.append(purchase);
        if (g.purchaseCondition) purchase.append(node('span', 'purchase-badge', C.PURCHASE_CONDITIONS[g.purchaseCondition]));
        if (g.purchaseType) purchase.append(node('span', 'purchase-badge', C.PURCHASE_TYPES[g.purchaseType]));
      }
      grid.append(card);
    }
    if (items.length && !bulkBrand.active) {
      const tile = node('button', 'upload-tile'); tile.type = 'button'; tile.append(icon('plus'), node('span', '', '放进衣橱')); tile.onclick = pickFiles; grid.append(tile);
    }
    if (state.view === 'book') archiveBook?.render(state.garments);
    $('remove-demo').hidden = !state.garments.some(g => g.demo); cleanupUrls();
    renderBulkBrand();
    if (state.ready && requestedArchive && garment(requestedArchive)) {
      const id = requestedArchive; requestedArchive = null; openArchive(id);
    }
  }
  function setView(value) {
    if (value !== 'closet' && bulkBrand.active) finishBulkBrand();
    state.view = value; $('workspace').hidden = value !== 'closet'; $('outfits-view').hidden = value !== 'outfits'; $('book-view').hidden = value !== 'book';
    for (const b of document.querySelectorAll('[data-view]')) { b.classList.toggle('active', b.dataset.view === value); if (b.dataset.view === value) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    if (value === 'outfits') renderOutfits();
    if (value === 'book') archiveBook?.render(state.garments);
  }
  function layerStyle(el, l, g) {
    el.style.left = (l.x / C.WIDTH * 100) + '%'; el.style.top = (l.y / C.HEIGHT * 100) + '%';
    el.style.width = (l.w / C.WIDTH * 100) + '%'; el.style.height = (l.w / g.aspect / C.HEIGHT * 100) + '%';
    el.style.transform = 'rotate(' + l.rotation + 'deg)'; el.querySelector('img').style.transform = l.flip ? 'scaleX(-1)' : '';
  }
  function renderBoard() {
    const focusId = document.activeElement?.dataset?.layerId;
    $('board-layers').replaceChildren(); $('outfit-board').style.backgroundColor = state.background;
    $('outfit-board').style.setProperty('--board-ink', C.boardInk(state.background));
    state.layers = state.layers.filter(l => garment(l.garmentId));
    state.layers.forEach((l, index) => {
      const g = garment(l.garmentId), el = node('div', 'board-layer' + (l.id === state.selected ? ' selected' : ''));
      el.dataset.layerId = l.id; el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', g.name + '，拖动调整位置'); el.style.zIndex = index + 1;
      const img = node('img'); img.alt = ''; img.draggable = false; el.append(img); showAsset(img, g, 'image');
      const handle = node('span', 'resize-handle'); handle.setAttribute('aria-hidden', 'true'); handle.dataset.resize = 'true'; el.append(handle);
      layerStyle(el, l, g); $('board-layers').append(el);
    });
    $('board-empty').hidden = state.layers.length > 0; $('layer-count').textContent = state.layers.length + ' 件';
    $('export-look').disabled = $('save-outfit').disabled = !state.layers.length;
    $('arrange-board').disabled = !state.layers.length; $('undo').disabled = !state.history.length;
    $('save-outfit-label').textContent = state.activeId ? '更新搭配' : '保存搭配';
    for (const b of $('background-options').children) b.setAttribute('aria-pressed', String(b.dataset.color === state.background));
    renderLayerEditor();
    if (focusId) $('board-layers').querySelector('[data-layer-id="' + focusId + '"]')?.focus({ preventScroll: true });
  }
  function renderLayerEditor() {
    const l = selected(), g = l && garment(l.garmentId); $('layer-editor').hidden = !g;
    if (!g) return;
    $('selected-name').textContent = g.name; $('layer-size').value = l.w; $('layer-rotation').value = l.rotation;
    $('size-output').textContent = Math.round(l.w / C.WIDTH * 100) + '%'; $('rotation-output').textContent = Math.round(l.rotation) + '°';
  }
  function selectLayer(id) {
    state.selected = id;
    for (const e of $('board-layers').children) e.classList.toggle('selected', e.dataset.layerId === id);
    renderLayerEditor();
  }
  function addLayer(gid) {
    if (!state.ready) return toast('衣橱还在打开，请稍等。');
    if (state.layers.length >= 40) return toast('一套搭配最多放 40 件单品。');
    const g = garment(gid); if (!g) return;
    pushHistory(); const same = state.layers.filter(l => garment(l.garmentId)?.category === g.category).length;
    const l = C.positionLayer(C.defaultLayer(g, same), g.aspect); state.layers.push(l); state.selected = l.id;
    setView('closet'); renderBoard(); saveDraft(); toast('已加入搭配：' + g.name);
  }
  function removeLayer() {
    if (!selected()) return; pushHistory(); state.layers = state.layers.filter(l => l.id !== state.selected); state.selected = null; renderBoard(); saveDraft();
  }
  function arrange() {
    if (!state.layers.length) return; pushHistory(); const counts = {};
    state.layers = state.layers.map(l => { const g = garment(l.garmentId), n = counts[g.category] || 0; counts[g.category] = n + 1; return { ...C.positionLayer(C.defaultLayer(g, n), g.aspect), id: l.id }; });
    renderBoard(); saveDraft();
  }
  function newOutfit() {
    pushHistory(); state.layers = []; state.activeId = null; state.selected = null; $('outfit-name').value = '';
    setView('closet'); renderBoard(); saveDraft();
  }
  function renderOutfits() {
    $('nav-outfit-count').textContent = $('outfit-count').textContent = state.outfits.length;
    $('outfit-grid').replaceChildren(); $('outfits-empty').hidden = state.outfits.length > 0;
    for (const o of [...state.outfits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      const card = node('article', 'outfit-card'), preview = node('button', 'outfit-preview'); preview.type = 'button'; preview.setAttribute('aria-label', '打开搭配：' + o.name); preview.style.backgroundColor = o.background;
      preview.style.setProperty('--board-ink', C.boardInk(o.background));
      for (const l of o.layers) {
        const g = garment(l.garmentId); if (!g) continue;
        const img = node('img'); img.alt = ''; img.draggable = false; showAsset(img, g, 'thumb');
        img.style.left = l.x / 8 + '%'; img.style.top = l.y / 10 + '%'; img.style.width = l.w / 8 + '%';
        img.style.height = l.w / g.aspect / 10 + '%'; img.style.transform = 'rotate(' + l.rotation + 'deg)' + (l.flip ? ' scaleX(-1)' : ''); preview.append(img);
      }
      preview.append(node('span', 'board-signature', 'A LOOK TO LOVE'));
      preview.onclick = () => {
        pushHistory(); applySnapshot({ ...o, activeId: o.id }); setView('closet');
        $('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('已打开搭配，可继续修改。');
      };
      card.append(preview, node('h3', 'outfit-title', o.name), node('p', 'outfit-caption', o.layers.length + ' 件单品 · ' + formatDate(o.updatedAt)));
      const actions = node('div', 'outfit-card-actions');
      const download = node('button', 'text-button'); download.type = 'button'; download.append(icon('download'), document.createTextNode('导出图片')); download.onclick = () => exportLook(o).catch(report);
      const del = action('删除搭配：' + o.name, 'trash', 'icon-button danger-text');
      listen(del, 'click', async () => {
        if (!await confirmAction('删除这套搭配？', '只删除搭配记录，衣橱里的单品会保留。', '删除搭配')) return;
        await work('正在更新搭配手册…', async () => {
          await DB.write([{ store: 'outfits', type: 'delete', id: o.id }]); state.outfits = state.outfits.filter(x => x.id !== o.id);
          if (state.activeId === o.id) { state.activeId = null; await saveDraft(); renderBoard(); }
          renderOutfits(); toast('搭配已删除，衣服仍在衣橱里。');
        });
      });
      actions.append(download, del); card.append(actions); $('outfit-grid').append(card);
    }
  }
  function formatDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }); }
  async function saveOutfit() {
    if (!state.layers.length) return;
    await work('正在保存这套喜欢…', async () => {
      const now = new Date().toISOString(), old = state.outfits.find(o => o.id === state.activeId);
      const o = { id: old?.id || C.id('o'), name: $('outfit-name').value.trim() || '我的搭配 ' + String(state.outfits.length + 1).padStart(3, '0'),
        layers: state.layers.map(l => ({ ...l })), background: state.background, notes: old?.notes || '', createdAt: old?.createdAt || now, updatedAt: now };
      await DB.write([{ store: 'outfits', value: o }]);
      state.outfits = old ? state.outfits.map(x => x.id === o.id ? o : x) : [...state.outfits, o]; state.activeId = o.id; $('outfit-name').value = o.name;
      await saveDraft(); renderOutfits(); renderBoard(); toast(old ? '搭配已更新。' : '已收进搭配手册。');
    });
  }
  function safeFilename(value) { return (value || 'wardrobe').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 90); }
  async function exportLook(outfit) {
    const o = outfit || { layers: state.layers.map(l => ({ ...l })), background: state.background, name: $('outfit-name').value || '我的搭配' };
    if (!o.layers.length) return toast('先选几件衣服放进搭配画布吧。');
    await work('正在准备搭配图片…', async () => {
      const c = I.canvas(1600, 2000), ctx = c.getContext('2d'); ctx.scale(2, 2); ctx.fillStyle = o.background; ctx.fillRect(0, 0, C.WIDTH, C.HEIGHT);
      for (const l of o.layers) {
        const g = garment(l.garmentId); if (!g) continue;
        const img = await I.load(await ensureAsset(g, 'image')), h = l.w / g.aspect;
        ctx.save(); ctx.translate(l.x + l.w / 2, l.y + h / 2); ctx.rotate(l.rotation * Math.PI / 180); if (l.flip) ctx.scale(-1, 1);
        ctx.drawImage(img, -l.w / 2, -h / 2, l.w, h); ctx.restore();
      }
      ctx.fillStyle = C.boardInk(o.background); ctx.font = '10px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('A LOOK TO LOVE', C.WIDTH / 2, C.HEIGHT - 28);
      I.download(await I.blob(c), safeFilename(o.name) + '.png'); toast('搭配图片已准备好，请查看下载。');
    });
  }
  function pickFiles() { if (!state.ready) return toast('衣橱尚未打开，请稍等或刷新页面。'); if (!processing && !busy) $('file-input').click(); }
  function stageName(g) { return C.defaultName(g.category, g.sequence); }
  function renderStaged() {
    $('upload-list').replaceChildren();
    for (const g of staged) {
      const row = node('div', 'upload-row'), img = node('img', 'upload-thumb'); img.src = url(g.thumb); img.alt = '待上传单品预览';
      const info = node('div', 'upload-info'), name = node('input'); name.type = 'text'; name.maxLength = 100; name.value = g.name; name.placeholder = stageName(g); name.setAttribute('aria-label', '单品名称，选填'); name.oninput = () => { g.name = name.value; };
      info.append(name, node('p', 'upload-filename', g.filename));
      const colorLabel = node('label', 'upload-color'), color = node('select'); colorSelect(color, g.mainColor); color.setAttribute('aria-label', '主色分类，可修改自动建议'); color.onchange = () => { g.mainColor = color.value; g.colorSource = 'manual'; };
      colorLabel.append(node('span', '', '建议主色'), color); info.append(colorLabel);
      const brandGroup = node('div', 'upload-brand'), brandSelect = node('select'), brandInput = node('input');
      brandSelect.setAttribute('aria-label', '选择品牌'); brandInput.type = 'text'; brandInput.maxLength = 100;
      brandInput.placeholder = '或输入其他品牌'; brandInput.setAttribute('aria-label', '手动输入品牌'); brandInput.setAttribute('list', 'brand-suggestions');
      bindBrandChoice(brandSelect, brandInput, g.brand, value => { g.brand = value; });
      brandGroup.append(node('span', 'upload-brand-label', '品牌'), brandSelect, brandInput); info.append(brandGroup);
      const cat = node('select'); categorySelect(cat); cat.value = g.category; cat.setAttribute('aria-label', '选择单品分类'); cat.onchange = () => { g.category = cat.value; name.placeholder = stageName(g); };
      const del = action('移除这张待上传图片', 'close'); del.onclick = () => { staged = staged.filter(x => x.id !== g.id); renderStaged(); cleanupUrls(); };
      row.append(img, info, cat, del); $('upload-list').append(row);
    }
    $('confirm-upload').textContent = staged.length ? '保存 ' + staged.length + ' 件到衣橱' : '保存到衣橱'; $('confirm-upload').disabled = processing || !staged.length;
  }
  async function uploadFiles(files) {
    if (!files.length || processing) return;
    if (files.length > 100) { toast('一次最多选 100 张，分批加入会更顺畅。', true); return; }
    processing = true; if (!$('upload-dialog').open) $('upload-dialog').showModal();
    $('pick-more').disabled = $('confirm-upload').disabled = true;
    $('upload-errors').hidden = true; const errors = [];
    try {
      for (let i = 0; i < files.length; i++) {
        $('upload-progress').textContent = '正在整理 ' + (i + 1) + ' / ' + files.length + '…';
        try {
          const prepared = await I.prepare(files[i]), cat = $('batch-category').value;
          let suggestion; try { suggestion = await colorSuggestion(prepared.thumb || prepared.image); } catch { suggestion = { mainColor: 'unknown', colorSource: 'auto' }; }
          staged.push({ id: C.id(), ...prepared, ...suggestion, name: '', category: cat === 'auto' ? C.suggestCategory(files[i].name) : cat,
            sequence: state.garments.length + staged.length + 1, filename: files[i].name });
        } catch (error) { errors.push(files[i].name + '：' + error.message); }
      }
    } finally {
      processing = false; $('pick-more').disabled = false;
      $('upload-progress').textContent = staged.length ? staged.length + ' 件已准备好，检查后就能保存。' : '这次没有成功读取图片，请重新选择。';
      if (errors.length) { $('upload-errors').textContent = errors.join('\n'); $('upload-errors').hidden = false; }
      renderStaged();
    }
  }
  async function confirmUpload() {
    if (processing || !staged.length) return;
    await work('正在把喜欢的衣服收进衣橱…', async () => {
      const now = new Date().toISOString();
      const records = staged.map(g => ({ id: g.id, image: g.image, thumb: g.thumb, original: g.original, aspect: g.aspect,
        name: g.name.trim() || stageName(g), category: g.category, ...C.garmentDetails(g), favorite: false, demo: false, createdAt: now, updatedAt: now }));
      await DB.write(records.map(value => ({ store: 'garments', value })));
      state.garments.push(...records); const count = records.length; staged = [];
      state.category = 'all'; state.brand = ''; state.colors = []; state.favorites = false; state.query = ''; $('search').value = '';
      $('upload-dialog').close(); renderCloset(); toast(count + ' 件衣服已放进衣橱。');
    });
  }
  function openEdit(id) {
    const g = garment(id); if (!g) return;
    editingFromBook = false;
    if ($('archive-dialog').open) $('archive-dialog').close();
    editing = { ...g, ...C.garmentDetails(g) };
    $('edit-error').hidden = true; $('edit-error').textContent = '';
    $('edit-image').removeAttribute('src'); showAsset($('edit-image'), editing, 'image'); $('edit-name').value = g.name;
    $('edit-category').value = g.category;
    for (const [field, inputId] of Object.entries(detailInputs)) $(inputId).value = editing[field] ?? '';
    bindBrandChoice($('edit-brand-choice'), $('edit-brand'), editing.brand);
    for (const [field, inputId] of Object.entries(archiveInputs)) $(inputId).value = editing.archive?.[field] ?? (field === 'verification' ? 'pending' : '');
    colorSelect($('edit-main-color'), editing.mainColor); $('edit-main-color-note').textContent = editing.colorSource === 'auto' ? '来自图片的建议，可手动修改。' : editing.mainColor ? '已手动选择。' : '尚未分析，可点击重新建议。';
    renderArchivePhotoEditors();
    $('edit-dialog').showModal();
  }
  async function saveEdit(e) {
    e.preventDefault(); if (!editing) return;
    const button = $('edit-save'), errorBox = $('edit-error');
    errorBox.hidden = true; errorBox.textContent = '';
    try {
      if (busy) throw new Error('上一项操作仍在进行，请稍等完成后再保存。');
      button.disabled = true; button.textContent = '正在保存…';
      for (const [id, label] of [['edit-price', '实际购入价'], ['edit-original-price', '原价'], ['edit-date', '购入日期']]) {
        if ($(id).validity?.badInput) throw new Error(label + '的格式无效，请修改或留空。');
      }
      const record = editing;
      const details = C.garmentDetails(Object.fromEntries(Object.entries(detailInputs).map(([field, inputId]) => [field, $(inputId).value])));
      const archive = C.archiveDetails({ ...Object.fromEntries(Object.entries(archiveInputs).map(([field, inputId]) => [field, $(inputId).value])), photos: record.archive?.photos || [] });
      const hasArchive = archive.photos.length || ['year', 'season', 'collection', 'look', 'relation', 'story', 'sourceUrl'].some(field => archive[field]);
      let savedId;
      await work('正在保存单品…', async () => {
        await cacheWriteChain.catch(() => {});
        const value = { ...record, name: $('edit-name').value.trim() || C.defaultName($('edit-category').value, state.garments.findIndex(g => g.id === record.id) + 1, $('edit-color').value),
          category: $('edit-category').value, ...details, updatedAt: new Date().toISOString() };
        if (hasArchive) value.archive = archive; else delete value.archive;
        await DB.write([{ store: 'garments', value }]); state.garments = state.garments.map(g => g.id === value.id ? value : g); savedId = value.id;
      });
      const returnToBook = editingFromBook;
      $('edit-dialog').close(); editing = null; renderCloset(); renderBoard(); renderOutfits();
      if (returnToBook) archiveBook?.open(savedId); else openArchive(savedId);
      toast('档案已保存到本机。连接 GitHub 后会继续同步。');
    } catch (error) {
      errorBox.textContent = error?.message || '本次保存未完成，请重试。'; errorBox.hidden = false;
      errorBox.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); throw error;
    } finally { button.disabled = false; button.textContent = '保存档案'; }
  }
  function addArchiveFact(container, label, value) {
    if (value === undefined || value === null || value === '') return;
    const pair = node('div'); pair.append(node('dt', '', label), node('dd', '', String(value))); $(container).append(pair);
  }
  function appendSource(parent, value) {
    if (!value) return;
    const source = C.sourceUrl(value);
    if (!source.startsWith('https://')) { parent.append(node('p', 'archive-source-note', source)); return; }
    const a = node('a', 'archive-source', '查看资料来源 ↗'); a.href = source; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a);
  }
  function openArchive(id) {
    const g = garment(id); if (!g) return; viewed = g;
    const a = C.archiveDetails(g.archive) || {};
    $('archive-brand').textContent = g.brand || 'MY COLLECTION'; $('archive-title').textContent = g.name;
    $('archive-subtitle').textContent = [a.year, a.season ? C.SEASONS[a.season] : '', a.collection].filter(Boolean).join(' · ') || C.categoryLabel(g.category);
    $('archive-gallery').replaceChildren(); $('archive-facts').replaceChildren(); $('archive-purchase').replaceChildren(); $('archive-reference').replaceChildren();
    const photos = [...(a.photos || [])].sort((x, y) => (y.kind === 'runway') - (x.kind === 'runway'));
    for (const p of [{ field: 'image', label: 'MY PIECE / 我的藏品', caption: '', sourceUrl: '' }, ...photos.map(p => ({ ...p, field: 'photo_' + p.id, label: C.PHOTO_KINDS[p.kind] }))]) {
      const figure = node('figure', 'archive-photo'), img = node('img'); img.alt = p.label + '：' + g.name; img.loading = 'lazy'; showAsset(img, g, p.field);
      const caption = node('figcaption'); caption.append(node('strong', '', p.label)); if (p.caption) caption.append(node('p', '', p.caption)); appendSource(caption, p.sourceUrl);
      figure.append(img, caption); $('archive-gallery').append(figure);
    }
    $('archive-gallery').scrollLeft = 0; $('archive-gallery-tip').hidden = !photos.length;
    for (const [label, value] of [['年份', a.year], ['季节', a.season ? C.SEASONS[a.season] : ''], ['系列名称', a.collection], ['Look 编号', a.look], ['与秀场的关系', a.relation ? C.RELATIONS[a.relation] : '']]) addArchiveFact('archive-facts', label, value);
    const seriesRecorded = ['year', 'season', 'collection', 'look', 'relation', 'sourceUrl'].some(field => a[field]) || photos.some(p => p.kind === 'runway');
    if (seriesRecorded) addArchiveFact('archive-facts', '资料状态', a.verification === 'confirmed' ? '已确认' : '待确认');
    $('archive-unrecorded').hidden = seriesRecorded; appendSource($('archive-reference'), a.sourceUrl);
    $('archive-story-section').hidden = !a.story; $('archive-story-text').textContent = a.story || '';
    for (const [label, value] of [['分类', g.subcategory || C.categoryLabel(g.category)], ['尺码', g.size], ['颜色', g.color], ['款式', g.style], ['图案', g.pattern], ['状态', C.PURCHASE_STATUSES[g.purchaseStatus || 'owned']], ['实际购入价', C.formatPrice(g)], ['原价 / 吊牌价', C.formatPrice(g, 'originalPrice')], ['购入日期', g.purchaseDate], ['购买渠道', g.purchaseSource], ['全新 / 二手', g.purchaseCondition ? C.PURCHASE_CONDITIONS[g.purchaseCondition] : ''], ['购入方式', g.purchaseType ? C.PURCHASE_TYPES[g.purchaseType] : '']]) addArchiveFact('archive-purchase', label, value);
    $('archive-notes').textContent = g.notes || ''; $('archive-export-price').checked = false;
    renderCloudStatus();
    if (!$('archive-dialog').open) $('archive-dialog').showModal();
  }
  function refreshViewedArchive() {
    if (!viewed || !$('archive-dialog').open) return;
    const id = viewed.id, price = $('archive-export-price').checked, position = $('archive-gallery').scrollLeft;
    if (!garment(id)) { $('archive-dialog').close(); return; }
    openArchive(id); $('archive-export-price').checked = price; $('archive-gallery').scrollLeft = position;
  }
  function renderArchivePhotoEditors() {
    $('archive-photo-editors').replaceChildren();
    for (const p of editing?.archive?.photos || []) {
      const row = node('div', 'archive-photo-editor'), img = node('img'); img.alt = C.PHOTO_KINDS[p.kind]; showAsset(img, editing, 'photo_' + p.id); const fields = node('div');
      const kindLabel = node('label', '', '图片类型'), select = node('select'); select.setAttribute('aria-label', '附图类型');
      for (const [value, text] of Object.entries(C.PHOTO_KINDS)) { const option = node('option', '', text); option.value = value; select.append(option); }
      select.value = p.kind; select.addEventListener('change', e => { p.kind = e.target.value; }); kindLabel.append(select); fields.append(kindLabel);
      for (const [key, label, max] of [['caption', '图片说明', 200], ['sourceUrl', '图片来源（网址或说明）', 1200]]) {
        const wrapper = node('label', '', label), input = node('input'); input.type = 'text'; input.maxLength = max; input.value = p[key] || ''; input.setAttribute('aria-label', label);
        input.addEventListener('input', e => { p[key] = e.target.value; }); wrapper.append(input); fields.append(wrapper);
      }
      const remove = node('button', 'text-button danger-text', '移除此附图'); remove.type = 'button'; remove.onclick = () => {
        editing.archive.photos = editing.archive.photos.filter(x => x.id !== p.id); delete editing['photo_' + p.id]; renderArchivePhotoEditors(); cleanupUrls();
      };
      fields.append(remove); row.append(img, fields); $('archive-photo-editors').append(row);
    }
  }
  async function addArchivePhotos(files) {
    if (!editing || !files.length) return;
    if ((editing.archive?.photos.length || 0) + files.length > 12) throw new Error('每件藏品最多保存 12 张附图，请减少本次选图数量。');
    const target = editing;
    await work('正在整理藏品附图…', async () => {
      const prepared = [];
      for (const file of files) { const result = await I.prepare(file); prepared.push({ id: C.id('p'), image: result.image }); }
      if (editing !== target) return;
      target.archive ||= C.archiveDetails({});
      for (const p of prepared) { target.archive.photos.push({ id: p.id, kind: 'runway', caption: '', sourceUrl: '' }); target['photo_' + p.id] = p.image; }
      renderArchivePhotoEditors(); toast('附图已准备好，点击「保存档案」后保存。');
    });
  }
  async function exportArchive() {
    if (!viewed) return; const g = garment(viewed.id); if (!g) return;
    const includePrice = $('archive-export-price').checked;
    return exportMemorial(g, includePrice);
  }
  async function exportMemorial(g, includePrice) {
    if (!g) return;
    await work('正在制作藏品纪念卡…', async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const measureCanvas = I.canvas(1, 1), measureContext = measureCanvas.getContext('2d');
      const plan = window.WardrobeMemorial.layout(g, includePrice, (text, font) => { measureContext.font = font; return measureContext.measureText(text).width; });
      const pictures = [];
      for (const box of plan.images) pictures.push({ box, image: await I.load(await ensureAsset(g, box.field)) });
      const canvas = I.canvas(plan.width, plan.height), ctx = canvas.getContext('2d'); ctx.fillStyle = '#f8f7f3'; ctx.fillRect(0, 0, plan.width, plan.height);
      for (const { box, image } of pictures) {
        ctx.fillStyle = '#eef0eb'; ctx.fillRect(box.x, box.y, box.w, box.h);
        const ratio = Math.min((box.w - 36) / image.naturalWidth, (box.h - 36) / image.naturalHeight), width = image.naturalWidth * ratio, height = image.naturalHeight * ratio;
        ctx.drawImage(image, box.x + (box.w - width) / 2, box.y + (box.h - height) / 2, width, height);
      }
      ctx.textBaseline = 'top';
      for (const op of plan.ops) { ctx.font = op.font; ctx.fillStyle = op.color; ctx.fillText(op.text, op.x, op.y); }
      I.download(await I.blob(canvas), safeFilename((g.brand ? g.brand + '-' : '') + g.name) + '-藏品纪念卡.png'); toast('纪念卡已准备好，请查看下载或保存到文件。');
    });
  }
  async function deleteGarment() {
    if (!editing) return; const gid = editing.id, n = state.outfits.filter(o => o.layers.some(l => l.garmentId === gid)).length;
    if (!await confirmAction('删除这件衣服？', '这会删除本机保存的单品和图片。' + (n ? '它也会从 ' + n + ' 套已保存的搭配中移除。' : '删除前可先导出衣橱备份。'), '删除单品')) return;
    await removeGarments(new Set([gid])); $('edit-dialog').close(); editing = null; cleanupUrls(); toast('单品已删除。');
  }
  async function removeGarments(ids) {
    await work('正在整理衣橱…', async () => {
      await draftChain; clearTimeout(draftTimer);
      const outfits = state.outfits.map(o => ({ ...o, layers: o.layers.filter(l => !ids.has(l.garmentId)) }));
      const layers = state.layers.filter(l => !ids.has(l.garmentId));
      const operations = [...ids].map(id => ({ store: 'garments', type: 'delete', id }));
      for (const value of outfits) operations.push({ store: 'outfits', value });
      operations.push({ store: 'meta', value: draftRecord({ ...snap(), layers }) });
      await DB.write(operations); state.garments = state.garments.filter(g => !ids.has(g.id));
      state.outfits = outfits; state.layers = layers; state.selected = null; state.history = []; state.future = [];
      renderCloset(); renderBoard(); renderOutfits();
    });
  }
  async function backup() {
    await work('正在打包衣服和搭配，请稍等…', async () => {
      const garments = [];
      for (let i = 0; i < state.garments.length; i++) {
        $('busy-message').textContent = '正在备份衣服 ' + (i + 1) + ' / ' + state.garments.length + '…';
        const g = state.garments[i];
        const { cloudAssets, cloudOrigin, ...portable } = g;
        const images = {}; for (const field of C.imageFields(g)) images[field] = await I.dataUrl(await ensureAsset(g, field));
        garments.push({ ...portable, ...images });
      }
      const data = { app: 'wardrobe-studio', version: 2, exportedAt: new Date().toISOString(), garments,
        outfits: state.outfits.map(o => ({ ...o, layers: o.layers.map(l => ({ ...l })) })) };
      I.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'wardrobe-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      toast('备份已准备好，包含 ' + garments.length + ' 件衣服和 ' + state.outfits.length + ' 套已保存搭配。');
    });
  }
  async function restore(file) {
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) throw new Error('备份文件超过 500 MB，请使用桌面浏览器处理较小的备份。');
    await work('正在检查衣橱备份…', async () => {
      let input; try { input = JSON.parse(await file.text()); } catch { throw new Error('无法读取这个 JSON 备份文件。'); }
      const parsed = C.validateBackup(input), newGarments = [], newOutfits = [];
      const existingG = new Set(state.garments.map(g => g.id)), existingO = new Set(state.outfits.map(o => o.id));
      for (let i = 0; i < parsed.garments.length; i++) {
        const g = parsed.garments[i]; if (existingG.has(g.id)) continue;
        $('busy-message').textContent = '正在检查单品图片 ' + (i + 1) + ' / ' + parsed.garments.length + '…';
        const decoded = { ...g, ...Object.fromEntries(C.imageFields(g).map(field => [field, I.fromDataUrl(g[field])])) };
        try {
          for (const field of C.imageFields(g)) {
            const img = await I.load(decoded[field]);
            if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 60000000) throw new Error('图片尺寸无效');
          }
        } catch { throw new Error('备份中“' + g.name + '”的图片损坏，尚未导入任何记录。'); }
        newGarments.push(decoded);
      }
      for (const o of parsed.outfits) if (!existingO.has(o.id)) newOutfits.push(o);
      await DB.write([...newGarments.map(value => ({ store: 'garments', value })), ...newOutfits.map(value => ({ store: 'outfits', value }))]);
      state.garments.push(...newGarments); state.outfits.push(...newOutfits);
      renderCloset(); renderBoard(); renderOutfits(); $('backup-dialog').close();
      toast('已导入 ' + newGarments.length + ' 件衣服、' + newOutfits.length + ' 套搭配；已有记录已保留。');
    });
  }
  function bindBoard() {
    let drag = null;
    $('outfit-board').addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const el = e.target.closest('.board-layer');
      if (!el) { selectLayer(null); return; }
      const l = state.layers.find(x => x.id === el.dataset.layerId), g = l && garment(l.garmentId); if (!g) return;
      selectLayer(l.id); el.focus({ preventScroll: true }); e.preventDefault();
      const rect = $('outfit-board').getBoundingClientRect();
      drag = { pointer: e.pointerId, el, id: l.id, startX: e.clientX, startY: e.clientY,
        original: { ...l }, snapshot: snap(), scale: C.WIDTH / rect.width, resize: !!e.target.closest('[data-resize]'), moved: false };
      el.setPointerCapture(e.pointerId); $('outfit-board').classList.add('dragging');
    });
    $('outfit-board').addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const l = state.layers.find(x => x.id === drag.id), g = l && garment(l.garmentId); if (!g) return;
      const dx = (e.clientX - drag.startX) * drag.scale, dy = (e.clientY - drag.startY) * drag.scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      const value = drag.resize ? { ...l, w: C.clamp(drag.original.w + (dx + dy * g.aspect) / 2, 35, 760) } : { ...l, x: drag.original.x + dx, y: drag.original.y + dy };
      Object.assign(l, C.positionLayer(value, g.aspect)); layerStyle(drag.el, l, g); renderLayerEditor();
    });
    function stop(e) {
      if (!drag || e.pointerId !== drag.pointer) return;
      if (drag.moved) { pushHistory(drag.snapshot); saveDraft(); }
      if (drag.el.hasPointerCapture(e.pointerId)) drag.el.releasePointerCapture(e.pointerId);
      drag = null; $('outfit-board').classList.remove('dragging'); $('undo').disabled = !state.history.length;
    }
    $('outfit-board').addEventListener('pointerup', stop); $('outfit-board').addEventListener('pointercancel', stop);
    $('board-layers').addEventListener('focusin', e => { const el = e.target.closest('.board-layer'); if (el) selectLayer(el.dataset.layerId); });
    for (const [element, key] of [[$('layer-size'), 'w'], [$('layer-rotation'), 'rotation']]) {
      element.addEventListener('input', () => {
        const l = selected(); if (!l) return; if (!sliderStart) sliderStart = snap(); l[key] = Number(element.value);
        const g = garment(l.garmentId), el = $('board-layers').querySelector('[data-layer-id="' + l.id + '"]');
        if (el) layerStyle(el, l, g); renderLayerEditor();
      });
      element.addEventListener('change', () => { if (sliderStart) { pushHistory(sliderStart); sliderStart = null; saveDraft(); $('undo').disabled = false; } });
    }
    document.addEventListener('keydown', e => {
      if (document.querySelector('dialog[open]') || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey && state.future.length) { state.history.push(snap()); applySnapshot(state.future.pop()); } else if (!e.shiftKey) undo(); return;
      }
      const l = selected(); if (!l || state.view !== 'closet') return;
      if (e.key === 'Escape') { selectLayer(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer(); return; }
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (delta) { e.preventDefault(); pushHistory(); const step = e.shiftKey ? 15 : 3;
        Object.assign(l, C.positionLayer({ ...l, x: l.x + delta[0] * step, y: l.y + delta[1] * step }, garment(l.garmentId).aspect)); renderBoard(); saveDraft(); }
      if (e.key === ' ' || e.key === 'Enter') { const el = e.target.closest('.board-layer'); if (el) { e.preventDefault(); selectLayer(el.dataset.layerId); } }
    });
  }
  async function addDemo() {
    if (state.garments.some(g => g.demo)) return toast('示例衣服已经在衣橱里了。');
    if ($('help-dialog').open) $('help-dialog').close();
    await work('正在准备一个小小的示例衣橱…', async () => {
      const samples = window.WardrobeDemo, records = [], now = new Date().toISOString();
      for (const sample of samples) {
        const svg = new Blob([sample.svg], { type: 'image/svg+xml' }), img = await I.load(svg);
        const c = I.canvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0);
        const png = await I.blob(c), prepared = await I.prepare(png);
        records.push({ id: C.id(), ...prepared, ...C.garmentDetails(), name: sample.name, category: sample.category, color: sample.color,
          notes: '示例插画，可在使用小贴士中统一移除。', demo: true, favorite: false, createdAt: now, updatedAt: now });
      }
      await DB.write(records.map(value => ({ store: 'garments', value }))); state.garments.push(...records); renderCloset(); toast('示例衣橱准备好了，点 ＋ 开始搭配。');
    });
  }
  // Native dialogs keep keyboard focus inside the current task.
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => {
    if (b.dataset.close === 'upload-dialog' && processing) return toast('正在整理图片，请稍等。');
    $(b.dataset.close).close();
  });
  $('busy-overlay').addEventListener('cancel', e => e.preventDefault());
  $('upload-dialog').addEventListener('cancel', e => { if (processing) e.preventDefault(); });
  $('upload-dialog').addEventListener('close', () => { staged = []; $('upload-list').replaceChildren(); $('upload-errors').hidden = true; cleanupUrls(); });
  $('edit-dialog').addEventListener('close', () => { editing = null; cleanupUrls(); });
  $('archive-dialog').addEventListener('close', () => { viewed = null; cleanupUrls(); });
  $('cloud-dialog').addEventListener('close', () => { $('cloud-token').value = ''; });
  for (const b of document.querySelectorAll('[data-upload]')) b.onclick = pickFiles;
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  categorySelect($('batch-category'), true); categorySelect($('edit-category'));
  C.BACKGROUNDS.forEach((color, i) => {
    const b = node('button', 'swatch'); b.type = 'button'; b.style.backgroundColor = color; b.dataset.color = color;
    b.setAttribute('aria-label', ['奶油白背景', '浅雾蓝背景', '淡豆沙背景'][i]); b.setAttribute('aria-pressed', String(i === 0));
    b.onclick = () => { if (state.background !== color) { pushHistory(); state.background = color; renderBoard(); saveDraft(); } }; $('background-options').append(b);
  });
  listen('file-input', 'change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; return uploadFiles(files); });
  listen('pick-more', 'click', () => $('file-input').click());
  listen('confirm-upload', 'click', confirmUpload);
  listen('batch-category', 'change', () => { const value = $('batch-category').value;
    for (const g of staged) g.category = value === 'auto' ? C.suggestCategory(g.filename) : value; renderStaged(); });
  listen('search', 'input', e => { state.query = e.target.value.trim().toLowerCase(); renderCloset(); });
  listen('complete-colors', 'click', completeColors);
  listen('expand-colors', 'click', () => { state.colorExpanded = !state.colorExpanded; renderColorFilters(); });
  listen('color-scan-cancel', 'click', () => { colorScanCancelled = true; $('color-scan-cancel').textContent = '正在停止…'; });
  $('busy-overlay').addEventListener('cancel', e => { if (!$('color-scan-cancel').hidden) { e.preventDefault(); colorScanCancelled = true; } });
  listen('edit-main-color', 'change', () => { if (editing) { editing.mainColor = $('edit-main-color').value; editing.colorSource = 'manual'; $('edit-main-color-note').textContent = '已手动选择，保存档案后生效。'; } });
  listen('suggest-edit-color', 'click', async () => { if (!editing || busy) return; const target = editing; await work('正在建议主色…', async () => { let photo; try { photo = await ensureAsset(target, 'thumb'); } catch { photo = await ensureAsset(target, 'image'); } const suggestion = await colorSuggestion(photo); if (editing !== target) return; Object.assign(target, suggestion); colorSelect($('edit-main-color'), target.mainColor); $('edit-main-color-note').textContent = '已更新建议，保存档案后生效。'; }); });
  listen('bulk-brand-start', 'click', startBulkBrand);
  listen('cloud-sync-cancel', 'click', () => { cloud.cancelled = true; $('cloud-sync-cancel').disabled = true; $('busy-message').textContent = '正在停止等待，本机记录会保留…'; cloud.client?.cancelPending(); });
  listen('bulk-brand-finish', 'click', finishBulkBrand);
  listen('bulk-brand-apply', 'click', applyBulkBrand);
  listen('bulk-brand-undo', 'click', undoBulkBrand);
  listen('bulk-brand-clear', 'click', () => { bulkBrand.selected.clear(); renderCloset(); });
  listen('brand-filter', 'change', e => { state.brand = bulkBrand.active ? 'unbranded' : e.target.value; renderCloset(); });
  listen('sort', 'change', e => { state.sort = e.target.value; renderCloset(); });
  listen('favorite-filter', 'click', () => { state.favorites = !state.favorites; renderCloset(); });
  listen('reset-filters', 'click', () => { state.category = 'all'; state.brand = ''; state.colors = []; state.favorites = false; state.query = ''; $('search').value = ''; renderCloset(); });
  listen('undo', 'click', undo); listen('new-outfit', 'click', newOutfit); listen('outfits-new', 'click', newOutfit);
  listen('go-style', 'click', () => setView('closet')); listen('arrange-board', 'click', arrange);
  listen('remove-layer', 'click', removeLayer);
  listen('flip-layer', 'click', () => { const l = selected(); if (l) { pushHistory(); l.flip = !l.flip; renderBoard(); saveDraft(); } });
  listen('raise-layer', 'click', () => { const l = selected(); if (l) { pushHistory(); state.layers = [...state.layers.filter(x => x.id !== l.id), l]; renderBoard(); saveDraft(); } });
  listen('outfit-name', 'input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250); });
  listen('outfit-name', 'change', saveDraft); listen('save-outfit', 'click', saveOutfit); listen('export-look', 'click', () => exportLook());
  listen('open-backup', 'click', () => { if (state.ready) $('backup-dialog').showModal(); });
  listen('open-cloud', 'click', () => {
    $('cloud-owner').value = cloud.saved.config.owner; $('cloud-repo').value = cloud.saved.config.repo;
    $('cloud-auto').checked = cloud.auto; $('cloud-remember').checked = storedAuthorization()?.mode === 'device';
    renderCloudStatus(); $('cloud-dialog').showModal();
  });
  listen('cloud-form', 'submit', e => { e.preventDefault(); return connectCloud(); });
  listen('cloud-remember', 'change', e => {
    if (!cloud.authorization) return;
    const saved = saveAuthorization(cloud.authorization, e.target.checked ? 'device' : 'memory');
    if (!saved) { e.target.checked = storedAuthorization()?.mode === 'device'; return toast('浏览器未能更新授权保存设置，请使用普通浏览模式后重试。', true); }
    toast(e.target.checked ? '已记住此设备，下次打开自动连接。' : '已移除此设备保存的授权，本次连接仍可使用。');
  });
  listen('cloud-sync-now', 'click', () => syncCloud());
  listen('cloud-auto', 'change', async e => { cloud.auto = e.target.checked; cloud.saved = { ...cloud.saved, auto: cloud.auto }; await localWrite([{ store: 'meta', value: cloud.saved }]); scheduleCloud(); });
  listen('cloud-disconnect', 'click', () => {
    cloud.client?.disconnect(); cloud.client = null; cloud.authorization = null; clearTimeout(cloud.timer); const cleared = saveAuthorization(null); $('cloud-token').value = ''; $('cloud-remember').checked = false;
    cloud.message = '已断开连接，本机缓存与云端记录均保留'; renderCloudStatus();
    if (!cleared) toast('连接已断开，但浏览器未能清除保存的授权；请在浏览器设置中清除此网站数据。', true);
  });
  listen('cloud-resolve', 'click', async () => {
    const choices = {}; for (const row of $('cloud-conflict-list').children) { const select = row.querySelector('select'); if (!select.value) return toast('请为每条冲突选择保留版本。', true); choices[select.dataset.key] = select.value; }
    const conflicts = cloud.conflict; $('cloud-conflict-dialog').close(); await syncCloud({ choices, conflicts });
  });
  listen('cloud-conflict-cancel', 'click', () => { $('cloud-conflict-dialog').close(); cloud.message = '同步已暂停，请处理不同设备的修改'; renderCloudStatus(); });
  listen('open-help', 'click', () => $('help-dialog').showModal());
  listen('export-backup', 'click', backup); listen('import-backup', 'click', () => $('restore-input').click());
  listen('restore-input', 'change', e => { const file = e.target.files?.[0]; e.target.value = ''; return restore(file); });
  listen('persistent-storage', 'click', async () => {
    if (!navigator.storage?.persist) return toast('这个浏览器没有提供存储保护，请定期导出备份。');
    const granted = await navigator.storage.persist(); toast(granted ? '已获得本机存储保护，仍建议定期备份。' : '浏览器暂未允许存储保护，请保留导出的备份。');
  });
  listen('edit-form', 'submit', saveEdit); listen('delete-garment', 'click', deleteGarment);
  listen('archive-edit', 'click', () => { if (viewed) openEdit(viewed.id); });
  listen('archive-style', 'click', () => { if (!viewed) return; const id = viewed.id; $('archive-dialog').close(); return addLayer(id); });
  listen('archive-export', 'click', exportArchive);
  listen('archive-add-photos', 'click', () => { if (editing && !busy) $('archive-files').click(); });
  listen('archive-files', 'change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; return addArchivePhotos(files); });
  listen('clean-background', 'click', async () => {
    if (!editing) return;
    await work('正在处理浅色背景，请检查衣服边缘…', async () => { await ensureAsset(editing, 'image'); await ensureAsset(editing, 'original'); const image = await I.removeLightBackground(editing); editing = { ...editing, ...image }; $('edit-image').src = url(editing.image); toast('背景处理完成。检查后保存，也可以恢复原图。'); });
  });
  listen('restore-original', 'click', async () => {
    if (!editing) return;
    await work('正在恢复原图…', async () => { editing = { ...editing, ...await I.prepare(await ensureAsset(editing, 'original')) }; $('edit-image').src = url(editing.image); toast('已恢复原图预览，保存后生效。'); });
  });
  listen('download-original', 'click', async () => { if (editing) { const original = await ensureAsset(editing, 'original'), ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }[original.type] || 'png'; I.download(original, safeFilename(editing.name) + '-original.' + ext); } });
  listen('load-demo', 'click', addDemo); listen('help-demo', 'click', addDemo);
  listen('remove-demo', 'click', async () => {
    if (!await confirmAction('移除所有示例衣服？', '示例衣服也会从搭配中移除，你自己上传的衣服会保留。', '移除示例')) return;
    await removeGarments(new Set(state.garments.filter(g => g.demo).map(g => g.id))); toast('示例衣服已移除。');
  });
  archiveBook = window.WardrobeArchiveBook?.create({ document, showAsset,
    onEdit: id => { openEdit(id); editingFromBook = true; },
    onStyle: id => addLayer(id),
    onExport: (id, includePrice) => exportMemorial(garment(id), includePrice).catch(report),
    onUpload: pickFiles });
  bindBoard();
  try {
    await DB.open(); const results = await Promise.all([DB.read('garments'), DB.read('outfits'), DB.read('meta')]);
    state.garments = results[0].map(g => ({ ...g, ...C.garmentDetails(g) })); state.outfits = results[1]; state.ready = true;
    const checkpoint = results[2].find(v => v.id === 'github-sync');
    if (checkpoint?.config?.owner && checkpoint.config.repo) { cloud.saved = checkpoint; cloud.auto = checkpoint.auto !== false; }
    // An atomic clean checkpoint proves these exact in-memory cache objects came
    // from the saved cloud version. A dirty or replaced image is never trusted.
    if (checkpoint?.dirty === false && checkpoint.base?.garments) for (const g of state.garments) {
      const remote = checkpoint.base.garments.find(value => value.id === g.id);
      if (g.cloudOrigin !== (checkpoint.config.owner + '/' + checkpoint.config.repo).toLowerCase()) continue;
      for (const field of C.imageFields(g)) if (g.cloudAssets?.[field]?.sha && remote?.assets?.[field]?.sha === g.cloudAssets[field].sha) trustImage(g, field);
    }
    const draft = results[2].find(v => v.id === 'draft');
    if (draft && Array.isArray(draft.layers)) applySnapshot(draft); else renderBoard();
    renderCloset(); renderOutfits(); renderCloudStatus();
    const initialView = window.location?.search ? new URLSearchParams(window.location.search).get('view') : null;
    if (['closet', 'outfits', 'book'].includes(initialView)) setView(initialView);
    const remembered = storedAuthorization();
    if (remembered && Cloud) setTimeout(() => connectCloud(remembered).catch(report), 0);
  } catch (error) {
    $('storage-status').textContent = '无法打开本机衣橱'; renderCloset(); renderBoard(); report(error);
    for (const b of document.querySelectorAll('[data-upload]')) b.disabled = true;
  }
  function restorePageImages() {
    if (!state.ready) return;
    renderCloset(); renderBoard(); renderOutfits();
    refreshViewedArchive();
    if (editing) showAsset($('edit-image'), editing, 'image');
  }
  // A hidden page can remain alive in Safari's page cache. Keep its image URLs valid;
  // unused images are still released by cleanupUrls, and document teardown releases the rest.
  window.addEventListener('pageshow', restorePageImages);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') restorePageImages(); });
})();
