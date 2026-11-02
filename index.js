(() => {
  'use strict';
  const doc = document;
  const KEY = 'bg_adjuster_v1';
  const DEF = { bright: 100, blur: 0 };

  // ---------- 设置（存在本机） ----------
  const num = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
  let S;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = Object.assign({}, DEF); }
  S.bright = num(S.bright, 20, 150, 100);
  S.blur = num(S.blur, 0, 20, 0);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const isDefault = () => S.bright === 100 && S.blur === 0;

  // ---------- 背景层 ----------
  const ov = doc.createElement('style');   // 把处理好的图换进酒馆原来的背景层
  ov.id = 'bgx-override';
  doc.head.appendChild(ov);
  const shade = doc.createElement('div');  // 拖明暗时的实时预览遮罩
  shade.id = 'bgx-shade';

  const bgEls = () => ['bg_custom', 'bg1'].map(id => doc.getElementById(id)).filter(Boolean);

  function placeShade() {
    const els = bgEls();
    if (!els.length) { doc.body.prepend(shade); return; }
    const last = els.reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? b : a);
    let z = null;
    els.forEach(e => { const v = parseInt(getComputedStyle(e).zIndex, 10); if (!isNaN(v)) z = z === null ? v : Math.max(z, v); });
    shade.style.zIndex = z === null ? '' : String(z);
    last.after(shade);
  }
  function setShade(v) {
    if (v === 100) { shade.style.opacity = '0'; return; }
    shade.style.background = v < 100 ? '#000' : '#fff';
    shade.style.opacity = v < 100 ? ((100 - v) / 100).toFixed(3) : ((v - 100) / 100 * 0.6).toFixed(3);
  }
  const shadeColor = v => v < 100
    ? 'rgba(0,0,0,' + ((100 - v) / 100) + ')'
    : 'rgba(255,255,255,' + ((v - 100) / 100 * 0.6).toFixed(3) + ')';

  // 读出酒馆当前用的背景图（先暂时关掉自己的样式，读到的才是原图）
  function readSource() {
    if (ov.sheet) ov.sheet.disabled = true;
    try {
      for (const el of bgEls()) {
        const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(getComputedStyle(el).backgroundImage || '');
        if (m && m[2]) return { id: el.id, url: new URL(m[2], location.href).href };
      }
      return null;
    } finally { if (ov.sheet) ov.sheet.disabled = false; }
  }

  // ---------- 图片处理 ----------
  const made = new Set();
  function toUrl(c, q) {
    return new Promise((res, rej) => {
      c.toBlob(b => {
        if (!b) return rej(new Error('blob'));
        const u = URL.createObjectURL(b); made.add(u); res(u);
      }, 'image/jpeg', q);
    });
  }
  function gc(keep) {
    for (const u of made) if (!keep.includes(u)) { URL.revokeObjectURL(u); made.delete(u); }
  }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (new URL(url).origin !== location.origin) img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('load'));
      img.src = url;
    });
  }
  // 三次盒式模糊，效果接近高斯模糊，每张图只算一次
  function blurPass(a, b, len, count, r, step, lineStep) {
    const div = 2 * r + 1, last = len - 1;
    for (let l = 0; l < count; l++) {
      const base = l * lineStep;
      let sr = 0, sg = 0, sb = 0;
      for (let i = -r; i <= r; i++) {
        const p = base + (i < 0 ? 0 : i > last ? last : i) * step;
        sr += a[p]; sg += a[p + 1]; sb += a[p + 2];
      }
      for (let i = 0; i < len; i++) {
        const o = base + i * step;
        b[o] = sr / div; b[o + 1] = sg / div; b[o + 2] = sb / div; b[o + 3] = 255;
        const ai = i + r + 1, si = i - r;
        const pa = base + (ai > last ? last : ai) * step;
        const ps = base + (si < 0 ? 0 : si) * step;
        sr += a[pa] - a[ps]; sg += a[pa + 1] - a[ps + 1]; sb += a[pa + 2] - a[ps + 2];
      }
    }
  }
  function boxBlur(px, w, h, r) {
    const tmp = new Uint8ClampedArray(px.length);
    for (let i = 0; i < 3; i++) {
      blurPass(px, tmp, w, h, r, 4, w * 4);
      blurPass(tmp, px, h, w, r, w * 4, 4);
    }
  }

  let cache = {};
  async function buildBase(src) {
    const blur = S.blur;
    const img = (cache.img && cache.src === src.url) ? cache.img : await loadImage(src.url);
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const k = Math.min(1, (blur > 0 ? 1080 : 2400) / Math.max(iw, ih)); // 模糊的图不需要高分辨率
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const c = doc.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (blur > 0) {
      const disp = Math.max(innerWidth / w, innerHeight / h); // 一个图片像素在屏幕上有多大
      const r = Math.max(1, Math.round(blur / disp));
      const data = ctx.getImageData(0, 0, w, h);
      boxBlur(data.data, w, h, r);
      ctx.putImageData(data, 0, 0);
    }
    const baseUrl = await toUrl(c, blur > 0 ? 0.85 : 0.92);
    const warm = new Image(); warm.src = baseUrl; warm.decode().catch(() => {});
    cache = { src: src.url, id: src.id, img, blur, base: c, baseUrl, warm, bright: null };
  }
  function compose() {
    if (S.bright === 100) return Promise.resolve(cache.baseUrl);
    const b = cache.base, c = doc.createElement('canvas');
    c.width = b.width; c.height = b.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(b, 0, 0);
    ctx.fillStyle = shadeColor(S.bright);
    ctx.fillRect(0, 0, c.width, c.height);
    return toUrl(c, S.blur > 0 ? 0.85 : 0.92);
  }

  let appliedUrl = '';
  function writeCss(url) {
    // 只换图，位置和大小交给酒馆原来的背景层
    ov.textContent = '#' + cache.id + '{background-image:url("' + url + '") !important}';
    appliedUrl = url;
  }
  async function applyUrl(url) {
    try { const im = new Image(); im.src = url; await im.decode(); } catch (e) {}
    writeCss(url);
    setShade(100);
    cache.bright = S.bright;
    gc([url, cache.baseUrl]);
  }
  function clearOverride() {
    ov.textContent = ''; appliedUrl = ''; setShade(100);
    gc([]);
    cache = { img: cache.img, src: cache.src };
  }

  // ---------- 提交（排队执行，只做最后一次） ----------
  let job = 0, chain = Promise.resolve();
  function commit() { const my = ++job; chain = chain.then(() => run(my)).catch(() => {}); }
  async function run(my) {
    if (my !== job) return;
    if (isDefault()) { clearOverride(); setStatus(''); return; }
    const src = readSource();
    if (!src) { clearOverride(); setShade(S.bright); setStatus('没找到背景图，只调了明暗'); return; }
    if (cache.base && cache.src === src.url && cache.id === src.id && cache.blur === S.blur && cache.bright === S.bright && appliedUrl) return;
    setStatus('处理中…');
    await new Promise(r => setTimeout(r, 30)); // 先让「处理中」显示出来
    try {
      if (!cache.base || cache.src !== src.url || cache.blur !== S.blur) await buildBase(src);
      cache.id = src.id;
      const url = await compose();
      if (my !== job) return;
      await applyUrl(url);
      setStatus('');
    } catch (e) {
      console.warn('[背景调节器]', e);
      clearOverride(); setShade(S.bright);
      setStatus('这张背景读不了（可能是外部链接），朦胧用不了，明暗照常');
    }
  }

  // ---------- 检测：看屏幕顶部、中间、底部分别是哪一层 ----------
  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = Array.from(el.classList).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    const cs = getComputedStyle(el);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') s += '〔图〕';
    else if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') s += '〔色〕';
    return s;
  }
  function probe() {
    const W = innerWidth, H = innerHeight;
    const line = (name, y) => {
      const list = doc.elementsFromPoint(W / 2, y).filter(e => !root.contains(e) && e !== shade).slice(-6);
      return name + '：' + (list.map(describe).join(' › ') || '（无）');
    };
    const rect = el => { if (!el) return '无'; const b = el.getBoundingClientRect(); return Math.round(b.top) + '～' + Math.round(b.bottom); };
    const sa = doc.createElement('div');
    sa.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    doc.body.appendChild(sa);
    const scs = getComputedStyle(sa), safe = scs.paddingTop + ' / ' + scs.paddingBottom;
    sa.remove();
    return [
      '窗口 ' + W + '×' + H + '，屏幕 ' + screen.width + '×' + screen.height,
      '安全区 上/下 ' + safe,
      'html ' + rect(doc.documentElement) + '，bg1 ' + rect(doc.getElementById('bg1')) + '，bg_custom ' + rect(doc.getElementById('bg_custom')),
      line('顶部', 2), line('中间', H / 2), line('底部', H - 2)
    ].join('\n');
  }

  // ---------- 面板 ----------
  const root = doc.createElement('div');
  root.id = 'bgx-root';
  root.innerHTML = `
<div class="bgx-mask"></div>
<div class="bgx-panel">
  <div class="bgx-head"><span>背景调节器</span><button class="bgx-x">×</button></div>
  <div class="bgx-row">
    <div class="bgx-label"><span>明暗</span><span class="bgx-v-bright"></span></div>
    <input type="range" class="bgx-range bgx-bright" min="20" max="150" step="1">
  </div>
  <div class="bgx-row">
    <div class="bgx-label"><span>朦胧</span><span class="bgx-v-blur"></span></div>
    <input type="range" class="bgx-range bgx-blur" min="0" max="20" step="1">
  </div>
  <div class="bgx-status"></div>
  <div class="bgx-btns"><button class="bgx-btn bgx-reset">恢复默认</button><button class="bgx-btn bgx-probe">检测上下</button></div>
  <div class="bgx-diag"></div>
</div>`;

  let statusEl, inBright, inBlur, vBright, vBlur, mask, panel, diag;
  function setStatus(t) { if (statusEl) statusEl.textContent = t; }
  function fill(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function renderUI(blurDragging) {
    inBright.value = S.bright; inBlur.value = S.blur;
    vBright.textContent = S.bright + '%';
    vBlur.textContent = (S.blur === 0 ? '清晰' : S.blur) + (blurDragging ? ' · 松手后生效' : '');
    fill(inBright); fill(inBlur);
  }
  function openPanel() {
    renderUI(false);
    mask.classList.add('show'); panel.classList.add('show');
    if (window.jQuery) window.jQuery('#extensionsMenu').fadeOut(150);
  }
  function closePanel() { mask.classList.remove('show'); panel.classList.remove('show'); }

  function addMenu(tries) {
    const menu = doc.getElementById('extensionsMenu');
    if (!menu) { if (tries < 10) setTimeout(() => addMenu(tries + 1), 1000); return; }
    if (doc.getElementById('bgx-menu')) return;
    const item = doc.createElement('div');
    item.id = 'bgx-menu';
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.innerHTML = '<div class="fa-solid fa-sliders extensionsMenuExtensionButton"></div><span>背景调节器</span>';
    item.addEventListener('click', openPanel);
    menu.appendChild(item);
  }

  function init() {
    placeShade();
    doc.body.appendChild(root);
    const q = s => root.querySelector(s);
    mask = q('.bgx-mask'); panel = q('.bgx-panel');
    inBright = q('.bgx-bright'); inBlur = q('.bgx-blur');
    vBright = q('.bgx-v-bright'); vBlur = q('.bgx-v-blur');
    statusEl = q('.bgx-status'); diag = q('.bgx-diag');

    inBright.addEventListener('input', () => {
      S.bright = Number(inBright.value); renderUI(false);
      if (appliedUrl && cache.baseUrl && appliedUrl !== cache.baseUrl) writeCss(cache.baseUrl); // 预览时先换回没调明暗的图
      setShade(S.bright);
    });
    inBright.addEventListener('change', () => { save(); commit(); });
    inBlur.addEventListener('input', () => { S.blur = Number(inBlur.value); renderUI(true); });
    inBlur.addEventListener('change', () => { save(); renderUI(false); commit(); });
    q('.bgx-reset').addEventListener('click', () => { S = Object.assign({}, DEF); save(); renderUI(false); setShade(100); commit(); });
    q('.bgx-probe').addEventListener('click', () => {
      try { diag.textContent = probe(); } catch (e) { diag.textContent = '检测出错：' + e.message; }
      diag.classList.add('show');
    });
    mask.addEventListener('click', closePanel);
    q('.bgx-x').addEventListener('click', closePanel);

    addMenu(0);

    // 只在背景被换掉时重新处理
    let t = 0;
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!isDefault()) commit(); }, 400); });
    bgEls().forEach(el => mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] }));

    if (doc.getElementById('bgadj-root') && window.toastr) {
      window.toastr.warning('旧的背景调节器脚本还开着，请到酒馆助手里删掉它');
    }
    if (!isDefault()) setTimeout(commit, 800);
  }

  if (window.jQuery) window.jQuery(init);
  else if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
