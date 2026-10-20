(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.WardrobeArchiveBook = factory(root.WardrobeCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  function reference(g) { return g.id.replace(/^g_/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase(); }
  function series(g) {
    const a = g.archive || {};
    return [a.year, a.season ? C.SEASONS[a.season] : '', a.collection].filter(Boolean).join(' · ');
  }
  function select(records, { query = '', brand = '', filter = 'all' } = {}) {
    return records.filter(g => C.matchesBrand(g, brand) && (!query || C.matchesGarment(g, query)) &&
      (filter !== 'runway' || g.archive?.relation || g.archive?.photos?.some(p => p.kind === 'runway')) &&
      (filter !== 'story' || g.archive?.story)).sort((a, b) => (a.brand || '').localeCompare(b.brand || '', 'zh-CN') || (a.name || '').localeCompare(b.name || '', 'zh-CN') || a.id.localeCompare(b.id));
  }
  function create({ document, showAsset, onEdit, onStyle, onExport, onUpload }) {
    const $ = id => document.getElementById(id);
    const state = { records: [], query: '', brand: '', filter: 'all', selected: null, prices: false, directoryCollapsed: true, mode: 'wall' };
    const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = String(text); return el; };
    const button = (className, text, action) => { const el = node('button', className, text); el.type = 'button'; el.onclick = action; return el; };
    function setDirectory(collapsed) {
      state.directoryCollapsed = collapsed;
      $('book-index').hidden = collapsed; $('book-shell').dataset.directory = collapsed ? 'closed' : 'open';
      const toggle = $('book-directory-toggle'); toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? '展开目录 ›' : '‹ 收起目录';
      toggle.setAttribute('aria-label', collapsed ? '展开收录目录' : '收起收录目录');
    }
    function source(parent, value) {
      if (!value) return;
      let href; try { href = C.sourceUrl(value); } catch { href = ''; }
      if (!href.startsWith('https://')) { parent.append(node('p', 'book-source-note', value)); return; }
      const a = node('a', 'book-source', '资料来源 ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a);
    }
    function expandPhoto(g, field, label, caption, sourceUrl) {
      const dialog = $('book-photo-viewer');
      $('book-photo-title').textContent = label + ' / ' + g.name;
      const note = $('book-photo-note'); note.replaceChildren();
      if (caption) note.append(node('p', 'book-caption', caption)); source(note, sourceUrl);
      $('book-photo-image').alt = label + '：' + g.name;
      dialog.showModal(); showAsset($('book-photo-image'), g, field);
    }
    function image(g, field, label, caption = '', sourceUrl = '') {
      const figure = node('figure', 'book-plate');
      figure.dataset.kind = field.startsWith('photo_') ? g.archive?.photos?.find(p => 'photo_' + p.id === field)?.kind || 'reference' : 'garment';
      const mat = button('book-picture', undefined, () => expandPhoto(g, field, label, caption, sourceUrl)), img = node('img');
      mat.setAttribute('aria-label', '放大查看' + label + '：' + g.name); img.alt = label + '：' + g.name; mat.append(img); showAsset(img, g, field);
      const figcaption = node('figcaption'); figcaption.append(node('span', 'book-type', label));
      if (caption) { const text = node('p', 'book-caption', caption); text.title = caption; figcaption.append(text); } source(figcaption, sourceUrl);
      figure.append(mat, figcaption); return figure;
    }
    function stage(g, entries, page = 1) {
      const sheet = node('div', 'book-stage'); sheet.dataset.count = String(entries.length); sheet.dataset.page = String(page);
      sheet.setAttribute('role', 'group'); sheet.setAttribute('aria-label', '照片拼贴，第 ' + page + ' 页');
      for (let n = 0; n < entries.length; n++) {
        const e = entries[n], print = image(g, e.field, e.label, e.caption, e.sourceUrl);
        print.className += ' book-layer-' + ['base', 'front', 'insert'][n]; sheet.append(print);
      }
      const label = node('div', 'book-fabric-label', g.brand || g.name); label.setAttribute('aria-hidden', 'true'); sheet.append(label);
      const note = node('p', 'book-stage-number', 'No. ' + reference(g) + ' / ' + String(page).padStart(2, '0')); sheet.append(note); return sheet;
    }
    function facts(section, entries) {
      const dl = node('dl', 'book-facts');
      for (const [label, value] of entries) {
        if (value === '' || value === null || value === undefined) continue;
        const pair = node('div'); pair.append(node('dt', '', label), node('dd', '', value)); dl.append(pair);
      }
      section.append(dl); return dl;
    }
    function chapter(number, title) {
      const section = node('section', 'book-chapter'); section.append(node('p', 'book-kicker', number), node('h3', '', title)); return section;
    }
    function renderIndex() {
      const options = C.brandOptions(state.records), brands = $('book-brand');
      if (state.brand && !options.some(b => b.value === state.brand)) state.brand = '';
      brands.replaceChildren(); const all = node('option', '', '全部品牌'); all.value = ''; brands.append(all);
      for (const option of options) { const el = node('option', '', option.label + '（' + option.count + '）'); el.value = option.value; brands.append(el); } brands.value = state.brand;
      const items = select(state.records, state), grid = $('book-grid'); grid.replaceChildren();
      const previous = state.selected;
      if (!items.some(g => g.id === state.selected)) state.selected = (items.find(g => g.archive?.photos?.length) || items[0])?.id || null;
      if (previous !== state.selected) $('book-export-price').checked = false;
      $('book-total').textContent = String(state.records.length).padStart(2, '0');
      $('book-results').textContent = items.length + ' 份档案' + (state.query || state.brand || state.filter !== 'all' ? ' · 已筛选' : ' · 按品牌整理');
      $('book-empty').hidden = state.records.length > 0; $('book-no-results').hidden = !state.records.length || items.length > 0;
      grid.hidden = !items.length;
      for (const g of items) {
        const card = button('book-index-card', undefined, () => open(g.id)); card.dataset.garmentId = g.id; card.dataset.selected = String(state.mode === 'record' && g.id === state.selected);
        card.setAttribute('aria-controls', 'book-record'); if (state.mode === 'record' && g.id === state.selected) card.setAttribute('aria-current', 'true');
        card.setAttribute('aria-label', '打开档案册：' + g.name);
        const photos = g.archive?.photos || [], photo = photos.find(p => p.kind === 'runway');
        const visual = node('span', 'book-index-photo'), img = node('img');
        img.alt = (photo ? C.PHOTO_KINDS[photo.kind] : '实物') + '：' + g.name;
        visual.append(img); showAsset(img, g, photo ? 'photo_' + photo.id : 'thumb');
        const text = node('span', 'book-index-label');
        text.append(node('span', 'book-index-brand', g.brand || '个人收藏'), node('span', 'book-index-series', series(g) || g.subcategory || C.categoryLabel(g.category)));
        text.append(node('span', 'book-index-name', g.name));
        const foot = node('span', 'book-index-foot'); foot.append(node('span', 'book-code', 'No. ' + reference(g)), node('span', 'book-index-mark', g.demo ? '示例' : photo ? '秀场图' : '实物'));
        text.append(foot); if (state.prices && C.formatPrice(g)) text.append(node('span', 'book-index-price', '实付 ' + C.formatPrice(g)));
        card.append(visual, text); grid.append(card);
      }
    }
    function renderWall() {
      const items = select(state.records, state), overview = $('book-overview');
      overview.hidden = state.mode !== 'wall' || !items.length;
      $('book-show-wall').setAttribute('aria-pressed', String(state.mode === 'wall'));
      $('book-show-record').setAttribute('aria-pressed', String(state.mode === 'record'));
      $('book-show-record').disabled = !state.selected;
      if (state.mode !== 'wall') return;
      const wall = $('book-wall'); wall.replaceChildren();
      $('book-wall-count').textContent = items.length + ' 件收藏' + (state.query || state.brand || state.filter !== 'all' ? ' · 已筛选' : ' · 全部展示');
      for (let n = 0; n < items.length; n++) {
        const g = items[n], sheet = node('section', 'book-wall-sheet'); sheet.dataset.garmentId = g.id;
        sheet.setAttribute('aria-label', '收藏拼贴：' + (g.brand ? g.brand + ' / ' : '') + g.name);
        const piece = button('book-wall-piece', undefined, () => open(g.id)); piece.dataset.garmentId = g.id; piece.dataset.role = 'hero';
        piece.setAttribute('aria-label', '打开档案：' + (g.brand ? g.brand + ' / ' : '') + g.name);
        const attached = g.archive?.photos || [];
        sheet.dataset.photos = attached.length ? 'attached' : 'single';
        const photo = node('span', 'book-wall-photo'), img = node('img');
        img.alt = '实物：' + g.name;
        photo.append(img); showAsset(img, g, 'thumb');
        const note = node('span', 'book-wall-note');
        note.append(node('span', 'book-wall-brand', g.brand || g.name));
        if (g.brand) note.append(node('span', 'book-wall-name', g.name));
        if (series(g)) note.append(node('span', 'book-wall-series', series(g)));
        if (state.prices && C.formatPrice(g)) note.append(node('span', 'book-wall-price', '实付 ' + C.formatPrice(g)));
        piece.append(photo, note); sheet.append(piece);
        if (attached.length) {
          const satellites = node('div', 'book-wall-satellites');
          satellites.dataset.count = String(attached.length);
          for (const attachment of attached) {
            const label = C.PHOTO_KINDS[attachment.kind], field = 'photo_' + attachment.id;
            const mini = button('book-wall-mini', undefined, () => expandPhoto(g, field, label, attachment.caption, attachment.sourceUrl));
            mini.dataset.garmentId = g.id; mini.dataset.photoId = attachment.id;
            mini.setAttribute('aria-label', '放大查看' + label + '：' + g.name);
            const visual = node('span', 'book-wall-mini-photo'), smallImage = node('img'); smallImage.alt = label + '：' + g.name;
            visual.append(smallImage); showAsset(smallImage, g, field);
            const caption = node('span', 'book-wall-mini-name', label); caption.title = attachment.caption || label;
            mini.append(visual, caption); satellites.append(mini);
          }
          sheet.append(satellites);
        }
        wall.append(sheet);
      }
    }

    function renderRecord() {
      const g = state.records.find(g => g.id === state.selected);
      setDirectory(state.directoryCollapsed); $('book-record').hidden = !g || state.mode !== 'record';
      if (!g) { state.selected = null; $('book-record-body').replaceChildren(); return; }
      if (state.mode !== 'record') return;
      const a = C.archiveDetails(g.archive) || { photos: [] }, body = $('book-record-body');
      const inventoryOpen = body.dataset.garmentId === g.id && body.querySelector('details')?.open;
      body.dataset.garmentId = g.id; body.replaceChildren();
      const head = node('header', 'book-record-heading');
      const top = node('div', 'book-record-topline'); top.append(node('span', 'book-code', 'ARCHIVE / ' + reference(g)), node('span', 'book-type', C.PURCHASE_STATUSES[g.purchaseStatus || 'owned']));
      head.append(top, node('p', 'book-record-brand', g.brand || '个人收藏'), node('h2', 'book-record-title', g.name));
      if (series(g)) head.append(node('p', 'book-record-series', series(g)));
      const photos = a.photos || [], first = photos.find(p => p.kind === 'runway') || photos[0];
      const collage = node('div', 'book-collage'); collage.dataset.layout = !first ? 'single' : first.kind === 'runway' ? 'comparison' : 'study';
      const remaining = photos.filter(p => p !== first);
      const entries = [{ field: 'image', label: '实物', caption: [g.color, g.size].filter(Boolean).join(' · '), sourceUrl: '' }, ...[first, ...remaining].filter(Boolean).map(p => ({ field: 'photo_' + p.id, label: C.PHOTO_KINDS[p.kind], caption: p.caption, sourceUrl: p.sourceUrl }))];
      collage.append(stage(g, entries.slice(0, 3)), head);
      const collection = chapter('SOURCE NOTES', '系列与来历'); collection.className += ' book-collection-sheet';
      const hasSeries = ['year', 'season', 'collection', 'look', 'relation', 'sourceUrl'].some(field => a[field]) || photos.some(p => p.kind === 'runway');
      facts(collection, [['年份', a.year], ['季节', a.season ? C.SEASONS[a.season] : ''], ['系列', a.collection], ['Look', a.look], ['与秀场的关系', a.relation ? C.RELATIONS[a.relation] : ''], ['资料状态', hasSeries ? (a.verification === 'confirmed' ? '已确认' : '待确认') : '尚未记录']]); source(collection, a.sourceUrl);
      const story = chapter('PERSONAL NOTES', '我的收藏故事'); story.className += ' book-story-sheet';
      if (a.story) story.append(node('p', 'book-story', a.story));
      else story.append(button('book-text-button', '写下这件衣服的故事 ↗', () => onEdit(g.id)));
      collage.append(story, collection);
      if (!first) story.append(button('book-text-button book-add-reference', '＋ 添加秀场、细节或穿着照片', () => onEdit(g.id)));
      body.append(collage);
      for (let n = 3; n < entries.length; n += 3) body.append(stage(g, entries.slice(n, n + 3), n / 3 + 1));
      body.append(node('p', 'book-photo-hint', '点击照片可放大查看完整图片、图注与来源。'));
      const purchase = node('details', 'book-inventory'); purchase.open = !!inventoryOpen; purchase.append(node('summary', '', '单品与购入记录'));
      facts(purchase, [['分类', g.subcategory || C.categoryLabel(g.category)], ['配色', g.color], ['尺码', g.size], ['款式', g.style], ['图案', g.pattern], ['购入日期', g.purchaseDate], ['购买渠道', g.purchaseSource], ['全新 / 二手', C.PURCHASE_CONDITIONS[g.purchaseCondition]], ['购入方式', C.PURCHASE_TYPES[g.purchaseType]], ['实付', state.prices ? C.formatPrice(g) : ''], ['原价', state.prices ? C.formatPrice(g, 'originalPrice') : '']]);
      if (g.notes) purchase.append(node('p', 'book-notes', g.notes)); body.append(purchase);
      const items = select(state.records, state), position = items.findIndex(item => item.id === g.id);
      $('book-previous').disabled = position < 1; $('book-next').disabled = position < 0 || position >= items.length - 1;
      $('book-page-number').textContent = position < 0 ? 'No. ' + reference(g) : String(position + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0');
    }
    function render(records = state.records) { state.records = records; renderIndex(); renderWall(); renderRecord(); }
    function open(id) {
      if (!state.records.some(g => g.id === id)) return;
      if (!select(state.records, state).some(g => g.id === id)) resetFilters();
      state.mode = 'record'; state.selected = id; $('book-export-price').checked = false; render(); $('book-record').focus?.({ preventScroll: true }); $('book-record').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
    function move(direction) {
      const items = select(state.records, state), position = items.findIndex(g => g.id === state.selected); if (items[position + direction]) open(items[position + direction].id);
    }
    $('book-search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); render(); });
    $('book-brand').addEventListener('change', e => { state.brand = e.target.value; render(); });
    $('book-filter').addEventListener('change', e => { state.filter = e.target.value; render(); });
    $('book-prices').addEventListener('change', e => { state.prices = e.target.checked; render(); });
    function resetFilters() { state.query = state.brand = ''; state.filter = 'all'; $('book-search').value = $('book-brand').value = ''; $('book-filter').value = 'all'; }
    $('book-reset').onclick = () => { resetFilters(); render(); };
    function showWall() { state.mode = 'wall'; render(); $('book-overview').focus?.({ preventScroll: true }); $('book-overview').scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }
    $('book-back').onclick = showWall;
    $('book-show-wall').onclick = showWall;
    $('book-show-record').onclick = () => { if (state.selected) open(state.selected); };
    $('book-previous').onclick = () => move(-1); $('book-next').onclick = () => move(1);
    $('book-edit').onclick = () => { if (state.selected) onEdit(state.selected); };
    $('book-style').onclick = () => { if (state.selected) onStyle(state.selected); };
    $('book-export').onclick = () => { if (state.selected) onExport(state.selected, !!$('book-export-price').checked); };
    $('book-upload').onclick = onUpload;
    $('book-photo-close').onclick = () => $('book-photo-viewer').close();
    $('book-directory-toggle').onclick = () => setDirectory(!state.directoryCollapsed);
    setDirectory(true); $('book-record').hidden = true;
    return { render, open, setSync: text => { $('book-sync-status').textContent = text; } };
  }
  return { reference, series, select, create };
});
