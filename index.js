(() => {
  'use strict';
  const doc = document;
  const KEY = 'bg_adjuster_v4';        // 沿用旧版的明暗/朦胧设置
  const MAP_KEY = 'bg_adjuster_dims';  // 生成的图 → 原图
  const PREFIX = 'tt-dim-';
  const MAX_SIDE = 2560;
  const DEF = { bright: 100, blur: 0 };
  const STILL = /\.(jpe?g|png|webp|bmp|avif)$/i;
  const num = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // ---------- 设置 ----------
  const raw = read(KEY, {});
  let S = { bright: num(raw.bright, 20, 150, 100), blur: num(raw.blur, 0, 20, 0) };
  const save = () => write(KEY, S);
  let MAP = read(MAP_KEY, {});
  if (typeof MAP !== 'object' || Array.isArray(MAP)) MAP = {};
  const saveMap = () => write(MAP_KEY, MAP);
  const isDefault = () => S.bright === 100 && S.blur === 0;

  // ---------- 读取当前背景 ----------
  const live = doc.createElement('style');
  live.id = 'bgx-live';
  const bg1 = () => doc.getElementById('bg1');
  function parseBg(css) {
    const m = /url\(\s*["']?(.*?)["']?\s*\)/.exec(css || '');
    if (!m) return null;
    try {
      const u = new URL(m[1], location.href);
      const i = u.pathname.lastIndexOf('/backgrounds/');
      if (i < 0) return null;
      return { name: decodeURIComponent(u.pathname.slice(i + 13)), url: u.href };
    } catch (e) { return null; }
  }
  // 酒馆和 TT 换背景都写在 #bg1 的内联样式里，预览 CSS 不会影响这里
  function current() {
    const el = bg1();
    if (!el) return null;
    return parseBg(el.style.backgroundImage) || (live.textContent ? null : parseBg(getComputedStyle(el).backgroundImage));
  }
  const curName = () => (current() || {}).name || '';
  function locked() {
    const el = doc.getElementById('bg_custom');
    return !!el && getComputedStyle(el).backgroundImage !== 'none';
  }

  // ---------- 拖动时的即时预览（只影响中间） ----------
  let switching = null; // 切换中：记录切换前的背景名
  const cssUrl = u => 'url("' + String(u).replace(/["\\\n\r]/g, encodeURIComponent) + '")';
  function filterCss() {
    const f = [];
    if (S.bright !== 100) f.push('brightness(' + S.bright / 100 + ')');
    if (S.blur > 0) f.push('blur(' + S.blur + 'px)');
    if (!f.length) return '';
    const scale = S.blur > 0 ? 1 + 4 * S.blur / Math.min(innerWidth, innerHeight) : 1;
    return 'filter:' + f.join(' ') + ' !important;' + (scale > 1 ? 'scale:' + scale.toFixed(3) + ' !important;' : '');
  }
  function paintPreview() {
    const cur = curName(), entry = MAP[cur];
    let css = '';
    if (locked()) css = filterCss() ? '#bg_custom{' + filterCss() + '}' : '';
    else if (switching !== null && cur !== switching) css = ''; // 让 TT 读到干净的新图
    else if (entry) {
      if (entry.bright !== S.bright || entry.blur !== S.blur)
        css = '#bg1{background-image:' + cssUrl(entry.origUrl) + ' !important;' + filterCss() + '}';
    } else if (!isDefault()) css = '#bg1{' + filterCss() + '}';
    if (live.textContent !== css) live.textContent = css;
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paintPreview(); }); };

  // ---------- 生成调好的图片 ----------
  const loadImg = url => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('读不到原图。'));
    i.src = url;
  });
  function resize(src, w, h) {
    const c = doc.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    return c;
  }
  // 三次方框模糊叠加，效果接近 CSS 的 blur()
  function boxSizes(sigma, n) {
    const ideal = Math.sqrt(12 * sigma * sigma / n + 1);
    let wl = Math.floor(ideal); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const out = [];
    for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
    return out;
  }
  function boxH(src, dst, w, h, r) {
    const inv = 1 / (r + r + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[o + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        dst[o + x] = acc * inv;
        acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
      }
    }
  }
  function boxV(src, dst, w, h, r) {
    const inv = 1 / (r + r + 1);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = acc * inv;
        acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  }
  async function render(url, want, name) {
    const img = await loadImg(url);
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.max(1, Math.round(img.naturalWidth * k)), H = Math.max(1, Math.round(img.naturalHeight * k));
    const c = resize(img, W, H);
    const g = c.getContext('2d');
    const id = g.getImageData(0, 0, W, H), d = id.data, N = W * H;
    // 和 CSS blur 同样的强度：图铺满屏幕时，1 个屏幕像素 = 1/shown 个图片像素
    const shown = Math.max(innerWidth / W, innerHeight / H);
    const sigma = want.blur > 0 ? want.blur / shown : 0;
    const sizes = sigma > 0.5 ? boxSizes(sigma, 3) : [];
    const b = want.bright / 100;
    const a = new Float32Array(N), t = new Float32Array(N);
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < N; i++) a[i] = d[i * 4 + ch];
      for (const s of sizes) { const r = (s - 1) >> 1; boxH(a, t, W, H, r); boxV(t, a, W, H, r); }
      // 调明暗，再加一点点噪点，防止暗色渐变压出色阶
      for (let i = 0; i < N; i++) d[i * 4 + ch] = a[i] * b + Math.random() - 0.5;
    }
    for (let i = 0; i < N; i++) d[i * 4 + 3] = 255;
    g.putImageData(id, 0, 0);
    const blob = await new Promise((res, rej) =>
      c.toBlob(x => x ? res(x) : rej(new Error('图片生成失败。')), 'image/jpeg', 0.95));
    return new File([blob], name, { type: 'image/jpeg' });
  }

  // ---------- 通过酒馆自己的流程换背景 ----------
  const waitFor = (test, ms, msg) => new Promise((res, rej) => {
    const end = Date.now() + ms;
    (function tick() {
      if (test()) return res();
      if (Date.now() > end) return rej(new Error(msg));
      setTimeout(tick, 150);
    })();
  });
  function release() { setTimeout(() => { switching = null; paintPreview(); }, 400); }

  async function uploadAndSwitch(file) {
    const input = doc.getElementById('add_bg_button');
    if (!(input instanceof HTMLInputElement) || typeof DataTransfer !== 'function')
      throw new Error('找不到酒馆的背景上传入口。');
    const before = curName();
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    switching = before;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      await waitFor(() => { const n = curName(); return n !== before && n.startsWith(PREFIX); },
        30000, '上传后没有切换到新背景。');
    } finally { release(); }
    return curName();
  }

  async function switchTo(name) {
    const el = [...doc.querySelectorAll('.bg_example[bgfile]')].find(e =>
      e.getAttribute('bgfile') === name && e.getAttribute('custom') !== 'true' && !e.closest('#background_template'));
    if (!el) throw new Error('背景列表里找不到原图「' + name + '」，请手动点一下它。');
    switching = curName();
    el.click();
    try { await waitFor(() => curName() === name, 10000, '没能换回原图，请手动点一下它。'); }
    finally { release(); }
  }

  // 只删调节器自己生成的图
  async function cleanup(keep) {
    const ctx = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext();
    const headers = ctx && ctx.getRequestHeaders && ctx.getRequestHeaders();
    if (!headers) return;
    for (const name of Object.keys(MAP)) {
      if (name === keep || name === curName()) continue;
      try {
        const r = await fetch('/api/backgrounds/delete', { method: 'POST', headers, body: JSON.stringify({ bg: name }) });
        if (!r.ok && r.status !== 400 && r.status !== 404) continue;
      } catch (e) { continue; }
      delete MAP[name];
      doc.querySelectorAll('.bg_example[bgfile]').forEach(e => { if (e.getAttribute('bgfile') === name) e.remove(); });
    }
    saveMap();
  }

  // ---------- 同步流程 ----------
  let busy = false, again = false, timer = 0;
  const later = (ms = 500) => { clearTimeout(timer); timer = setTimeout(sync, ms); };
  async function sync() {
    if (busy) { again = true; return; }
    busy = true;
    try { await syncOnce(); }
    catch (e) { console.warn('[背景调节器]', e); setStatus(e.message || String(e), true); }
    busy = false;
    if (again) { again = false; later(100); }
  }

  async function syncOnce() {
    paintPreview();
    if (locked()) return setStatus('这个聊天锁定了背景，只能调中间，上下两条跟不上。');
    const cur = current();
    if (!cur) return setStatus('没读到当前背景。');
    const entry = MAP[cur.name];
    if (cur.name.startsWith(PREFIX) && !entry)
      return setStatus('当前背景是调节器生成的，但找不到对应原图。请在背景列表里重新点一下原图。', true);
    const orig = entry ? { name: entry.orig, url: entry.origUrl } : cur;

    if (isDefault()) {
      if (entry) { setStatus('正在换回原图…'); await switchTo(orig.name); }
      await cleanup(curName());
      return setStatus('');
    }
    if (entry && entry.bright === S.bright && entry.blur === S.blur) {
      await cleanup(cur.name);
      return setStatus('已同步，上下两条也调好了。');
    }
    if (!STILL.test(orig.name)) return setStatus('动图和视频背景只能调中间。');

    const want = { bright: S.bright, blur: S.blur };
    setStatus('正在生成调好的背景…');
    const name = PREFIX + Date.now().toString(36) + '.jpg';
    const file = await render(orig.url, want, name);
    // 生成期间又拖了滑块或换了背景，就按最新的重来
    if (want.bright !== S.bright || want.blur !== S.blur || curName() !== cur.name) { again = true; return; }
    MAP[name] = { orig: orig.name, origUrl: orig.url, bright: want.bright, blur: want.blur };
    saveMap();
    setStatus('正在上传并切换…');
    const got = await uploadAndSwitch(file);
    if (got !== name) { MAP[got] = MAP[name]; delete MAP[name]; saveMap(); }
    await cleanup(got);
    setStatus('已同步，上下两条也调好了。');
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
  <div class="bgx-btns"><button class="bgx-btn bgx-reset">恢复默认</button></div>
  <div class="bgx-info"></div>
</div>`;
  const q = s => root.querySelector(s);

  function setStatus(text, err) {
    const el = q('.bgx-info');
    el.textContent = text || '';
    el.classList.toggle('err', !!err);
  }
  function fill(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function renderUI() {
    q('.bgx-bright').value = S.bright; q('.bgx-blur').value = S.blur;
    q('.bgx-v-bright').textContent = S.bright + '%';
    q('.bgx-v-blur').textContent = S.blur === 0 ? '清晰' : String(S.blur);
    fill(q('.bgx-bright')); fill(q('.bgx-blur'));
  }
  function openPanel() {
    renderUI();
    q('.bgx-mask').classList.add('show'); q('.bgx-panel').classList.add('show');
    if (window.jQuery) window.jQuery('#extensionsMenu').fadeOut(150);
  }
  function closePanel() { q('.bgx-mask').classList.remove('show'); q('.bgx-panel').classList.remove('show'); }

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

  function watch() {
    const onChange = () => { paintPreview(); later(); };
    const el = bg1();
    if (el) new MutationObserver(onChange).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    const bc = doc.getElementById('bg_custom');
    if (bc) new MutationObserver(onChange).observe(bc, { attributes: true, attributeFilter: ['style'] });
  }

  function init() {
    doc.head.appendChild(live);
    doc.body.appendChild(root);

    const slide = k => e => { S[k] = Number(e.target.value); renderUI(); schedule(); };
    const commit = () => { save(); setStatus('松手后稍等一下…'); later(600); };
    q('.bgx-bright').addEventListener('input', slide('bright'));
    q('.bgx-blur').addEventListener('input', slide('blur'));
    q('.bgx-bright').addEventListener('change', commit);
    q('.bgx-blur').addEventListener('change', commit);
    q('.bgx-reset').addEventListener('click', () => { S = Object.assign({}, DEF); save(); renderUI(); paintPreview(); later(100); });
    q('.bgx-mask').addEventListener('click', closePanel);
    q('.bgx-x').addEventListener('click', closePanel);

    watch();
    paintPreview();
    setTimeout(sync, 1500); // 等酒馆把背景和背景列表加载好
    addEventListener('resize', schedule);
    addMenu(0);
  }

  if (window.jQuery) window.jQuery(init);
  else if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
