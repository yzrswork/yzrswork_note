/* YZRS NOTE — Task3: Print Guides Overlay
 *
 * A5 印刷事故を防ぐためのガイド表示。エディタUI上にのみ存在し、
 * iframe（=出力HTML）には一切触れない。
 * - オーバーレイ層は iframe の真上に重ね、pointer-events:none で操作を妨げない。
 * - SAFE AREA / CUT LINE / BLEED の3種を描画。
 * - 寸法は A5（148mm×210mm）基準で iframe 幅から mm 換算（macOS 前提の固定値は使わない）。
 */
(function () {
  let on = false;
  const BLEED_MM = 3;
  const SAFE_MM = 5;

  function layer() { return document.getElementById('editor-overlay-layer'); }

  function render() {
    const l = layer();
    if (!l) return;
    const frame = window.YZRS.iframe;
    if (!on || !frame) { l.style.display = 'none'; l.innerHTML = ''; return; }

    const w = frame.clientWidth;
    if (!w) { l.style.display = 'none'; return; }
    const mm = w / 148;                 // 1mm あたりのピクセル
    const cutW = w;
    const cutH = w * (210 / 148);       // A5 縦
    const bleed = BLEED_MM * mm;
    const safe = SAFE_MM * mm;

    l.style.display = 'block';
    l.style.width = cutW + 'px';
    l.style.height = cutH + 'px';
    l.innerHTML = '';

    const rect = (x, y, ww, hh, cls, label) => {
      const d = document.createElement('div');
      d.className = 'guide-rect ' + cls;
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.width = ww + 'px';
      d.style.height = hh + 'px';
      if (label) {
        const s = document.createElement('span');
        s.className = 'guide-label';
        s.textContent = label;
        d.appendChild(s);
      }
      l.appendChild(d);
    };

    rect(-bleed, -bleed, cutW + bleed * 2, cutH + bleed * 2, 'guide-bleed', 'BLEED');
    rect(0, 0, cutW, cutH, 'guide-cut', 'CUT');
    rect(safe, safe, cutW - safe * 2, cutH - safe * 2, 'guide-safe', 'SAFE');
  }

  function toggle(v) {
    on = (v !== undefined) ? v : !on;
    const cb = document.getElementById('toggle-guides');
    if (cb) cb.checked = on;
    render();
  }

  window.YZRS.onIframeLoad(() => render());
  window.addEventListener('resize', render);
  window.YZRS.guides = { toggle, render };

  const cb = document.getElementById('toggle-guides');
  if (cb) cb.addEventListener('change', () => toggle(cb.checked));
})();
