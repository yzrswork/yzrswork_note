/* YZRS NOTE — エディタ共有ハブ (core)
 *
 * 既存 editor.js を壊さない「追加専用」の薄い連携層。
 * - 各機能モジュール（storage/history/guides/overflow…）はここに登録する。
 * - editor.js は要所でフックを発火するだけ（onChange / onCardSwitch / onIframeLoad）。
 *
 * ロード順: core.js → editor.js → 各機能モジュール
 * すべて classic script（no build / no module）。
 */
window.YZRS = (function () {
  const changeHooks = [];
  const cardSwitchHooks = [];
  const iframeLoadHooks = [];
  const inspectorRenderHooks = [];

  function run(list, arg) {
    for (const fn of list) {
      try { fn(arg); } catch (e) { console.error('[YZRS hook]', e); }
    }
  }

  const hub = {
    // editor.js が起動時に埋める参照 ─────────
    state: null,
    iframe: null,

    // フィールド単位ロック。実体は locks.js (Task5) が差し込む。
    // 未ロード時は常に false（Core1-4 のガードを壊さない）。
    isLocked() { return false; },
    toggleLock() { /* installed by locks.js */ },

    // history 適用中フラグ（再記録ループ防止）
    _applyingHistory: false,

    // フック登録 ───────────────────────────
    onChange(fn) { changeHooks.push(fn); },
    onCardSwitch(fn) { cardSwitchHooks.push(fn); },
    onIframeLoad(fn) { iframeLoadHooks.push(fn); },
    onInspectorRender(fn) { inspectorRenderHooks.push(fn); },

    // editor.js から発火 ─────────────────────
    _onChange() { run(changeHooks); },
    _onCardSwitch(id) { run(cardSwitchHooks, id); },
    _onIframeLoad(doc) { run(iframeLoadHooks, doc); },
    _onInspectorRender(sel) { run(inspectorRenderHooks, sel); },

    // editor.js が実体を差し込む（モジュールから呼ぶ）─
    applyOverrideToDom: null, // (doc?) => void
    clearSelection: null,     // () => void
    showDirty: null,          // () => void
    switchCard: null,         // (id) => Promise
    setFontSize: null,        // (cssClass, px) => void
    fieldToElements: null,    // (doc, field) => Element[]
  };

  return hub;
})();
