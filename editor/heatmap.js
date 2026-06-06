/* YZRS NOTE — Task6: Diff Heatmap（override 可視化）
 *
 * どのフィールドに override が乗っているかを editor 上だけで色分け表示する。
 * 検出は「override キーの存在」のみ（DOM 値の差分比較はしない / MutationObserver なし）。
 *
 * 視覚チャネルの分離（優先度順 locked > overflow > heatmap > selected を壊さないため）:
 *   - heatmap は outline を一切使わない。
 *   - text / layout / locked → background tint
 *   - font            → inset box-shadow（背景や outline と共存できる）
 *   これにより locked / overflow / selected の outline は常に heatmap の上に見える。
 *
 * カテゴリ:
 *   text changed   .override-text     rgba(255,0,0,.15)
 *   layout changed .override-layout   rgba(0,100,255,.15)
 *   font changed   .override-font     inset box-shadow rgba(255,200,0,.5)
 *   locked state   .override-locked   rgba(120,120,120,.18)
 *   auto-fit       （Task7 で統合予定。現状は未検出）
 *
 * 出力HTMLには一切痕跡を残さない（iframe へ editor 専用 CSS を注入するのみ）。
 */
(function () {
  let on = false;

  function injectCss(doc) {
    if (!doc || doc.getElementById('__heatmap_css__')) return;
    const style = doc.createElement('style');
    style.id = '__heatmap_css__';
    style.textContent =
      '.override-text{background:rgba(255,0,0,.15) !important;}' +
      '.override-layout{background:rgba(0,100,255,.15) !important;}' +
      '.override-locked{background:rgba(120,120,120,.18) !important;}' +
      '.override-font{box-shadow:inset 0 0 0 3px rgba(255,200,0,.5) !important;}';
    doc.head.appendChild(style);
  }

  function clearClasses(doc) {
    doc.querySelectorAll('.override-text, .override-layout, .override-font, .override-locked')
      .forEach((el) => el.classList.remove('override-text', 'override-layout', 'override-font', 'override-locked'));
  }

  function refresh() {
    const frame = window.YZRS.iframe;
    const doc = frame && frame.contentDocument;
    if (!doc) return;
    clearClasses(doc);
    if (!on) return;

    const ov = (window.YZRS.state && window.YZRS.state.override) || {};
    const f2e = (field) => (window.YZRS.fieldToElements ? window.YZRS.fieldToElements(doc, field) : []);

    // text changed（override.text のキー存在のみで判定）
    const t = ov.text || {};
    Object.keys(t).forEach((field) => f2e(field).forEach((el) => el.classList.add('override-text')));

    // font changed（override.font_size のキー = CSSクラス名）
    const fs = ov.font_size || {};
    Object.keys(fs).forEach((cls) => {
      doc.querySelectorAll('.' + cls).forEach((el) => el.classList.add('override-font'));
    });

    // layout changed
    if (ov.layout && Object.keys(ov.layout).length) {
      const body = doc.querySelector('.body');
      if (body) body.classList.add('override-layout');
      const divider = doc.querySelector('.col-divider');
      if (divider) divider.classList.add('override-layout');
    }

    // locked state
    const L = ov.locks || {};
    Object.keys(L).forEach((field) => f2e(field).forEach((el) => el.classList.add('override-locked')));

    // auto-fit adjusted: Task7 で override に印が付いたらここで検出する（現状なし）
  }

  function toggle(v) {
    on = (v !== undefined) ? v : !on;
    const cb = document.getElementById('toggle-heatmap');
    if (cb) cb.checked = on;
    refresh();
  }

  window.YZRS.onIframeLoad((doc) => { injectCss(doc); refresh(); });
  window.YZRS.onChange(refresh);
  window.YZRS.heatmap = { toggle, refresh };

  const cb = document.getElementById('toggle-heatmap');
  if (cb) cb.addEventListener('change', () => toggle(cb.checked));
})();
