/* YZRS NOTE — Zoom: ワークスペースのズーム/パン（Canva/Illustrator 的）
 *
 * editor 専用の表示機能。カード（iframe + ガイドオーバーレイを含む .frame-stage）を
 * CSS transform: scale で拡縮する。override / 出力HTML には一切触れない。
 *
 * - ツールバー: − / ＋ / Fit / 1:1（zoom-level に現在倍率を表示）
 * - Ctrl+ホイール: カーソル位置を中心にズーム（キャンバス上・カード上の両方）
 * - 中ボタンドラッグ: パン（キャンバス背景）
 *
 * 注意: iframe 内のマウス座標は transform 前のローカル座標で届くため、
 * ドラッグ系編集（col-divider / nudge）はズーム下でもそのまま正しく動く。
 */
(function () {
  const MIN = 0.25, MAX = 3, STEP = 1.1;
  let z = 1;

  const stage = document.querySelector('.frame-stage');
  const wrap = document.querySelector('.canvas-wrap');
  if (!stage || !wrap) return;

  function baseSize() {
    const f = window.YZRS.iframe || document.getElementById('card-frame');
    return { w: (f && f.offsetWidth) || 600, h: (f && f.offsetHeight) || 1320 };
  }

  function apply() {
    const b = baseSize();
    stage.style.transformOrigin = '0 0';
    stage.style.transform = 'scale(' + z + ')';
    // 視覚サイズに合わせて占有ボックスも更新（スクロール領域を正しく保つ）
    stage.style.width = (b.w * z) + 'px';
    stage.style.height = (b.h * z) + 'px';
    const lbl = document.getElementById('zoom-level');
    if (lbl) lbl.textContent = Math.round(z * 100) + '%';
  }

  // anchor: ビューポート座標（その点が画面上で動かないようにスクロール補正）
  function setZoom(nz, anchor) {
    nz = Math.min(MAX, Math.max(MIN, nz));
    if (nz === z) return;
    const r = wrap.getBoundingClientRect();
    const ax = (anchor ? anchor.x : r.left + r.width / 2) - r.left;
    const ay = (anchor ? anchor.y : r.top + r.height / 2) - r.top;
    const cx = wrap.scrollLeft + ax;
    const cy = wrap.scrollTop + ay;
    const k = nz / z;
    z = nz;
    apply();
    wrap.scrollLeft = cx * k - ax;
    wrap.scrollTop = cy * k - ay;
  }

  function fit() {
    const b = baseSize();
    const aw = wrap.clientWidth - 48;   // padding 24px×2
    const ah = wrap.clientHeight - 48;
    if (aw <= 0 || ah <= 0) return;
    setZoom(Math.min(aw / b.w, ah / b.h));
  }

  // ── ツールバー ───────────────────────────────
  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  on('zoom-in', () => setZoom(z * STEP));
  on('zoom-out', () => setZoom(z / STEP));
  on('zoom-fit', fit);
  on('zoom-100', () => setZoom(1));

  // ── Ctrl+ホイール（キャンバス領域） ─────────────────
  wrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(z * (e.deltaY < 0 ? STEP : 1 / STEP), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // ── Ctrl+ホイール（カード=iframe 内。座標を親座標系に変換） ──
  window.YZRS.onIframeLoad((doc) => {
    doc.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const f = window.YZRS.iframe;
      const fr = f.getBoundingClientRect(); // transform 適用後の矩形
      setZoom(z * (e.deltaY < 0 ? STEP : 1 / STEP),
        { x: fr.left + e.clientX * z, y: fr.top + e.clientY * z });
    }, { passive: false });
    apply(); // リロード後もズーム維持
  });

  // ── 中ボタンドラッグでパン（キャンバス背景） ─────────────
  let pan = null;
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
  });
  window.addEventListener('mousemove', (e) => {
    if (!pan) return;
    wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
    wrap.scrollTop = pan.st - (e.clientY - pan.y);
  });
  window.addEventListener('mouseup', () => { pan = null; });

  window.YZRS.zoom = { set: setZoom, fit: fit, get value() { return z; } };
  apply();
})();
