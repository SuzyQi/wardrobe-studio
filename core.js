(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WardrobeCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 800, HEIGHT = 1000;
  const CATEGORIES = [
    { id: 'all', label: '全部' }, { id: 'tops', label: '上装' },
    { id: 'bottoms', label: '下装' }, { id: 'dresses', label: '连衣裙' },
    { id: 'outerwear', label: '外套' }, { id: 'shoes', label: '鞋履' },
    { id: 'bags', label: '包袋' }, { id: 'accessories', label: '配饰' },
    { id: 'unsorted', label: '待整理' }
  ];
  const CAT_IDS = new Set(CATEGORIES.slice(1).map(c => c.id));
  const BACKGROUNDS = ['#fff1b5', '#c1dbe8', '#43302e'];
  const LEGACY_BACKGROUNDS = ['#f5f1e9', '#ffffff', '#f1e5e3', '#e8ede6'];
  function normalizeBackground(color) {
    return [...BACKGROUNDS, ...LEGACY_BACKGROUNDS].includes(color) ? color : BACKGROUNDS[0];
  }
  function boardInk(color) { return color === '#43302e' ? '#fff1b5' : '#43302e'; }
  const ID_RE = /^[a-zA-Z0-9_-]{1,100}$/;
  const SAFE_IMAGE = /^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function id(prefix = 'g') {
    return prefix + '_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2));
  }
  function categoryLabel(value) { return CATEGORIES.find(c => c.id === value)?.label || '待整理'; }
  function suggestCategory(filename = '') {
    const s = filename.toLowerCase();
    const rules = [
      ['dresses', /连衣裙|吊带裙|dress|gown/],
      ['outerwear', /外套|大衣|风衣|夹克|coat|jacket|blazer|trench/],
      ['bottoms', /半裙|短裙|长裙|裤|skirt|trouser|jean|pant|short/],
      ['tops', /上衣|衬衫|开衫|毛衣|针织|背心|吊带|shirt|blouse|cardigan|knit|sweater|tee|top|vest/],
      ['shoes', /鞋|靴|shoe|boot|sandal|loafer|heel/],
      ['bags', /包|bag|tote|purse/],
      ['accessories', /耳环|项链|腰带|围巾|帽|earring|necklace|belt|scarf|hat/]
    ];
    return rules.find(([, re]) => re.test(s))?.[0] || 'unsorted';
  }
  function defaultName(category, sequence, color = '') {
    return [color.trim(), categoryLabel(category), String(sequence).padStart(3, '0')].filter(Boolean).join(' ');
  }
  function alphaBounds(data, width, height, threshold = 12) {
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) return null;
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  }
  function defaultLayer(garment, index = 0) {
    const positions = {
      tops: [210, 105, 350, 380], bottoms: [225, 470, 335, 405],
      dresses: [200, 100, 400, 740], outerwear: [75, 115, 350, 610],
      shoes: [285, 825, 260, 135], bags: [565, 505, 180, 250],
      accessories: [80, 685, 140, 190], unsorted: [245, 265, 300, 400]
    };
    const [x, y, maxW, maxH] = positions[garment.category] || positions.unsorted;
    const aspect = clamp(Number(garment.aspect) || 0.8, 0.05, 20);
    const w = Math.min(maxW, maxH * aspect);
    return { id: id('l'), garmentId: garment.id, x: x + (maxW - w) / 2 + index * 18,
      y: y + index * 18, w, rotation: 0, flip: false };
  }
  function positionLayer(layer, aspect = 0.8) {
    const w = clamp(Number(layer.w) || 240, 35, 760);
    const h = w / clamp(aspect, 0.05, 20);
    return { ...layer, w, x: clamp(Number(layer.x) || 0, -w * 0.55, WIDTH - w * 0.45),
      y: clamp(Number(layer.y) || 0, -h * 0.55, HEIGHT - Math.min(h * 0.45, 420)) };
  }
  function validateBackup(input) {
    const fail = message => { throw new Error(message); };
    if (!input || input.app !== 'wardrobe-studio' || input.version !== 1) fail('这不是受支持的衣橱备份文件。');
    if (!Array.isArray(input.garments) || !Array.isArray(input.outfits) || input.garments.length > 10000 || input.outfits.length > 5000) fail('备份中的记录格式或数量有误。');
    const seen = new Set();
    function validId(value) { if (typeof value !== 'string' || !ID_RE.test(value)) fail('备份中含有无效编号。'); return value; }
    function text(value, max = 100) { return typeof value === 'string' ? value.slice(0, max) : ''; }
    function image(value) {
      if (typeof value !== 'string' || value.length > 40 * 1024 * 1024 || !SAFE_IMAGE.test(value)) fail('备份中含有不支持或损坏的图片。');
      const payload = value.slice(value.indexOf(',') + 1);
      if (payload.length % 4 !== 0) fail('备份图片编码不完整。');
      return value;
    }
    const garments = input.garments.map(g => {
      if (!g || typeof g !== 'object') fail('单品记录格式不正确。');
      const gid = validId(g.id);
      if (seen.has(gid)) fail('备份中存在重复的单品编号。'); seen.add(gid);
      if (!CAT_IDS.has(g.category)) fail('备份中的单品分类无效。');
      const aspect = Number(g.aspect);
      if (!Number.isFinite(aspect) || aspect < 0.05 || aspect > 20) fail('备份中的图片比例无效。');
      return { id: gid, name: text(g.name) || '未命名单品', category: g.category,
        color: text(g.color, 30), notes: text(g.notes, 1500), favorite: !!g.favorite,
        demo: !!g.demo, aspect, createdAt: text(g.createdAt, 40), updatedAt: text(g.updatedAt, 40),
        image: image(g.image), original: image(g.original || g.image), thumb: image(g.thumb || g.image) };
    });
    const outfitIds = new Set();
    const outfits = input.outfits.map(o => {
      if (!o || typeof o !== 'object') fail('搭配记录格式不正确。');
      const oid = validId(o.id);
      if (outfitIds.has(oid)) fail('备份中存在重复的搭配编号。'); outfitIds.add(oid);
      if (!Array.isArray(o.layers) || o.layers.length > 40) fail('搭配的单品数量有误。');
      const layerIds = new Set();
      const layers = o.layers.map(l => {
        if (!l || typeof l !== 'object') fail('搭配图层格式不正确。');
        const lid = validId(l.id), garmentId = validId(l.garmentId);
        if (layerIds.has(lid) || !seen.has(garmentId)) fail('搭配包含重复图层或缺失的衣服。'); layerIds.add(lid);
        if (![l.x, l.y, l.w, l.rotation].every(Number.isFinite) || l.w < 35 || l.w > 760 || Math.abs(l.x) > 16000 || Math.abs(l.y) > 20000 || Math.abs(l.rotation) > 360) fail('搭配位置数据无效。');
        return { id: lid, garmentId, x: l.x, y: l.y, w: l.w, rotation: l.rotation, flip: !!l.flip };
      });
      return { id: oid, name: text(o.name) || '未命名搭配', notes: text(o.notes, 1500),
        background: normalizeBackground(o.background),
        layers, createdAt: text(o.createdAt, 40), updatedAt: text(o.updatedAt, 40) };
    });
    return { garments, outfits };
  }
  function removeGarmentReferences(outfits, garmentId) {
    return outfits.map(o => ({ ...o, layers: o.layers.filter(l => l.garmentId !== garmentId) }));
  }
  return { WIDTH, HEIGHT, CATEGORIES, CAT_IDS, BACKGROUNDS, normalizeBackground, boardInk, clamp, id, categoryLabel, suggestCategory,
    defaultName, alphaBounds, defaultLayer, positionLayer, validateBackup, removeGarmentReferences };
});
