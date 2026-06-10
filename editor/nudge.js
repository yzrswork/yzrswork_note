/* YZRS NOTE — Nudge: 要素の自由移動（Canva/Illustrator 的ドラッグ + 矢印キー）
 *
 * 選択済みのテキスト/★要素を「ドラッグ」または「矢印キー（1px / Shift=10px）」で
 * 位置オフセットする。書込み先は sparse override の `transform` スライス
 * （{ field: {dx, dy} }、px 整数、恒等 0,0 は editor.js の setter が自動削除）。
 *
 * 設計上の位置付け:
 *   - オフセットは CSS transform: translate なので文書フローを変えない
 *     （= overflow 検知や Auto-Fit の計測と干渉しない）。
 *   - iframe DOM は投影のまま。真実は override のみ（undo/redo は history.js が自動処理）。
 *   - 出力HTMLへは generate_pages.py が要素別 STYLE プレースホルダに焼き込む。
 *   - locked フィールドは移動不可。preview モード中は無効。
 *
 * 操作仕様（Canva 準拠）:
 *   - クリック = 選択（既存挙動）。選択済み要素のドラッグ = 移動。
 *   - 3px 未満の動きはクリックとみなしドラッグ扱いしない。
 *   - ドラッグ後の click は editor.js が _suppressNextClick で無視（★誤トグル防止）。
 */
(function () {
  const MOVABLE_KINDS = { text: true, stars: true };

  function st() { return window.YZRS.state; }
  function locked(field) { return window.YZRS.isLocked && window.YZRS.isLocked(field); }

  // Inspector の X/Y 入力をドラッグ/キー操作に追従させる
  function syncInspector(field) {
    const s = st();
    if (!s || !s.selection || s.selection.field !== field) return;
    const t = window.YZRS.getTransform(field);
    const x = document.getElementById('nudge-x');
    const y = document.getElementById('nudge-y');
    if (x) x.value = t.dx;
    if (y) y.value = t.dy;
  }

  // ── ドラッグ移動（iframe 内） ───────────────────────
  window.YZRS.onIframeLoad((doc) => {
    let drag = null;

    doc.addEventListener('mousedown', (e) => {
      const s = st();
      if (!s || s.previewMode) return;
      const node = e.target.closest('[data-editor-field]');
      if (!node || !node.classList.contains('editor-selected')) return;
      const parts = node.getAttribute('data-editor-field').split(':');
      const kind = parts[0], field = parts[1];
      if (!MOVABLE_KINDS[kind] || locked(field)) return;
      const base = window.YZRS.getTransform(field);
      drag = { field: field, sx: e.clientX, sy: e.clientY, dx: base.dx, dy: base.dy, moved: false };
      e.preventDefault();
    });

    doc.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const mx = e.clientX - drag.sx;
      const my = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(mx) + Math.abs(my) < 3) return;
      drag.moved = true;
      window.YZRS.setTransform(drag.field, drag.dx + mx, drag.dy + my);
      syncInspector(drag.field);
    });

    doc.addEventListener('mouseup', () => {
      if (drag && drag.moved) window.YZRS._suppressNextClick = true;
      drag = null;
    });

    // 矢印キーは iframe にフォーカスがある場合もある
    doc.addEventListener('keydown', onKey);
  });

  // ── 矢印キー nudge ─────────────────────────────
  function onKey(e) {
    const s = st();
    if (!s || !s.selection || s.previewMode) return;
    const sel = s.selection;
    if (!MOVABLE_KINDS[sel.kind]) return;
    if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (locked(sel.field)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const cur = window.YZRS.getTransform(sel.field);
    let dx = cur.dx, dy = cur.dy;
    if (e.key === 'ArrowLeft') dx -= step;
    else if (e.key === 'ArrowRight') dx += step;
    else if (e.key === 'ArrowUp') dy -= step;
    else dy += step;
    window.YZRS.setTransform(sel.field, dx, dy);
    syncInspector(sel.field);
  }
  window.addEventListener('keydown', onKey);

  // ── Inspector: 位置オフセット セクション ─────────────
  window.YZRS.onInspectorRender((sel) => {
    if (!sel || !MOVABLE_KINDS[sel.kind]) return;
    const inspector = document.getElementById('inspector');
    if (!inspector) return;
    const isLocked = locked(sel.field);
    const t = window.YZRS.getTransform(sel.field);

    const sec = document.createElement('div');
    sec.className = 'ins-section nudge-section';
    sec.innerHTML =
      '<div class="ins-title">位置オフセット — ' + sel.field + '</div>' +
      '<div class="ins-hint">ドラッグ / 矢印キー=1px / Shift+矢印=10px</div>' +
      '<div class="ins-row"><label>X (px)</label><input type="number" id="nudge-x" step="1" value="' + t.dx + '"></div>' +
      '<div class="ins-row"><label>Y (px)</label><input type="number" id="nudge-y" step="1" value="' + t.dy + '"></div>';

    const x = sec.querySelector('#nudge-x');
    const y = sec.querySelector('#nudge-y');
    const write = () => {
      const dx = parseInt(x.value, 10) || 0;
      const dy = parseInt(y.value, 10) || 0;
      window.YZRS.setTransform(sel.field, dx, dy);
    };
    x.addEventListener('input', write);
    y.addEventListener('input', write);

    const row = document.createElement('div');
    row.className = 'ins-row';
    const reset = document.createElement('button');
    reset.className = 'tb-btn tb-btn-light';
    reset.textContent = '位置をリセット';
    reset.addEventListener('click', () => {
      window.YZRS.setTransform(sel.field, 0, 0);
      x.value = 0; y.value = 0;
    });
    row.appendChild(reset);
    sec.appendChild(row);

    // ロック中は操作不可（locks.js の一括 disable はフック順で先に走っているため自前で行う）
    if (isLocked) {
      sec.querySelectorAll('input, button').forEach((el) => {
        el.disabled = true;
        el.classList.add('is-locked-ctrl');
      });
    }
    inspector.appendChild(sec);
  });
})();
