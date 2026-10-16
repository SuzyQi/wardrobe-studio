(function (root) {
  'use strict';
  const C = root.WardrobeCore;
  const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
  function load(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取。请转换成 PNG、JPG 或 WebP 后重试。')); };
      image.src = url;
    });
  }
  function blob(canvas, type = 'image/png', quality = 0.88) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片处理失败。')), type, quality));
  }
  function canvas(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; }
  async function prepare(file) {
    if (!ALLOWED.has(file.type)) throw new Error('支持 PNG、JPG、WebP 和 AVIF。HEIC 请先转换为 JPG。');
    if (file.size > 25 * 1024 * 1024) throw new Error('单张图片请小于 25 MB。');
    const img = await load(file);
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 60000000) throw new Error('图片尺寸过大，请缩小后再上传。');
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const src = canvas(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
    const context = src.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0, src.width, src.height);
    return finish(src, file);
  }
  async function finish(src, original) {
    const ctx = src.getContext('2d', { willReadFrequently: true });
    const bounds = C.alphaBounds(ctx.getImageData(0, 0, src.width, src.height).data, src.width, src.height);
    if (!bounds) throw new Error('图片是完全透明的，请换一张图片。');
    const target = canvas(bounds.width, bounds.height);
    target.getContext('2d').drawImage(src, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    const factor = Math.min(1, 440 / Math.max(target.width, target.height));
    const thumb = canvas(Math.max(1, Math.round(target.width * factor)), Math.max(1, Math.round(target.height * factor)));
    thumb.getContext('2d').drawImage(target, 0, 0, thumb.width, thumb.height);
    return { image: await blob(target), thumb: await blob(thumb, 'image/webp'), original,
      aspect: C.clamp(target.width / target.height, 0.05, 20) };
  }
  async function removeLightBackground(record, tolerance = 38) {
    const image = await load(record.image), c = canvas(image.naturalWidth, image.naturalHeight);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, c.width, c.height), data = pixels.data;
    const count = c.width * c.height, visited = new Uint8Array(count), queue = new Int32Array(count);
    let head = 0, tail = 0;
    const eligible = i => {
      const p = i * 4;
      return data[p + 3] < 12 || (Math.min(data[p], data[p + 1], data[p + 2]) >= 255 - tolerance && Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]) < 35);
    };
    const add = i => { if (!visited[i] && eligible(i)) { visited[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < c.width; x++) { add(x); add((c.height - 1) * c.width + x); }
    for (let y = 0; y < c.height; y++) { add(y * c.width); add(y * c.width + c.width - 1); }
    while (head < tail) {
      const i = queue[head++], x = i % c.width, y = Math.floor(i / c.width);
      data[i * 4 + 3] = 0;
      if (x > 0) add(i - 1); if (x < c.width - 1) add(i + 1);
      if (y > 0) add(i - c.width); if (y < c.height - 1) add(i + c.width);
    }
    if (tail > count * 0.98) throw new Error('浅色区域过多，无法可靠区分衣服和背景。请保留原图或换一张照片。');
    ctx.putImageData(pixels, 0, 0);
    return finish(c, record.original);
  }
  function dataUrl(blob) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  }
  function fromDataUrl(value) {
    const [header, encoded] = value.split(','), binary = atob(encoded), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: header.slice(5, header.indexOf(';')) });
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  root.WardrobeImages = { load, blob, canvas, prepare, removeLightBackground, dataUrl, fromDataUrl, download };
})(globalThis);
