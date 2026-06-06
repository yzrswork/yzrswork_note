/* YZRS NOTE — Task2: Undo / Redo
 *
 * override 状態のみをスナップショットする（iframe DOM ツリーは保存しない）。
 * - 最大50状態 / イミュータブル（structuredClone、無ければ JSON ディープコピー）
 * - 入力連打は debounce(350ms) でまとめ、1ステップ=1スナップショット
 * - 復元時は editor.js の applyOverrideToDom で iframe に反映（リロードしない）
 *
 * 編集保護状態（locks）は「コンテンツ状態」ではないため履歴の対象外。
 * スナップショットからは locks を除外し、undo/redo 適用時は「現在のロック」を
 * そのまま温存する（＝undo はコンテンツ/レイアウト編集のみを巻き戻す）。
 * locks 自体の永続化は sparse override の save/load が引き続き担当する。
 *
 * ショートカット:
 *   Windows: Ctrl+Z / Ctrl+Y    Mac: Cmd+Z / Shift+Cmd+Z
 */
(function () {
  const MAX = 50;
  const NON_HISTORICAL = ['locks']; // 履歴に含めない override スライス（編集保護状態）
  let undoStack = [];
  let redoStack = [];
  let present = null;      // 確定済みの現在スナップショット（locks 除外）
  let timer = null;

  function clone(o) {
    try { return structuredClone(o); }
    catch (e) { return JSON.parse(JSON.stringify(o)); }
  }
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // locks 等の非履歴スライスを除いたディープコピー
  function historical(ov) {
    const c = clone(ov || {});
    for (const k of NON_HISTORICAL) delete c[k];
    return c;
  }

  function commitPending() {
    const cur = historical((window.YZRS.state && window.YZRS.state.override) || {});
    if (present !== null && eq(cur, present)) return; // locks だけの変更はここで no-op
    if (present !== null) {
      undoStack.push(present);
      if (undoStack.length > MAX) undoStack.shift();
    }
    present = cur;
    redoStack = [];
  }

  function record() {
    if (window.YZRS._applyingHistory) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; commitPending(); }, 350);
  }

  function reset() {
    clearTimeout(timer); timer = null;
    undoStack = [];
    redoStack = [];
    present = historical((window.YZRS.state && window.YZRS.state.override) || {});
  }

  function apply(target) {
    window.YZRS._applyingHistory = true;
    // 現在のロックを温存し、コンテンツ/レイアウトだけを target に巻き戻す
    const live = window.YZRS.state.override || {};
    const liveLocks = live.locks;
    const next = clone(target); // target は履歴スナップショット（locks 無し）
    if (liveLocks && Object.keys(liveLocks).length) next.locks = liveLocks;
    window.YZRS.state.override = next;
    if (window.YZRS.applyOverrideToDom) window.YZRS.applyOverrideToDom();
    if (window.YZRS.clearSelection) window.YZRS.clearSelection();
    if (window.YZRS.showDirty) window.YZRS.showDirty();
    window.YZRS._onChange(); // overflow / 可視化を再計算（history は flag で記録スキップ）
    window.YZRS._applyingHistory = false;
  }

  function undo() {
    // 保留中の debounce を確定させてから戻す
    if (timer) { clearTimeout(timer); timer = null; commitPending(); }
    if (!undoStack.length) return;
    redoStack.push(present);
    present = undoStack.pop();
    apply(present);
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(present);
    present = redoStack.pop();
    apply(present);
  }

  window.YZRS.onChange(record);
  window.YZRS.onCardSwitch(() => reset());
  window.YZRS.history = { undo, redo };

  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
})();
