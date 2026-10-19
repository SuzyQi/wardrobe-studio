(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.WardrobeMemorial = factory(root.WardrobeCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const FONT = 'Georgia, "Songti SC", "Microsoft YaHei", serif';
  function layout(g, includePrice, measure) {
    const a = C.archiveDetails(g.archive) || {}, ops = [], images = [];
    let y = 78;
    function text(value, size = 25, color = '#514847', width = 1040) {
      const font = size + 'px ' + FONT, step = Math.ceil(size * 1.65);
      for (const paragraph of String(value).split('\n')) {
        let line = '';
        for (const char of paragraph) {
          if (line && measure(line + char, font) > width) { ops.push({ text: line, x: 80, y, font, color }); y += step; line = ''; }
          line += char;
        }
        ops.push({ text: line, x: 80, y, font, color }); y += step;
      }
    }
    function section(title, value) {
      if (!value) return;
      y += 36; text(title, 17, '#8b7771'); y += 6; text(value);
    }
    text('WARDROBE STUDIO  /  PERSONAL COLLECTION', 15, '#8b7771'); y += 18;
    text(g.brand || 'MY COLLECTION', 44); text(g.name, 32); y += 18;
    const photo = a.photos?.find(p => p.kind === 'runway') || a.photos?.[0];
    const boxes = photo ? [{ field: 'image', label: 'MY PIECE  /  我的藏品', x: 80, w: 505 },
      { field: 'photo_' + photo.id, label: C.PHOTO_KINDS[photo.kind] + (photo.caption ? ' · ' + photo.caption : ''), x: 615, w: 505 }] : [{ field: 'image', label: 'MY PIECE  /  我的藏品', x: 80, w: 1040 }];
    for (const box of boxes) images.push({ ...box, y, h: 660 });
    y += 700;
    for (const box of boxes) {
      // Each label wraps within its own column, leaving enough space below both photographs.
      const start = y; let line = '', row = 0; const font = '17px ' + FONT;
      for (const char of box.label) {
        if (line && measure(line + char, font) > box.w) { ops.push({ text: line, x: box.x, y: start + row++ * 29, font, color: '#8b7771' }); line = ''; }
        line += char;
      }
      ops.push({ text: line, x: box.x, y: start + row * 29, font, color: '#8b7771' }); box.bottom = start + (row + 1) * 29;
    }
    y = Math.max(...boxes.map(b => b.bottom));
    const series = [a.year, a.season ? C.SEASONS[a.season] : '', a.collection, a.look ? 'Look ' + a.look : ''].filter(Boolean).join(' · ');
    section('THE COLLECTION  /  秀款资料', [series, a.relation ? C.RELATIONS[a.relation] : '', series || a.relation ? (a.verification === 'confirmed' ? '资料已确认' : '资料待确认') : ''].filter(Boolean).join('\n'));
    section('A STORY TO KEEP  /  我的收藏故事', a.story);
    section('IN MY WARDROBE  /  购入档案', [g.size ? '尺码 ' + g.size : '', g.purchaseDate, g.purchaseSource,
      includePrice && C.formatPrice(g) ? '实付 ' + C.formatPrice(g) : '', includePrice && C.formatPrice(g, 'originalPrice') ? '原价 ' + C.formatPrice(g, 'originalPrice') : ''].filter(Boolean).join(' · '));
    const sources = [...new Set([a.sourceUrl, photo?.sourceUrl].filter(Boolean))];
    section('REFERENCE  /  资料来源', sources.join('\n'));
    y += 66; text('A PIECE OF MY STORY', 17, '#8b7771');
    return { width: 1200, height: y + 48, ops, images };
  }
  return { layout };
});
