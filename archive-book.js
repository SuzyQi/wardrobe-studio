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
    const state = { records: [], query: '', brand: '', filter: 'all', selected: null, prices: false };
    const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = String(text); return el; };
    const button = (className, text, action) => { const el = node('button', className, text); el.type = 'button'; el.onclick = action; return el; };
    function source(parent, value) {
      if (!value) return;
      let href; try { href = C.sourceUrl(value); } catch { href = ''; }
      if (!href.startsWith('https://')) { parent.append(node('p', 'book-source-note', value)); return; }
      const a = node('a', 'book-source', '资料来源 ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a);
    }
    function image(g, field, label, caption = '', sourceUrl = '', lead = false) {
      const figure = node('figure', 'book-plate' + (lead ? ' book-plate-lead' : ''));
      const mat = node('div', 'book-picture'), img = node('img'); img.alt = label + '：' + g.name; mat.append(img); showAsset(img, g, field);
      const figcaption = node('figcaption'); figcaption.append(node('span', 'book-type', label));
      if (caption) figcaption.append(node('p', 'book-caption', caption)); source(figcaption, sourceUrl);
      figure.append(mat, figcaption); return figure;
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
      const section = node('section', 'book-chapter'); section.append(node('p', 'book-kicker', number + ' / RECORD'), node('h3', '', title)); return section;
    }
    function renderIndex() {
      const options = C.brandOptions(state.records), brands = $('book-brand');
      if (state.brand && !options.some(b => b.value === state.brand)) state.brand = '';
      brands.replaceChildren(); const all = node('option', '', '全部品牌'); all.value = ''; brands.append(all);
      for (const option of options) { const el = node('option', '', option.label + '（' + option.count + '）'); el.value = option.value; brands.append(el); } brands.value = state.brand;
      const items = select(state.records, state), grid = $('book-grid'); grid.replaceChildren();
      $('book-total').textContent = String(state.records.length).padStart(2, '0');
      $('book-results').textContent = items.length + ' 份档案' + (state.query || state.brand || state.filter !== 'all' ? ' · 已筛选' : ' · 按品牌整理');
      $('book-empty').hidden = state.records.length > 0; $('book-no-results').hidden = !state.records.length || items.length > 0;
      grid.hidden = !items.length;
      for (const g of items) {
        const card = button('book-index-card', undefined, () => open(g.id)); card.dataset.garmentId = g.id; card.setAttribute('aria-label', '打开档案册：' + g.name);
        const visual = node('span', 'book-index-photo'), img = node('img'); img.alt = g.name; visual.append(img); showAsset(img, g, 'thumb');
        const text = node('span', 'book-index-label');
        text.append(node('span', 'book-index-brand', g.brand || '个人收藏'), node('span', 'book-index-name', g.name));
        text.append(node('span', 'book-index-series', series(g) || g.subcategory || C.categoryLabel(g.category)));
        const foot = node('span', 'book-index-foot'); foot.append(node('span', 'book-code', 'No. ' + reference(g)), node('span', 'book-index-mark', g.demo ? '示例' : g.archive?.verification === 'confirmed' && series(g) ? '资料已确认' : g.archive?.relation || g.archive?.photos?.some(p => p.kind === 'runway') ? '秀款资料待确认' : '打开档案 ↗'));
        text.append(foot); if (state.prices && C.formatPrice(g)) text.append(node('span', 'book-index-price', '实付 ' + C.formatPrice(g)));
        card.append(visual, text); grid.append(card);
      }
    }
    function renderRecord() {
      const g = state.records.find(g => g.id === state.selected);
      $('book-index').hidden = !!g; $('book-record').hidden = !g;
      if (!g) { state.selected = null; $('book-record-body').replaceChildren(); return; }
      const a = C.archiveDetails(g.archive) || { photos: [] }, body = $('book-record-body'); body.replaceChildren();
      const head = node('header', 'book-record-heading');
      const top = node('div', 'book-record-topline'); top.append(node('span', 'book-code', 'ARCHIVE / ' + reference(g)), node('span', 'book-type', C.PURCHASE_STATUSES[g.purchaseStatus || 'owned']));
      head.append(top, node('p', 'book-record-brand', g.brand || '个人收藏'), node('h2', 'book-record-title', g.name));
      if (series(g)) head.append(node('p', 'book-record-series', series(g)));
      const photos = a.photos || [], first = photos.find(p => p.kind === 'runway') || photos[0], paired = node('div', 'book-paired-plates');
      paired.append(image(g, 'image', '01 / 实物', [g.color, g.size].filter(Boolean).join(' · '), '', true));
      if (first) paired.append(image(g, 'photo_' + first.id, '02 / ' + C.PHOTO_KINDS[first.kind], first.caption, first.sourceUrl, true));
      else {
        const note = node('div', 'book-missing-plate'); note.append(node('span', 'book-kicker', 'A PLACE FOR THE REFERENCE'), node('h3', '', '它的来历，慢慢补齐'), node('p', '', '秀场、细节或自己的穿着照片，都可以放进这份档案。'), button('book-text-button', '＋ 补充附图', () => onEdit(g.id))); paired.append(note);
      }
      const spread = node('div', 'book-paper-spread'), collection = chapter('01', '系列与来历');
      const hasSeries = ['year', 'season', 'collection', 'look', 'relation', 'sourceUrl'].some(field => a[field]) || photos.some(p => p.kind === 'runway');
      facts(collection, [['年份', a.year], ['季节', a.season ? C.SEASONS[a.season] : ''], ['系列', a.collection], ['Look', a.look], ['与秀场的关系', a.relation ? C.RELATIONS[a.relation] : ''], ['资料状态', hasSeries ? (a.verification === 'confirmed' ? '已确认' : '待确认') : '尚未记录']]);
      source(collection, a.sourceUrl);
      const story = chapter('02', '我的收藏故事'); story.className += ' book-story-sheet';
      story.append(node('p', 'book-story', a.story || '第一次遇见它，寻找它的过程，或一次特别的穿着回忆。'));
      if (!a.story) story.append(button('book-text-button', '写下这件衣服的故事 ↗', () => onEdit(g.id)));
      spread.append(collection, story); body.append(head, paired, spread);
      const remaining = photos.filter(p => p !== first);
      if (remaining.length) {
        const details = chapter('03', '相册与细节'), gallery = node('div', 'book-detail-gallery');
        for (const p of remaining) gallery.append(image(g, 'photo_' + p.id, C.PHOTO_KINDS[p.kind], p.caption, p.sourceUrl)); details.append(gallery); body.append(details);
      }
      const purchase = chapter(remaining.length ? '04' : '03', '单品与购入记录');
      facts(purchase, [['分类', g.subcategory || C.categoryLabel(g.category)], ['配色', g.color], ['尺码', g.size], ['款式', g.style], ['图案', g.pattern], ['购入日期', g.purchaseDate], ['购买渠道', g.purchaseSource], ['全新 / 二手', C.PURCHASE_CONDITIONS[g.purchaseCondition]], ['购入方式', C.PURCHASE_TYPES[g.purchaseType]], ['实付', state.prices ? C.formatPrice(g) : ''], ['原价', state.prices ? C.formatPrice(g, 'originalPrice') : '']]);
      if (g.notes) purchase.append(node('p', 'book-notes', g.notes)); body.append(purchase);
      const items = select(state.records, state), position = items.findIndex(item => item.id === g.id);
      $('book-previous').disabled = position < 1; $('book-next').disabled = position < 0 || position >= items.length - 1;
      $('book-page-number').textContent = position < 0 ? 'No. ' + reference(g) : String(position + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0');
    }
    function render(records = state.records) { state.records = records; renderIndex(); renderRecord(); }
    function open(id) {
      if (!state.records.some(g => g.id === id)) return;
      state.selected = id; $('book-export-price').checked = false; renderRecord(); $('book-record').focus?.({ preventScroll: true }); $('book-record').scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
    function move(direction) {
      const items = select(state.records, state), position = items.findIndex(g => g.id === state.selected); if (items[position + direction]) open(items[position + direction].id);
    }
    $('book-search').addEventListener('input', e => { state.query = e.target.value.trim().toLowerCase(); renderIndex(); });
    $('book-brand').addEventListener('change', e => { state.brand = e.target.value; renderIndex(); });
    $('book-filter').addEventListener('change', e => { state.filter = e.target.value; renderIndex(); });
    $('book-prices').addEventListener('change', e => { state.prices = e.target.checked; render(); });
    $('book-reset').onclick = () => { state.query = state.brand = ''; state.filter = 'all'; $('book-search').value = $('book-brand').value = ''; $('book-filter').value = 'all'; renderIndex(); };
    $('book-back').onclick = () => { state.selected = null; renderRecord(); $('book-index').focus?.({ preventScroll: true }); $('book-index').scrollIntoView?.({ block: 'start', behavior: 'smooth' }); };
    $('book-previous').onclick = () => move(-1); $('book-next').onclick = () => move(1);
    $('book-edit').onclick = () => { if (state.selected) onEdit(state.selected); };
    $('book-style').onclick = () => { if (state.selected) onStyle(state.selected); };
    $('book-export').onclick = () => { if (state.selected) onExport(state.selected, !!$('book-export-price').checked); };
    $('book-upload').onclick = onUpload;
    $('book-record').hidden = true;
    return { render, open, setSync: text => { $('book-sync-status').textContent = text; } };
  }
  return { reference, series, select, create };
});
