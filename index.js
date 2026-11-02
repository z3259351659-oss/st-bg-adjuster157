(() => {
  'use strict';
  const doc = document;
  const KEY = 'bg_adjuster_v2';
  const DEF = { bright: 100, blur: 0 };
  const TAG = /_b\d+_m\d+$/;

  // ---------- 设置 ----------
  const num = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };
  let S;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = Object.assign({}, DEF); }
  S.bright = num(S.bright, 20, 150, 100);
  S.blur = num(S.blur, 0, 20, 0);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const shadeColor = v => v < 100
    ? 'rgba(0,0,0,' + ((100 - v) / 100).toFixed(3) + ')'
    : 'rgba(255,255,255,' + ((v - 100) / 100 * 0.6).toFixed(3) + ')';

  // ---------- 读当前背景 ----------
  function readSource() {
    for (const id of ['bg_custom', 'bg1']) {
      const el = doc.getElementById(id);
      if (!el) continue;
      const m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(getComputedStyle(el).backgroundImage || '');
      if (m && m[2]) return new URL(m[2], location.href).href;
    }
    return null;
  }
  function baseName(url) {
    let n = '';
    try { n = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch (e) {}
    return n.replace(/\.[^.]*$/, '');
  }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      if (new URL(url).origin !== location.origin) im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('load'));
      im.src = url;
    });
  }

  // ---------- 模糊（三次盒式，接近高斯） ----------
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
  function blurCanvas(c, r) {
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data, tmp = new Uint8ClampedArray(px.length);
    for (let i = 0; i < 3; i++) {
      blurPass(px, tmp, c.width, c.height, r, 4, c.width * 4);
      blurPass(tmp, px, c.height, c.width, r, c.width * 4, 4);
    }
    ctx.putImageData(data, 0, 0);
  }

  // ---------- 预览（只画面板里的小图，不碰真背景） ----------
  let src = '', img = null, pv = null;
  function preparePreview(cv) {
    const d = Math.min(2, devicePixelRatio || 1);
    const cw = Math.round((cv.clientWidth || 264) * d), ch = Math.round(140 * d);
    cv.width = cw; cv.height = ch;
    const base = doc.createElement('canvas');
    base.width = cw; base.height = ch;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sp = Math.max(cw / iw, ch / ih);
    const bctx = base.getContext('2d');
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(img, (cw - iw * sp) / 2, (ch - ih * sp) / 2, iw * sp, ih * sp);
    const sf = Math.max(innerWidth / iw, innerHeight / ih); // 原图在屏幕上的缩放
    pv = { cv, base, ratio: sp / sf, blur: -1, blurred: null };
  }
  function drawPreview() {
    if (!pv) return;
    if (pv.blur !== S.blur) {
      if (S.blur === 0) pv.blurred = pv.base;
      else {
        const c = doc.createElement('canvas');
        c.width = pv.base.width; c.height = pv.base.height;
        c.getContext('2d').drawImage(pv.base, 0, 0);
        blurCanvas(c, Math.max(1, Math.round(S.blur * pv.ratio)));
        pv.blurred = c;
      }
      pv.blur = S.blur;
    }
    const ctx = pv.cv.getContext('2d');
    ctx.drawImage(pv.blurred, 0, 0);
    if (S.bright !== 100) { ctx.fillStyle = shadeColor(S.bright); ctx.fillRect(0, 0, pv.cv.width, pv.cv.height); }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawPreview(); }); };

  // ---------- 导出整张图 ----------
  async function exportFile() {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const k = Math.min(1, (S.blur > 0 ? 1440 : 2560) / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const c = doc.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    if (S.blur > 0) {
      const disp = Math.max(innerWidth / w, innerHeight / h);
      blurCanvas(c, Math.max(1, Math.round(S.blur / disp)));
    }
    if (S.bright !== 100) { ctx.fillStyle = shadeColor(S.bright); ctx.fillRect(0, 0, w, h); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) throw new Error('blob');
    const base = baseName(src).replace(TAG, '').replace(/[^A-Za-z0-9_-]/g, '') || 'bg';
    const name = base + '_b' + S.bright + '_m' + S.blur + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  }

  // 优先走酒馆自己的上传按钮：上传、换背景、刷新列表都由酒馆完成
  async function upload(file) {
    const input = doc.querySelector('#add_bg_button') || doc.querySelector('#form_bg_download input[type=file]');
    if (input && window.DataTransfer) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'native';
    }
    const ctx = window.SillyTavern && window.SillyTavern.getContext ? window.SillyTavern.getContext() : null;
    const headers = Object.assign({}, ctx && ctx.getRequestHeaders ? ctx.getRequestHeaders() : {});
    delete headers['Content-Type'];
    const fd = new FormData();
    fd.append('avatar', file);
    const r = await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: fd });
    if (!r.ok) throw new Error('upload ' + r.status);
    return 'api';
  }

  // ---------- 面板 ----------
  const root = doc.createElement('div');
  root.id = 'bgx-root';
  root.innerHTML = `
<div class="bgx-mask"></div>
<div class="bgx-panel">
  <div class="bgx-head"><span>背景调节器</span><button class="bgx-x">×</button></div>
  <canvas class="bgx-pv"></canvas>
  <div class="bgx-row">
    <div class="bgx-label"><span>明暗</span><span class="bgx-v-bright"></span></div>
    <input type="range" class="bgx-range bgx-bright" min="20" max="150" step="1">
  </div>
  <div class="bgx-row">
    <div class="bgx-label"><span>朦胧</span><span class="bgx-v-blur"></span></div>
    <input type="range" class="bgx-range bgx-blur" min="0" max="20" step="1">
  </div>
  <div class="bgx-status"></div>
  <div class="bgx-btns"><button class="bgx-btn bgx-reset">重置</button><button class="bgx-btn bgx-main bgx-save">保存为新背景</button></div>
</div>`;
  const q = s => root.querySelector(s);
  let busy = false;
  const setStatus = t => { q('.bgx-status').textContent = t; };
  function fill(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function renderUI() {
    q('.bgx-bright').value = S.bright; q('.bgx-blur').value = S.blur;
    q('.bgx-v-bright').textContent = S.bright + '%';
    q('.bgx-v-blur').textContent = S.blur === 0 ? '清晰' : String(S.blur);
    fill(q('.bgx-bright')); fill(q('.bgx-blur'));
  }

  async function openPanel() {
    renderUI();
    q('.bgx-mask').classList.add('show'); q('.bgx-panel').classList.add('show');
    if (window.jQuery) window.jQuery('#extensionsMenu').fadeOut(150);
    pv = null;
    const u = readSource();
    if (!u) { setStatus('没找到当前背景（视频背景不支持）'); return; }
    setStatus('读取背景…');
    try {
      if (u !== src || !img) { img = await loadImage(u); src = u; }
      preparePreview(q('.bgx-pv'));
      drawPreview();
      setStatus(TAG.test(baseName(src)) ? '这张已经调过，再调会叠加。想从原图调，先在背景里选回原图' : '');
    } catch (e) {
      img = null;
      setStatus('这张背景读不了（可能是外部链接）');
    }
  }
  function closePanel() { q('.bgx-mask').classList.remove('show'); q('.bgx-panel').classList.remove('show'); }

  async function onSave() {
    if (busy) return;
    if (!img) { setStatus('还没读到背景，关掉面板再打开试试'); return; }
    if (S.bright === 100 && S.blur === 0) { setStatus('现在就是原图，不用保存'); return; }
    busy = true;
    q('.bgx-save').disabled = true;
    setStatus('处理中…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const file = await exportFile();
      const how = await upload(file);
      if (how === 'native') {
        setStatus('上传中…');
        const want = file.name.replace(/\.jpg$/, '');
        let n = 0;
        const t = setInterval(() => {
          const now = readSource();
          if (now && baseName(now) === want) { clearInterval(t); src = now; setStatus('已换成 ' + file.name); }
          else if (++n > 20) { clearInterval(t); setStatus('已上传 ' + file.name + '，没自动换的话到背景里点一下它'); }
        }, 500);
      } else {
        setStatus('已上传 ' + file.name + '，到背景里点一下它');
      }
    } catch (e) {
      console.warn('[背景调节器]', e);
      setStatus('保存失败：' + e.message);
    } finally {
      busy = false;
      q('.bgx-save').disabled = false;
    }
  }

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
    doc.body.appendChild(root);
    q('.bgx-bright').addEventListener('input', e => { S.bright = Number(e.target.value); renderUI(); schedule(); });
    q('.bgx-blur').addEventListener('input', e => { S.blur = Number(e.target.value); renderUI(); schedule(); });
    q('.bgx-bright').addEventListener('change', save);
    q('.bgx-blur').addEventListener('change', save);
    q('.bgx-reset').addEventListener('click', () => { S = Object.assign({}, DEF); save(); renderUI(); schedule(); });
    q('.bgx-save').addEventListener('click', onSave);
    q('.bgx-mask').addEventListener('click', closePanel);
    q('.bgx-x').addEventListener('click', closePanel);
    addMenu(0);
  }

  if (window.jQuery) window.jQuery(init);
  else if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
