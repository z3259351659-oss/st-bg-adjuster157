(() => {
  'use strict';
  const doc = document;
  const KEY = 'bg_adjuster_v4';
  const DEF = { bright: 100, blur: 0, edge: 'follow', color: '#1f1f1f' };
  const num = (v, a, b, d) => { v = Number(v); return isFinite(v) ? Math.min(b, Math.max(a, Math.round(v))) : d; };

  // ---------- 设置 ----------
  let S;
  try { S = Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { S = Object.assign({}, DEF); }
  S.bright = num(S.bright, 20, 150, 100);
  S.blur = num(S.blur, 0, 20, 0);
  if (S.edge !== 'color') S.edge = 'follow';
  if (!/^#[0-9a-f]{6}$/i.test(S.color)) S.color = DEF.color;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  // ---------- 背景滤镜 + 上下色块 ----------
  const live = doc.createElement('style');
  live.id = 'bgx-live';
  const edgeTop = doc.createElement('div');
  const edgeBot = doc.createElement('div');
  edgeTop.className = edgeBot.className = 'bgx-edge';
  let scale = 1;

  // bg1 未放大时的位置（TT 会把它拉伸到刘海和底部横条里）
  function bgBox() {
    const el = doc.getElementById('bg1');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cy = (r.top + r.bottom) / 2, hh = r.height / scale / 2;
    return { top: cy - hh, bottom: cy + hh, width: r.width / scale, height: r.height / scale };
  }

  function placeEdges(box) {
    const on = S.edge === 'color' && box;
    const t = on ? Math.max(0, Math.round(-box.top)) : 0;
    const b = on ? Math.max(0, Math.round(box.bottom - innerHeight)) : 0;
    edgeTop.style.cssText = t ? 'top:' + (-t) + 'px;height:' + t + 'px;background:' + S.color : 'display:none';
    edgeBot.style.cssText = b ? 'top:' + innerHeight + 'px;height:' + b + 'px;background:' + S.color : 'display:none';
  }

  function apply() {
    const box = bgBox();
    const f = [];
    if (S.bright !== 100) f.push('brightness(' + (S.bright / 100) + ')');
    if (S.blur > 0) f.push('blur(' + S.blur + 'px)');
    // 模糊会让边缘发虚，稍微放大一点把虚边推到屏幕外
    const base = box ? Math.min(box.width, box.height) : Math.min(innerWidth, innerHeight);
    scale = S.blur > 0 ? 1 + 4 * S.blur / base : 1;
    live.textContent = f.length
      ? '#bg1,#bg_custom{filter:' + f.join(' ') + ' !important;' +
        (scale > 1 ? 'scale:' + scale.toFixed(3) + ' !important;' : '') + '}'
      : '';
    placeEdges(box);
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(); }); };

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
  <div class="bgx-row">
    <div class="bgx-label"><span>上下两条</span></div>
    <div class="bgx-seg">
      <button class="bgx-btn bgx-e-follow">跟随背景</button>
      <button class="bgx-btn bgx-e-color">纯色</button>
      <input type="color" class="bgx-color">
    </div>
  </div>
  <div class="bgx-btns"><button class="bgx-btn bgx-reset">恢复默认</button><button class="bgx-btn bgx-detect">检测上下</button></div>
  <div class="bgx-info"></div>
</div>`;
  const q = s => root.querySelector(s);

  function fill(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); }
  function renderUI() {
    q('.bgx-bright').value = S.bright; q('.bgx-blur').value = S.blur;
    q('.bgx-v-bright').textContent = S.bright + '%';
    q('.bgx-v-blur').textContent = S.blur === 0 ? '清晰' : String(S.blur);
    fill(q('.bgx-bright')); fill(q('.bgx-blur'));
    q('.bgx-e-follow').classList.toggle('on', S.edge === 'follow');
    q('.bgx-e-color').classList.toggle('on', S.edge === 'color');
    q('.bgx-color').value = S.color;
    q('.bgx-color').style.display = S.edge === 'color' ? '' : 'none';
  }

  function detect() {
    const box = bgBox();
    const bg = doc.getElementById('bg1'), bc = doc.getElementById('bg_custom');
    const rootCs = getComputedStyle(doc.documentElement);
    const v = n => rootCs.getPropertyValue(n).trim() || '无';
    q('.bgx-info').textContent = [
      '窗口 ' + innerWidth + '×' + innerHeight + '，屏幕 ' + screen.width + '×' + screen.height,
      box ? 'bg1 上沿 ' + Math.round(box.top) + '，下沿 ' + Math.round(box.bottom) : '没找到 bg1',
      'TT 变量 上 ' + v('--tt-inset-top') + ' / 下 ' + v('--tt-inset-bottom'),
      'bg1 滤镜 ' + (bg ? getComputedStyle(bg).filter : '-'),
      'bg_custom ' + (bc && getComputedStyle(bc).backgroundImage !== 'none' ? '有图' : '无'),
      '色块 上 ' + edgeTop.offsetHeight + 'px / 下 ' + edgeBot.offsetHeight + 'px',
    ].join('\n');
  }

  function openPanel() {
    renderUI();
    q('.bgx-info').textContent = '';
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

  function init() {
    doc.head.appendChild(live);
    doc.body.appendChild(edgeTop);
    doc.body.appendChild(edgeBot);
    doc.body.appendChild(root);

    q('.bgx-bright').addEventListener('input', e => { S.bright = Number(e.target.value); renderUI(); schedule(); });
    q('.bgx-blur').addEventListener('input', e => { S.blur = Number(e.target.value); renderUI(); schedule(); });
    q('.bgx-bright').addEventListener('change', save);
    q('.bgx-blur').addEventListener('change', save);
    q('.bgx-e-follow').addEventListener('click', () => { S.edge = 'follow'; save(); renderUI(); apply(); });
    q('.bgx-e-color').addEventListener('click', () => { S.edge = 'color'; save(); renderUI(); apply(); });
    q('.bgx-color').addEventListener('input', e => { S.color = e.target.value; schedule(); });
    q('.bgx-color').addEventListener('change', save);
    q('.bgx-reset').addEventListener('click', () => { S = Object.assign({}, DEF); save(); renderUI(); apply(); });
    q('.bgx-detect').addEventListener('click', detect);
    q('.bgx-mask').addEventListener('click', closePanel);
    q('.bgx-x').addEventListener('click', closePanel);

    apply();
    setTimeout(apply, 1500); // TT 可能稍后才把 bg1 拉伸到全屏
    addEventListener('resize', schedule);
    addMenu(0);
  }

  if (window.jQuery) window.jQuery(init);
  else if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
