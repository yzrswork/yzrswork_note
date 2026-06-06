/* YZRS NOTE — Task8: Override Cleanup（冗長 override の保守的削減）
 *
 * Golden rule: 「override === baseline」と決定論的に確認できるキーだけを削除する。
 * 比較の真実は baseline data（state.data）と override JSON のみ。
 * iframe DOM / rendered HTML / 表示状態は一切参照しない（Invariant 1/2）。
 *
 * 削除する（baseline 等価/恒等デフォルトのみ）:
 *   - text.<field>  : override 値 === baselineText(field)
 *   - stars         : difficulty から再構成した baseline 配列と一致
 *   - photo         : file===baseline かつ fit/position が既定、かつ未知サブキー無し
 *   - spacing       : scale === 1（恒等＝無変化）
 *   - layout        : {left_fr:1, right_fr:1}（恒等＝_merged 既定）
 *
 * 絶対に削除しない:
 *   - locks（編集保護・履歴外・別スライス）
 *   - font_size / line_height（権威ある baseline を持たない＝Auto-Fit/手動の意図を保護）
 *   - 未知/将来キー（passthrough。既知の冗長キーだけを subtract する）
 *   - ロック中フィールドの override（locked = immutable。比較も削除もしない）
 *
 * 可逆性: 削除は in-memory の通常編集として markDirty → onChange → history に
 *   1ステップ記録される（1 undo で全戻し）。意味的には baseline と同一レンダなので安全。
 * save flow 統合: 削減後は通常の保存で永続化。全スライスが空（locks 含む）になれば
 *   サーバ側 is_empty が override ファイルを削除する（既存の振る舞い）。
 *
 * 出力HTMLには一切痕跡を残さない（editor 専用の操作）。
 */
(function () {
  const PHOTO_KNOWN = ['file', 'object_fit', 'object_position'];

  function st() { return window.YZRS.state; }
  function clampDifficulty(v) { return Math.max(0, Math.min(5, parseInt(v, 10) || 0)); }
  function eqArr(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!!a[i] !== !!b[i]) return false;
    return true;
  }

  // 削除対象の決定論的リストを返す（適用はしない＝dry-run）。
  // 各要素は { path, kind, field? }。path は安定ソート済みの可読表現。
  function computeRemovals() {
    const s = st();
    if (!s || !s.data || !s.override) return [];
    const ov = s.override, data = s.data;
    const isLocked = window.YZRS.isLocked || (() => false);
    const out = [];

    // text.<field>
    const t = ov.text || {};
    Object.keys(t).sort().forEach((field) => {
      if (isLocked(field)) return;                 // locked = immutable
      let val = t[field];
      if (Array.isArray(val)) val = val.join(', '); // parts 等が配列で入っていた場合
      const base = window.YZRS.baselineText(field);
      if (String(val) === String(base)) out.push({ path: 'text.' + field, kind: 'text', field: field });
    });

    // stars
    if (Array.isArray(ov.stars) && !isLocked('stars')) {
      const n = clampDifficulty(data.difficulty);
      const baseArr = [0, 1, 2, 3, 4].map((i) => i < n);
      if (eqArr(ov.stars, baseArr)) out.push({ path: 'stars', kind: 'stars' });
    }

    // photo（未知サブキーがあれば保護のため削除しない）
    if (ov.photo && !isLocked('photo')) {
      const p = ov.photo;
      const onlyKnown = Object.keys(p).every((k) => PHOTO_KNOWN.indexOf(k) !== -1);
      if (onlyKnown
        && (p.file || null) === (data.photo || null)
        && (p.object_fit || 'cover') === 'cover'
        && (p.object_position || '50% 50%') === '50% 50%') {
        out.push({ path: 'photo', kind: 'photo' });
      }
    }

    // spacing（恒等）
    if (ov.spacing && ov.spacing.scale === 1 && !isLocked('layout')) {
      out.push({ path: 'spacing', kind: 'spacing' });
    }
    // layout（恒等 1/1）
    if (ov.layout && ov.layout.left_fr === 1 && ov.layout.right_fr === 1 && !isLocked('layout')) {
      out.push({ path: 'layout', kind: 'layout' });
    }

    return out;
  }

  // 削減を適用（1回の同期バッチ＝履歴1ステップ）。削除件数を返す。
  function applyRemovals(removals) {
    const ov = st().override;
    let textTouched = false;
    removals.forEach((r) => {
      if (r.kind === 'text') {
        if (ov.text) { delete ov.text[r.field]; textTouched = true; }
      } else {
        delete ov[r.kind];
      }
    });
    if (textTouched && ov.text && !Object.keys(ov.text).length) delete ov.text;

    if (window.YZRS.showDirty) window.YZRS.showDirty();      // dirty 再計算 + onChange（履歴記録）
    if (window.YZRS.applyOverrideToDom) window.YZRS.applyOverrideToDom(); // baseline へ再projection
    return removals.length;
  }

  // 明示トリガ: dry-run プレビュー → 確認 → 適用（黙って消さない）。
  function runCleanup() {
    const removals = computeRemovals();
    if (!removals.length) {
      if (window.YZRS.setStatus) window.YZRS.setStatus('クリーンアップ: 冗長 override なし');
      return 0;
    }
    const list = removals.map((r) => '  • ' + r.path).join('\n');
    const ok = (typeof window.confirm !== 'function') ||
      window.confirm('baseline と同一の冗長 override を削除します（undo で復元可・保存で確定）:\n\n' + list);
    if (!ok) return 0;
    const n = applyRemovals(removals);
    if (window.YZRS.setStatus) window.YZRS.setStatus('クリーンアップ: ' + n + ' 件削減（保存ボタンで確定）');
    return n;
  }

  window.YZRS.cleanup = { preview: computeRemovals, apply: applyRemovals, run: runCleanup };

  const btn = document.getElementById('btn-cleanup');
  if (btn) btn.addEventListener('click', runCleanup);
})();
