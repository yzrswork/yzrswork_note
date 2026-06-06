/* YZRS NOTE — Task5: Lock System（フィールド単位ロック）
 *
 * 確定済みフィールドの誤編集を防ぐ。
 * - ロック状態は sparse override の `locks` スライスに保存（{ field: true } のみ）。
 *   → save/load・undo/redo・session restore すべてに自然に追従する。
 * - 編集の拒否は「Inspector のコントロール無効化」＋「iframe側操作のガード」で実現。
 *   （setter を握り潰すのではなく、操作の起点を塞ぐ）
 *
 * API:
 *   YZRS.isLocked(field)   → boolean
 *   YZRS.toggleLock(field) → ロック反転（dirty/履歴/可視化に反映）
 *
 * iframe には editor 専用 CSS のみ注入し、出力HTMLには一切痕跡を残さない。
 */
(function () {
  function st() { return window.YZRS.state; }

  function locks() {
    const s = st();
    return (s && s.override && s.override.locks) || {};
  }

  function isLocked(field) { return !!locks()[field]; }

  function toggleLock(field) {
    if (!field) return;
    const s = st();
    if (!s.override.schema_version) {
      s.override = { id: s.currentId, schema_version: 1 };
    }
    s.override.locks = s.override.locks || {};
    if (s.override.locks[field]) {
      delete s.override.locks[field];
      if (!Object.keys(s.override.locks).length) delete s.override.locks;
    } else {
      s.override.locks[field] = true;
    }
    // dirty 再計算 + onChange 発火（履歴記録・可視化更新を含む）
    if (window.YZRS.showDirty) window.YZRS.showDirty();
    applyMarkers();
    if (s.selection) refreshInspectorLockUI(s.selection);
  }

  // ── iframe マーカー（editor 専用） ─────────────────
  function injectCss(doc) {
    if (!doc || doc.getElementById('__locks_css__')) return;
    const style = doc.createElement('style');
    style.id = '__locks_css__';
    style.textContent =
      '.__locked__{outline:2px dotted rgba(110,110,110,.9) !important;' +
      'outline-offset:1px;cursor:not-allowed !important;}';
    doc.head.appendChild(style);
  }

  function applyMarkers() {
    const frame = window.YZRS.iframe;
    const doc = frame && frame.contentDocument;
    if (!doc) return;
    doc.querySelectorAll('.__locked__').forEach((el) => el.classList.remove('__locked__'));
    const L = locks();
    Object.keys(L).forEach((field) => {
      const els = window.YZRS.fieldToElements ? window.YZRS.fieldToElements(doc, field) : [];
      els.forEach((el) => el.classList.add('__locked__'));
    });
  }

  // ── Inspector のロックUI ───────────────────────
  function renderLockControl(sel) {
    const inspector = document.getElementById('inspector');
    if (!inspector || !sel || !sel.field) return;
    const field = sel.field;
    const locked = isLocked(field);
    const sec = document.createElement('div');
    sec.className = 'ins-section lock-section';
    sec.innerHTML = '<div class="ins-title">ロック — ' + field + '</div>';
    const btn = document.createElement('button');
    btn.className = 'lock-btn tb-btn-light' + (locked ? ' locked' : '');
    btn.textContent = locked ? '🔒 ロック解除' : '🔓 このフィールドをロック';
    btn.addEventListener('click', () => toggleLock(field));
    sec.appendChild(btn);
    inspector.insertBefore(sec, inspector.firstChild);
  }

  function applySelectionLock(sel) {
    const inspector = document.getElementById('inspector');
    if (!inspector || !sel || !sel.field) return;
    const locked = isLocked(sel.field);
    inspector.querySelectorAll('input, textarea, button, select').forEach((el) => {
      if (el.classList.contains('lock-btn')) return; // ロックトグルは常に操作可能
      el.disabled = locked;
      el.classList.toggle('is-locked-ctrl', locked);
    });
  }

  function refreshInspectorLockUI(sel) {
    const inspector = document.getElementById('inspector');
    const existing = inspector && inspector.querySelector('.lock-section');
    if (existing) existing.remove();
    renderLockControl(sel);
    applySelectionLock(sel);
  }

  // ── 公開・購読 ───────────────────────────────
  window.YZRS.isLocked = isLocked;
  window.YZRS.toggleLock = toggleLock;

  window.YZRS.onInspectorRender((sel) => {
    if (!sel || !sel.field) return;
    renderLockControl(sel);
    applySelectionLock(sel);
  });
  window.YZRS.onIframeLoad((doc) => { injectCss(doc); applyMarkers(); });
  window.YZRS.onChange(applyMarkers);

  window.YZRS.locks = { applyMarkers, isLocked, toggleLock };
})();
