(async function () {
  'use strict';
  const C = window.WardrobeCore, DB = window.WardrobeStorage, I = window.WardrobeImages;
  const $ = id => document.getElementById(id);
  const state = { garments: [], outfits: [], layers: [], background: C.BACKGROUNDS[0],
    activeId: null, selected: null, category: 'all', favorites: false, query: '', sort: 'newest',
    view: 'closet', history: [], future: [], ready: false };
  let staged = [], editing = null, processing = false, busy = false, toastTimer, draftTimer;
  let draftChain = Promise.resolve(), sliderStart = null;
  const urls = new Map();
  function url(blob) { if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); }
  function cleanupUrls() {
    const used = new Set();
    for (const g of [...state.garments, ...staged, ...(editing ? [editing] : [])]) for (const k of ['image', 'thumb', 'original']) if (g[k]) used.add(g[k]);
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
    $('toast').style.background = error ? '#5b3b3b' : ''; toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3200);
  }
  function report(error) { console.error(error); toast(error?.message || '这次操作没有完成，请重试。', true); }
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
      $('storage-status').textContent = '照片与搭配保存在此浏览器';
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
  function renderCloset() {
    renderTabs(); $('garment-count').textContent = state.garments.length;
    $('favorite-filter').setAttribute('aria-pressed', String(state.favorites));
    let items = state.garments.filter(g => (state.category === 'all' || state.category === g.category) &&
      (!state.favorites || g.favorite) && (!state.query || [g.name, g.color, g.notes, C.categoryLabel(g.category)].join(' ').toLowerCase().includes(state.query)));
    items.sort((a, b) => state.sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : state.sort === 'category' ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name, 'zh-CN') : b.createdAt.localeCompare(a.createdAt));
    const grid = $('garment-grid'); grid.replaceChildren();
    const allEmpty = state.garments.length === 0;
    $('closet-empty').hidden = !allEmpty; $('no-results').hidden = allEmpty || items.length > 0;
    grid.hidden = allEmpty || items.length === 0; $('closet-tip').hidden = allEmpty || !items.length;
    const filtering = state.category !== 'all' || state.favorites || state.query;
    $('filter-summary').hidden = !filtering || allEmpty;
    $('filter-summary').textContent = '找到 ' + items.length + ' 件单品';
    for (const g of items) {
      const card = node('article', 'garment-card'); card.dataset.garmentId = g.id;
      const visual = node('div', 'garment-visual');
      const imageButton = node('button', 'garment-image-button'); imageButton.type = 'button';
      imageButton.setAttribute('aria-label', '把' + g.name + '加入搭配'); imageButton.onclick = () => addLayer(g.id);
      const img = node('img'); img.src = url(g.thumb); img.alt = g.name; img.loading = 'lazy'; img.draggable = false; imageButton.append(img);
      const favorite = action(g.favorite ? '取消收藏' : '收藏单品', 'heart', 'icon-button card-favorite'); favorite.setAttribute('aria-pressed', String(g.favorite));
      favorite.onclick = async () => {
        favorite.disabled = true;
        try { const updated = { ...g, favorite: !g.favorite }; await DB.write([{ store: 'garments', value: updated }]); state.garments = state.garments.map(x => x.id === g.id ? updated : x); renderCloset(); }
        catch (error) { favorite.disabled = false; report(error); }
      };
      const edit = action('编辑' + g.name, 'edit', 'icon-button card-edit'); edit.onclick = () => openEdit(g.id);
      const add = action('加入搭配：' + g.name, 'plus', 'card-add'); add.onclick = () => addLayer(g.id);
      visual.append(imageButton, favorite, edit, add); if (g.demo) visual.append(node('span', 'demo-badge', 'DEMO'));
      card.append(visual, node('h3', 'garment-name', g.name));
      const meta = node('div', 'garment-meta'); meta.append(node('span', 'color-dot'), node('span', '', C.categoryLabel(g.category) + (g.color ? ' · ' + g.color : ''))); card.append(meta); grid.append(card);
    }
    if (items.length) {
      const tile = node('button', 'upload-tile'); tile.type = 'button'; tile.append(icon('plus'), node('span', '', '放进衣橱')); tile.onclick = pickFiles; grid.append(tile);
    }
    $('remove-demo').hidden = !state.garments.some(g => g.demo); cleanupUrls();
  }
  function setView(value) {
    state.view = value; $('workspace').hidden = value !== 'closet'; $('outfits-view').hidden = value !== 'outfits';
    for (const b of document.querySelectorAll('[data-view]')) { b.classList.toggle('active', b.dataset.view === value); if (b.dataset.view === value) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    if (value === 'outfits') renderOutfits();
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
      const img = node('img'); img.src = url(g.image); img.alt = ''; img.draggable = false; el.append(img);
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
        const img = node('img'); img.src = url(g.thumb); img.alt = ''; img.draggable = false;
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
        const img = await I.load(g.image), h = l.w / g.aspect;
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
      const info = node('div'), name = node('input'); name.type = 'text'; name.maxLength = 100; name.value = g.name; name.placeholder = stageName(g); name.setAttribute('aria-label', '单品名称，选填'); name.oninput = () => { g.name = name.value; };
      info.append(name, node('p', 'upload-filename', g.filename));
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
          staged.push({ id: C.id(), ...prepared, name: '', category: cat === 'auto' ? C.suggestCategory(files[i].name) : cat,
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
        name: g.name.trim() || stageName(g), category: g.category, color: '', notes: '', favorite: false, demo: false, createdAt: now, updatedAt: now }));
      await DB.write(records.map(value => ({ store: 'garments', value })));
      state.garments.push(...records); const count = records.length; staged = [];
      state.category = 'all'; state.favorites = false; state.query = ''; $('search').value = '';
      $('upload-dialog').close(); renderCloset(); toast(count + ' 件衣服已放进衣橱。');
    });
  }
  function openEdit(id) {
    const g = garment(id); if (!g) return; editing = { ...g };
    $('edit-image').src = url(editing.image); $('edit-name').value = g.name;
    $('edit-category').value = g.category; $('edit-color').value = g.color; $('edit-notes').value = g.notes;
    $('edit-dialog').showModal();
  }
  async function saveEdit(e) {
    e.preventDefault(); if (!editing) return;
    await work('正在保存单品…', async () => {
      const value = { ...editing, name: $('edit-name').value.trim() || C.defaultName($('edit-category').value, state.garments.findIndex(g => g.id === editing.id) + 1, $('edit-color').value),
        category: $('edit-category').value, color: $('edit-color').value.trim(), notes: $('edit-notes').value.trim(), updatedAt: new Date().toISOString() };
      await DB.write([{ store: 'garments', value }]); state.garments = state.garments.map(g => g.id === value.id ? value : g);
      $('edit-dialog').close(); editing = null; renderCloset(); renderBoard(); renderOutfits(); toast('单品已更新。');
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
        garments.push({ ...g, image: await I.dataUrl(g.image), original: await I.dataUrl(g.original), thumb: await I.dataUrl(g.thumb) });
      }
      const data = { app: 'wardrobe-studio', version: 1, exportedAt: new Date().toISOString(), garments,
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
        const decoded = { ...g, image: I.fromDataUrl(g.image), original: I.fromDataUrl(g.original), thumb: I.fromDataUrl(g.thumb) };
        try {
          for (const field of ['image', 'original', 'thumb']) {
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
        records.push({ id: C.id(), ...prepared, name: sample.name, category: sample.category, color: sample.color,
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
  for (const b of document.querySelectorAll('[data-upload]')) b.onclick = pickFiles;
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  categorySelect($('batch-category'), true); categorySelect($('edit-category'));
  C.BACKGROUNDS.forEach((color, i) => {
    const b = node('button', 'swatch'); b.type = 'button'; b.style.backgroundColor = color; b.dataset.color = color;
    b.setAttribute('aria-label', ['奶油黄背景', '粉蓝背景', '深酒红背景'][i]); b.setAttribute('aria-pressed', String(i === 0));
    b.onclick = () => { if (state.background !== color) { pushHistory(); state.background = color; renderBoard(); saveDraft(); } }; $('background-options').append(b);
  });
  listen('file-input', 'change', e => { const files = Array.from(e.target.files || []); e.target.value = ''; return uploadFiles(files); });
  listen('pick-more', 'click', () => $('file-input').click());
  listen('confirm-upload', 'click', confirmUpload);
  listen('batch-category', 'change', () => { const value = $('batch-category').value;
    for (const g of staged) g.category = value === 'auto' ? C.suggestCategory(g.filename) : value; renderStaged(); });
  listen('search', 'input', e => { state.query = e.target.value.trim().toLowerCase(); renderCloset(); });
  listen('sort', 'change', e => { state.sort = e.target.value; renderCloset(); });
  listen('favorite-filter', 'click', () => { state.favorites = !state.favorites; renderCloset(); });
  listen('reset-filters', 'click', () => { state.category = 'all'; state.favorites = false; state.query = ''; $('search').value = ''; renderCloset(); });
  listen('undo', 'click', undo); listen('new-outfit', 'click', newOutfit); listen('outfits-new', 'click', newOutfit);
  listen('go-style', 'click', () => setView('closet')); listen('arrange-board', 'click', arrange);
  listen('remove-layer', 'click', removeLayer);
  listen('flip-layer', 'click', () => { const l = selected(); if (l) { pushHistory(); l.flip = !l.flip; renderBoard(); saveDraft(); } });
  listen('raise-layer', 'click', () => { const l = selected(); if (l) { pushHistory(); state.layers = [...state.layers.filter(x => x.id !== l.id), l]; renderBoard(); saveDraft(); } });
  listen('outfit-name', 'input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 250); });
  listen('outfit-name', 'change', saveDraft); listen('save-outfit', 'click', saveOutfit); listen('export-look', 'click', () => exportLook());
  listen('open-backup', 'click', () => { if (state.ready) $('backup-dialog').showModal(); });
  listen('open-help', 'click', () => $('help-dialog').showModal());
  listen('export-backup', 'click', backup); listen('import-backup', 'click', () => $('restore-input').click());
  listen('restore-input', 'change', e => { const file = e.target.files?.[0]; e.target.value = ''; return restore(file); });
  listen('persistent-storage', 'click', async () => {
    if (!navigator.storage?.persist) return toast('这个浏览器没有提供存储保护，请定期导出备份。');
    const granted = await navigator.storage.persist(); toast(granted ? '已获得本机存储保护，仍建议定期备份。' : '浏览器暂未允许存储保护，请保留导出的备份。');
  });
  listen('edit-form', 'submit', saveEdit); listen('delete-garment', 'click', deleteGarment);
  listen('clean-background', 'click', async () => {
    if (!editing) return;
    await work('正在处理浅色背景，请检查衣服边缘…', async () => { const image = await I.removeLightBackground(editing); editing = { ...editing, ...image }; $('edit-image').src = url(editing.image); toast('背景处理完成。检查后保存，也可以恢复原图。'); });
  });
  listen('restore-original', 'click', async () => {
    if (!editing) return;
    await work('正在恢复原图…', async () => { editing = { ...editing, ...await I.prepare(editing.original) }; $('edit-image').src = url(editing.image); toast('已恢复原图预览，保存后生效。'); });
  });
  listen('download-original', 'click', () => { if (editing) { const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }[editing.original.type] || 'png'; I.download(editing.original, safeFilename(editing.name) + '-original.' + ext); } });
  listen('load-demo', 'click', addDemo); listen('help-demo', 'click', addDemo);
  listen('remove-demo', 'click', async () => {
    if (!await confirmAction('移除所有示例衣服？', '示例衣服也会从搭配中移除，你自己上传的衣服会保留。', '移除示例')) return;
    await removeGarments(new Set(state.garments.filter(g => g.demo).map(g => g.id))); toast('示例衣服已移除。');
  });
  bindBoard();
  try {
    await DB.open(); const results = await Promise.all([DB.read('garments'), DB.read('outfits'), DB.read('meta')]);
    state.garments = results[0]; state.outfits = results[1]; state.ready = true;
    const draft = results[2].find(v => v.id === 'draft');
    if (draft && Array.isArray(draft.layers)) applySnapshot(draft); else renderBoard();
    renderCloset(); renderOutfits(); $('storage-status').textContent = '照片与搭配保存在此浏览器';
  } catch (error) {
    $('storage-status').textContent = '无法打开本机衣橱'; renderCloset(); renderBoard(); report(error);
    for (const b of document.querySelectorAll('[data-upload]')) b.disabled = true;
  }
  window.addEventListener('pagehide', () => { for (const value of urls.values()) URL.revokeObjectURL(value); });
  window.addEventListener('pageshow', e => { if (e.persisted) { urls.clear(); renderCloset(); renderBoard(); renderOutfits(); } });
})();
