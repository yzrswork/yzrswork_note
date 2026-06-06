/* YZRS NOTE — Task7: Auto-Fit（手動・決定論的・有限）
 *
 * ページ（A5）のはみ出しを、印刷安全に解消するための「手動」編集補助。
 * 信号は page-level overflow（authoritative）。明示的なボタン操作でのみ走り、
 * 1クリック=1回の有限・同期パスで完了する。
 *
 * 調整ラダー（決定的な順序。各段の後にページ判定し、収まり次第その段で確定）:
 *   1. font-size 縮小   （10px 下限 / 二分探索 0.5px）
 *   2. line-height 圧縮 （1.30 下限 / 二分探索 0.05）
 *   3. spacing 圧縮     （scale 0.6 下限 / 二分探索 0.02、layout ロック時は不可）
 *   4. layout 再配分    （高い側の列を広げる / 有界線形 0.05、layout ロック時は不可）
 *
 * 厳守:
 *   - テキスト改変／省略記号／DOM 構造変更は一切しない（font-size / line-height /
 *     gap・padding / 列比のみ）。
 *   - rAF/Observer/連続ループ/再帰なし。各段は有界同期ループ（≤約8計測）。
 *   - 書き込みは sparse override のみ。複数 setter は同 tick で1スナップショット
 *     （= 1回の undo で全体が戻る）。未調整クラスは applyOverrideToDom で正規化。
 *   - ロックされたフィールドは不変（対象から除外）。
 *   - 失敗は可視（警告チップ）。決して黙って無視しない。
 */
(function () {
  const TEXT_TARGETS = ['concept-text', 'memo-text', 'spec-val'];
  const CLASS_FIELDS = {
    'concept-text': ['concept_jp'],
    'memo-text': ['memo'],
    'spec-val': ['size', 'mount', 'power', 'mcu', 'parts', 'wire'],
  };
  const LH_BASE = { 'concept-text': 1.95, 'memo-text': 1.85, 'spec-val': 1.45 };
  const FONT_MIN = 10;
  const LH_FLOOR = 1.30;
  const SPACING_MIN = 0.60;
  const LAYOUT_SHIFT_MAX = 0.40;
  const PROBE_GUARD = 24;

  const r2 = (v) => Math.round(v * 100) / 100;

  function doc() {
    return window.YZRS.iframe && window.YZRS.iframe.contentDocument;
  }
  function win() {
    return window.YZRS.iframe && window.YZRS.iframe.contentWindow;
  }
  function metrics() {
    return window.YZRS.overflow.pageMetrics(doc());
  }
  function pageOverflow() { return metrics().overflow; }

  function effFont(cls) {
    const ov = (window.YZRS.state.override.font_size || {})[cls];
    if (ov !== undefined) return ov;
    const el = doc().querySelector('.' + cls);
    if (!el) return 13;
    return Math.round(parseFloat(win().getComputedStyle(el).fontSize) || 13);
  }
  function effLH(cls) {
    const ov = (window.YZRS.state.override.line_height || {})[cls];
    return (ov !== undefined) ? ov : (LH_BASE[cls] || 1.5);
  }

  function classAdjustable(cls) {
    return !CLASS_FIELDS[cls].some((f) => window.YZRS.isLocked(f));
  }

  // 単調（param↑ で overflow が減る）前提の二分探索。
  // maxP で収まらなければ null。収まる最小 param を res 粒度で返す。
  function searchMonotonic(maxP, res, applyParam) {
    applyParam(maxP);
    if (pageOverflow()) return null;       // 最大でも収まらない
    let lo = 0, hi = maxP, iters = 0;
    while (hi - lo > res && iters < PROBE_GUARD) {
      const mid = (lo + hi) / 2;
      applyParam(mid);
      if (pageOverflow()) lo = mid; else hi = mid;
      iters++;
    }
    return Math.ceil(hi / res) * res;
  }

  function tallerColumn() {
    const l = doc().querySelector('.col-left');
    const r = doc().querySelector('.col-right');
    if (!l || !r) return null;
    const dl = l.scrollHeight, dr = r.scrollHeight;
    if (Math.abs(dl - dr) < 2) return null;
    return dl > dr ? 'left' : 'right';
  }

  function warn(msg) {
    const host = document.getElementById('overflow-warnings');
    if (host) {
      const s = document.createElement('span');
      s.className = 'overflow-warn';
      s.textContent = msg;
      host.appendChild(s);
    }
  }

  // applied: { font:{cls:px}, lh:{cls:n}, spacing:scale|null, layout:{left_fr,right_fr}|null }
  function finalize(applied, stageLabel, failed) {
    Object.keys(applied.font).forEach((c) => window.YZRS.setFontSize(c, applied.font[c]));
    Object.keys(applied.lh).forEach((c) => window.YZRS.setLineHeight(c, applied.lh[c]));
    if (applied.spacing != null) window.YZRS.setSpacing(applied.spacing);
    if (applied.layout != null) window.YZRS.setLayout(applied.layout.left_fr, applied.layout.right_fr);
    // DOM を sparse override に正規化（計測で残ったインラインを除去）
    if (window.YZRS.applyOverrideToDom) window.YZRS.applyOverrideToDom();
    if (window.YZRS.overflow) window.YZRS.overflow.schedule();
    if (failed) {
      warn('⚠ Auto-Fit: A5 に収まりません');
      setStatusSafe('Auto-Fit: 収まりきりませんでした（最小まで適用）');
    } else {
      setStatusSafe('Auto-Fit: ' + stageLabel + ' で収めました');
    }
  }

  function setStatusSafe(msg) {
    const el = document.getElementById('status-msg');
    if (el) { el.textContent = msg; setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000); }
  }

  /**
   * @param {string[]} classes  対象テキストクラス
   * @param {boolean} allowSpacing  spacing 段を許可
   * @param {boolean} allowLayout   layout 段を許可
   */
  function autoFit(classes, allowSpacing, allowLayout) {
    if (!doc()) return;
    if (!pageOverflow()) { setStatusSafe('Auto-Fit: 既に収まっています'); return; }

    const adj = classes.filter(classAdjustable);
    const layoutLocked = window.YZRS.isLocked('layout');
    const baseFont = {}, baseLH = {};
    adj.forEach((c) => { baseFont[c] = effFont(c); baseLH[c] = effLH(c); });
    const applied = { font: {}, lh: {}, spacing: null, layout: null };

    // ── Stage 1: font ──
    if (adj.length) {
      const maxDelta = Math.max(0, ...adj.map((c) => baseFont[c] - FONT_MIN));
      if (maxDelta > 0) {
        const d = searchMonotonic(maxDelta, 0.5,
          (delta) => adj.forEach((c) => window.YZRS.applyFontSizeToClass(c, Math.max(FONT_MIN, baseFont[c] - delta))));
        const use = (d == null) ? maxDelta : d;
        adj.forEach((c) => {
          const v = Math.max(FONT_MIN, baseFont[c] - use);
          window.YZRS.applyFontSizeToClass(c, v);
          if (v < baseFont[c]) applied.font[c] = v;
        });
        if (d != null && !pageOverflow()) return finalize(applied, 'font');
      }
    }

    // ── Stage 2: line-height ──
    if (adj.length) {
      const maxLHd = Math.max(0, ...adj.map((c) => baseLH[c] - LH_FLOOR));
      if (maxLHd > 0) {
        const d = searchMonotonic(maxLHd, 0.05,
          (delta) => adj.forEach((c) => window.YZRS.applyLineHeightToClass(c, Math.max(LH_FLOOR, r2(baseLH[c] - delta)))));
        const use = (d == null) ? maxLHd : d;
        adj.forEach((c) => {
          const v = Math.max(LH_FLOOR, r2(baseLH[c] - use));
          window.YZRS.applyLineHeightToClass(c, v);
          if (v < baseLH[c]) applied.lh[c] = v;
        });
        if (d != null && !pageOverflow()) return finalize(applied, 'line-height');
      }
    }

    // ── Stage 3: spacing ──（layout ロック時はスキップ）
    if (allowSpacing && !layoutLocked) {
      const maxP = 1 - SPACING_MIN; // 0.40
      const d = searchMonotonic(maxP, 0.02, (p) => window.YZRS.applySpacing(r2(1 - p)));
      const use = (d == null) ? maxP : d;
      const scale = r2(1 - use);
      window.YZRS.applySpacing(scale);
      if (scale < 1) applied.spacing = scale;
      if (d != null && !pageOverflow()) return finalize(applied, 'spacing');
    }

    // ── Stage 4: layout 再配分 ──（非単調なので有界線形スキャン）
    if (allowLayout && !layoutLocked) {
      const taller = tallerColumn();
      if (taller) {
        let best = null;
        for (let shift = 0.05; shift <= LAYOUT_SHIFT_MAX + 1e-9; shift += 0.05) {
          const l = taller === 'left' ? 1 + shift : 1 - shift;
          const r = taller === 'left' ? 1 - shift : 1 + shift;
          window.YZRS.applyLayout(l, r);
          const m = metrics();
          if (!m.overflow) { applied.layout = { left_fr: r2(l), right_fr: r2(r) }; return finalize(applied, 'layout'); }
          if (best == null || m.excess < best.excess) best = { excess: m.excess, l: l, r: r };
        }
        if (best) {
          window.YZRS.applyLayout(best.l, best.r);
          applied.layout = { left_fr: r2(best.l), right_fr: r2(best.r) };
        }
      }
    }

    // ── 失敗（best-effort 適用済み）──
    finalize(applied, null, true);
  }

  function autoFitPage() {
    autoFit(TEXT_TARGETS, true, true);
  }
  function autoFitField(cssClass) {
    if (!CLASS_FIELDS[cssClass]) return;     // 本文テキスト系のみ
    autoFit([cssClass], false, false);       // 単一クラス: font + line-height のみ
  }

  window.YZRS.autofit = { page: autoFitPage, field: autoFitField };

  // ── トリガ: ツールバー「Auto-Fit Page」 ──
  const btn = document.getElementById('btn-autofit');
  if (btn) btn.addEventListener('click', autoFitPage);

  // ── トリガ: Inspector の本文フィールド選択時に「Auto Fit」ボタン ──
  window.YZRS.onInspectorRender((sel) => {
    if (!sel || !sel.field) return;
    // sel.el の最初のクラスが対象テキストクラスか
    const cls = sel.el && sel.el.className ? sel.el.className.split(' ')[0] : '';
    if (!CLASS_FIELDS[cls]) return;
    const inspector = document.getElementById('inspector');
    if (!inspector) return;
    const sec = document.createElement('div');
    sec.className = 'ins-section autofit-section';
    sec.innerHTML = '<div class="ins-title">Auto-Fit — ' + sel.field + '</div>';
    const b = document.createElement('button');
    b.className = 'tb-btn autofit-btn';
    b.textContent = 'このフィールドを Auto Fit';
    b.disabled = window.YZRS.isLocked(sel.field); // ロック中は不可
    b.addEventListener('click', () => autoFitField(cls));
    sec.appendChild(b);
    inspector.appendChild(sec);
  });
})();
