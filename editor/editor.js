/* YZRS NOTE — Canva風カードエディタ (vanilla JS, no build)
 *
 * 仕様の中核：
 *   - 編集は data/overrides/{id}.json に差分保存
 *   - iframe で実カードを表示し、同一オリジンでDOMに直接アクセス
 *   - クリック選択→Inspector→値を変えると iframe DOM を即時 mutate
 *   - 保存ボタンで in-memory override を /api/card/<id> に POST
 */

// ─── State ────────────────────────────────────
const state = {
  cards: [],
  currentId: null,
  data: null,        // data.json の該当 work
  override: {},      // 編集中の override（保存対象）
  merged: null,      // サーバから返る合成値（初期表示の参照）
  selection: null,   // {kind, field, idx, el}
  dirty: false,
  savedHash: '',     // 最後に保存/読込した override の決定論的ハッシュ
  previewMode: false,
};

// ─── 決定論的シリアライズ（dirty 判定用） ─────────────────
// sparse override のみを対象に、キー順非依存で安定文字列化する。
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort()
    .map((k) => JSON.stringify(k) + ':' + stableStringify(v[k]))
    .join(',') + '}';
}
// 保存される sparse スライスだけを取り出す（id / schema_version / 空コンテナは除外）
function canonicalOverride(ov) {
  ov = ov || {};
  const out = {};
  if (ov.text && Object.keys(ov.text).length) out.text = ov.text;
  if (ov.font_size && Object.keys(ov.font_size).length) out.font_size = ov.font_size;
  if (ov.line_height && Object.keys(ov.line_height).length) out.line_height = ov.line_height;
  if (ov.spacing && ov.spacing.scale != null) out.spacing = ov.spacing;
  if (ov.layout && Object.keys(ov.layout).length) out.layout = ov.layout;
  if (Array.isArray(ov.stars)) out.stars = ov.stars;
  if (ov.photo) out.photo = ov.photo;
  if (ov.locks && Object.keys(ov.locks).length) out.locks = ov.locks;
  return out;
}
function currentOverrideHash() {
  return stableStringify(canonicalOverride(state.override));
}

// ヘッダタイトルの接尾辞を一元化（Auto-Fit 等での重複ロジックを防ぐ）
function formatHeaderTitle(title) {
  return `${title} — e-photoframe series`;
}

// ─── DOM ──────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const cardSelect = $('#card-select');
const iframe = $('#card-frame');
const inspector = $('#inspector');
const dirtyFlag = $('#dirty-flag');
const statusMsg = $('#status-msg');

// ─── API ─────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path}: ${r.status}`);
  return r.json();
}

function setStatus(msg) {
  statusMsg.textContent = msg;
  if (msg) setTimeout(() => { if (statusMsg.textContent === msg) statusMsg.textContent = ''; }, 3000);
}
function markDirty() {
  // 現在の override が最後に保存した状態と一致すれば dirty=false
  // （undo で baseline に戻ったときに「未保存」が残らない）
  state.dirty = (currentOverrideHash() !== state.savedHash);
  dirtyFlag.hidden = !state.dirty;
  if (window.YZRS) window.YZRS._onChange();
}
function clearDirty() {
  // 「現在 = 保存済み」を確定。以後の dirty 判定の基準になる。
  state.savedHash = currentOverrideHash();
  state.dirty = false;
  dirtyFlag.hidden = true;
}

// ─── Override 操作ヘルパ ─────────────────────────
function ensureOverride() {
  if (!state.override.schema_version) {
    state.override = { id: state.currentId, schema_version: 1 };
  }
}
function setTextOverride(field, value) {
  ensureOverride();
  state.override.text ||= {};
  state.override.text[field] = value;
  markDirty();
}
function setFontSizeOverride(cssClass, px) {
  ensureOverride();
  state.override.font_size ||= {};
  state.override.font_size[cssClass] = px;
  markDirty();
}
function setLineHeightOverride(cssClass, lh) {
  ensureOverride();
  state.override.line_height ||= {};
  state.override.line_height[cssClass] = lh;
  markDirty();
}
function setSpacingOverride(scale) {
  ensureOverride();
  state.override.spacing = { scale: scale };
  markDirty();
}
function setLayoutOverride(left, right) {
  ensureOverride();
  state.override.layout = { left_fr: left, right_fr: right };
  markDirty();
}
function setStarsOverride(arr) {
  ensureOverride();
  state.override.stars = arr.slice();
  markDirty();
}
function setPhotoOverride(patch) {
  ensureOverride();
  state.override.photo = Object.assign(
    { object_fit: 'cover', object_position: '50% 50%' },
    state.override.photo || {},
    patch
  );
  markDirty();
}

// ─── HTML→plain（contentEditable の改行を \n に戻す） ─────
function htmlToPlain(html) {
  // <br>, <div> の境界を改行に置換 → タグ除去 → エンティティ復号
  let s = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>\s*<div[^>]*>/gi, '\n')
    .replace(/<div[^>]*>/gi, '\n')
    .replace(/<\/div>/gi, '');
  s = s.replace(/<[^>]+>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = s;
  return ta.value.replace(/ /g, ' ').replace(/^\n+|\n+$/g, '');
}

// ─── カード一覧読込 & 切替 ────────────────────────
async function loadCardList() {
  state.cards = await apiGet('/api/cards');
  cardSelect.innerHTML = '';
  for (const c of state.cards) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.id} — ${c.title_en}${c.has_override ? ' ●' : ''}`;
    cardSelect.appendChild(opt);
  }
  if (state.cards.length) {
    let startId = state.cards[0].id;
    const sess = window.YZRS && window.YZRS.session;
    if (sess) {
      const restored = sess.restoreStartCard(state.cards);
      if (restored) startId = restored;
    }
    await switchCard(startId);
  }
}

async function switchCard(id) {
  if (state.dirty && !confirm('未保存の編集があります。破棄してカードを切替えますか？')) {
    cardSelect.value = state.currentId;
    return;
  }
  state.currentId = id;
  const res = await apiGet(`/api/card/${id}`);
  state.data = res.data;
  state.override = Object.keys(res.override).length ? res.override : {};
  state.merged = res.merged;
  clearDirty();
  renderInspectorEmpty();
  iframe.src = `/output/yzrs-note-${id}-${state.data.title_en}.html?v=${Date.now()}`;
  cardSelect.value = id;
  if (window.YZRS) window.YZRS._onCardSwitch(id);
}

cardSelect.addEventListener('change', (e) => switchCard(e.target.value));

// ─── Iframe load: タグ付け・スター分解・オーバーレイCSS注入 ───
iframe.addEventListener('load', () => {
  const doc = iframe.contentDocument;
  if (!doc || !doc.body) return;

  // オーバーレイCSS注入
  const style = doc.createElement('style');
  style.id = '__editor_overlay__';
  style.textContent = `
    [data-editor-field]:hover:not(.__locked__) { outline: 1px dashed #b5451b; outline-offset: 1px; }
    /* 視覚優先度（global）: locked > overflow > heatmap > selected。
       selected の outline は locked / overflow に必ず譲る（注入順に依存しないよう :not で確定）。
       heatmap は background / inset box-shadow チャネルなので outline とは競合しない。 */
    .editor-selected:not(.__locked__):not(.__overflow__):not(.__page_overflow__) {
      outline: 2px solid #b5451b !important; outline-offset: 1px;
    }
    [data-star-idx] { cursor: pointer; }
    .col-divider { cursor: col-resize; }
  `;
  doc.head.appendChild(style);

  // タグ付け（sel は文字列セレクタ or iframe内 Element）
  const tag = (sel, kind, field, idx) => {
    const el = (typeof sel === 'string') ? doc.querySelector(sel) : sel;
    if (!el) return;
    el.setAttribute('data-editor-field', `${kind}:${field}${idx !== undefined ? ':' + idx : ''}`);
  };
  tag('.header-title-jp', 'text', 'title_en');
  // STATUS BAR の s-val 2つ：TYPE と RARITY
  const svals = doc.querySelectorAll('.s-val');
  if (svals[0]) tag(svals[0], 'text', 'type');
  if (svals[1]) tag(svals[1], 'text', 'rarity');
  // stars-val
  tag('.stars-val', 'stars', 'stars');
  // concept / memo
  tag('.concept-text', 'text', 'concept_jp');
  tag('.memo-text', 'text', 'memo');
  // spec-val 6つ
  const SPEC_FIELDS = ['size', 'mount', 'power', 'mcu', 'parts', 'wire'];
  doc.querySelectorAll('.spec-val').forEach((el, i) => {
    if (SPEC_FIELDS[i]) tag(el, 'text', SPEC_FIELDS[i]);
  });
  // visual-box
  tag('.visual-box', 'photo', 'photo');
  // col-divider
  tag('.col-divider', 'layout', 'layout');

  // stars-val 内の★を個別 span に分解（dim も個別化）
  const starsHost = doc.querySelector('.stars-val');
  if (starsHost) wrapStars(starsHost);

  // 委譲クリックハンドラ
  doc.addEventListener('click', onIframeClick, true);

  // col-divider のドラッグ
  setupColDividerDrag(doc);

  // プレビューモード適用
  applyPreviewMode();

  // 機能モジュール（guides / overflow / heatmap…）へ通知
  if (window.YZRS) window.YZRS._onIframeLoad(doc);
});

function wrapStars(host) {
  // 既存：★★★<span class="dim">★★</span> または既に個別 span 形式
  // 一旦 dom を平坦化して 5個の <span data-star-idx="N"> に書き直す
  const arr = currentStars();
  host.innerHTML = arr.map((on, i) =>
    `<span data-star-idx="${i}" class="${on ? '' : 'dim'}">★</span>`
  ).join('');
}

// ─── クリック → 選択 ───────────────────────────
function onIframeClick(ev) {
  if (state.previewMode) return;
  // 個別スタークリックはトグル
  const star = ev.target.closest('[data-star-idx]');
  if (star) {
    ev.preventDefault();
    toggleStar(parseInt(star.dataset.starIdx, 10));
    return;
  }
  const node = ev.target.closest('[data-editor-field]');
  if (!node) return;
  ev.preventDefault();
  selectField(node);
}

function selectField(node) {
  // 直前選択の解除
  const doc = iframe.contentDocument;
  doc.querySelectorAll('.editor-selected').forEach(n => n.classList.remove('editor-selected'));
  node.classList.add('editor-selected');

  const [kind, field, idx] = node.getAttribute('data-editor-field').split(':');
  state.selection = { kind, field, idx, el: node };
  renderInspector();
}

// ─── Inspector 描画 ────────────────────────────
function renderInspectorEmpty() {
  inspector.innerHTML = '<div class="ins-empty">要素をクリックして編集</div>';
}

function renderInspector() {
  const sel = state.selection;
  if (!sel) { renderInspectorEmpty(); return; }
  inspector.innerHTML = '';

  if (sel.kind === 'text') renderInspectorText(sel);
  else if (sel.kind === 'stars') renderInspectorStars();
  else if (sel.kind === 'photo') renderInspectorPhoto();
  else if (sel.kind === 'layout') renderInspectorLayout();

  // 機能モジュール（locks 等）へ「Inspector を描画した」と通知
  if (window.YZRS) window.YZRS._onInspectorRender(sel);
}

// テキスト編集 + font-size
function renderInspectorText(sel) {
  const field = sel.field;
  const cssClass = sel.el.className.split(' ')[0]; // 例: 'concept-text'
  const isMulti = (field === 'concept_jp' || field === 'memo');

  // 現在値（override優先、無ければ merged）
  const t = state.override.text || {};
  const current = (field in t) ? t[field] : state.merged.text[field] || '';

  const sec = document.createElement('div');
  sec.className = 'ins-section';
  sec.innerHTML = `<div class="ins-title">テキスト編集 — ${field}</div>`;

  const row = document.createElement('div');
  row.className = 'ins-row';
  const input = document.createElement(isMulti ? 'textarea' : 'input');
  if (!isMulti) input.type = 'text';
  input.value = current;
  if (isMulti) input.rows = 5;
  row.appendChild(input);
  sec.appendChild(row);

  input.addEventListener('input', () => {
    setTextOverride(field, input.value);
    // iframe 即時反映
    if (isMulti) {
      sel.el.innerHTML = input.value.split('\n')
        .map(s => escapeHtml(s)).join('<br>');
    } else {
      // header-title-jp は " — e-photoframe series" 部分を保ちつつ先頭テキストを差替え
      if (field === 'title_en' && cssClass === 'header-title-jp') {
        sel.el.textContent = formatHeaderTitle(input.value);
      } else {
        sel.el.textContent = input.value;
      }
    }
  });

  inspector.appendChild(sec);

  // font-size セクション
  const fontSec = makeFontSizeSection(cssClass, sel.el);
  inspector.appendChild(fontSec);
}

function makeFontSizeSection(cssClass, sampleEl) {
  const sec = document.createElement('div');
  sec.className = 'ins-section';
  sec.innerHTML = `<div class="ins-title">フォントサイズ — .${cssClass}</div>`;

  const cur = (state.override.font_size || {})[cssClass];
  const computed = parseFloat(iframe.contentWindow.getComputedStyle(sampleEl).fontSize);
  const value = cur !== undefined ? cur : Math.round(computed);

  const row = document.createElement('div');
  row.className = 'ins-row';
  row.innerHTML = `
    <label>サイズ</label>
    <input type="range" min="8" max="40" step="1" value="${value}">
    <input type="number" min="6" max="60" step="1" value="${value}" style="max-width:64px">
  `;
  sec.appendChild(row);

  const range = row.querySelector('input[type="range"]');
  const num = row.querySelector('input[type="number"]');
  const sync = (v) => {
    range.value = v; num.value = v;
    applyFontSizeToClass(cssClass, parseInt(v, 10));
    setFontSizeOverride(cssClass, parseInt(v, 10));
  };
  range.addEventListener('input', () => sync(range.value));
  num.addEventListener('input', () => sync(num.value));

  return sec;
}

function applyFontSizeToClass(cssClass, px) {
  const doc = iframe.contentDocument;
  doc.querySelectorAll('.' + cssClass).forEach(el => {
    el.style.fontSize = px + 'px';
  });
}
// Auto-Fit 用: 行間／余白をインラインで適用（null で解除＝stylesheet 既定に戻す）
function applyLineHeightToClass(cssClass, lh) {
  const doc = iframe.contentDocument;
  doc.querySelectorAll('.' + cssClass).forEach(el => {
    el.style.lineHeight = (lh == null ? '' : String(lh));
  });
}
function applySpacing(scale) {
  const doc = iframe.contentDocument;
  doc.querySelectorAll('.col-left, .col-right').forEach(el => {
    if (scale == null) {
      el.style.gap = '';
      el.style.padding = '';
    } else {
      const s = Number(scale);
      el.style.gap = (20 * s) + 'px';
      el.style.padding = (22 * s) + 'px 24px ' + (26 * s) + 'px';
    }
  });
}

// ★ Inspector
function renderInspectorStars() {
  const sec = document.createElement('div');
  sec.className = 'ins-section';
  sec.innerHTML = `<div class="ins-title">DIFFICULTY ★ — 個別トグル</div>`;
  const arr = currentStars();
  const togRow = document.createElement('div');
  togRow.className = 'star-toggles';
  arr.forEach((on, i) => {
    const b = document.createElement('button');
    b.className = 'star-toggle ' + (on ? 'on' : 'off');
    b.textContent = '★';
    b.addEventListener('click', () => toggleStar(i));
    togRow.appendChild(b);
  });
  sec.appendChild(togRow);
  inspector.appendChild(sec);

  const host = iframe.contentDocument.querySelector('.stars-val');
  inspector.appendChild(makeFontSizeSection('stars-val', host));
}

function currentStars() {
  if (state.override.stars && state.override.stars.length === 5) return state.override.stars.slice();
  // override が無ければ data の difficulty から再構成（undo で baseline に戻せるように）
  const n = Math.max(0, Math.min(5, parseInt(state.data && state.data.difficulty, 10) || 0));
  return [true, true, true, true, true].map((_, i) => i < n);
}

function toggleStar(idx) {
  if (window.YZRS && window.YZRS.isLocked('stars')) { setStatus('🔒 stars はロック中'); return; }
  const arr = currentStars();
  arr[idx] = !arr[idx];
  setStarsOverride(arr);
  // iframe 即時反映
  const doc = iframe.contentDocument;
  const star = doc.querySelector(`[data-star-idx="${idx}"]`);
  if (star) star.className = arr[idx] ? '' : 'dim';
  // Inspector 再描画（toggle ボタンの状態同期）
  if (state.selection && state.selection.kind === 'stars') renderInspector();
}

// 写真 Inspector
function renderInspectorPhoto() {
  const sec = document.createElement('div');
  sec.className = 'ins-section';
  sec.innerHTML = `<div class="ins-title">写真</div>`;

  const ua = document.createElement('div');
  ua.className = 'upload-area';
  ua.innerHTML = `画像ファイルを選んで 4:3 にクロップ<input type="file" accept="image/*">`;
  sec.appendChild(ua);
  ua.querySelector('input[type="file"]').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) openCropModal(f);
  });
  inspector.appendChild(sec);

  // object-position スライダ（既に画像が入っている場合のみ意味あり）
  const photo = state.override.photo || state.merged.photo;
  if (photo && photo.file) {
    const posSec = document.createElement('div');
    posSec.className = 'ins-section';
    posSec.innerHTML = `<div class="ins-title">表示位置（フレーム内）</div>`;
    const [xs, ys] = (photo.object_position || '50% 50%').replace(/%/g, '').split(/\s+/);
    posSec.innerHTML += `
      <div class="ins-row"><label>X</label><input type="range" id="pos-x" min="0" max="100" value="${parseInt(xs)||50}"><span class="ins-val" id="pos-x-v">${parseInt(xs)||50}%</span></div>
      <div class="ins-row"><label>Y</label><input type="range" id="pos-y" min="0" max="100" value="${parseInt(ys)||50}"><span class="ins-val" id="pos-y-v">${parseInt(ys)||50}%</span></div>
    `;
    inspector.appendChild(posSec);
    const px = posSec.querySelector('#pos-x'), py = posSec.querySelector('#pos-y');
    const pxv = posSec.querySelector('#pos-x-v'), pyv = posSec.querySelector('#pos-y-v');
    const apply = () => {
      const pos = `${px.value}% ${py.value}%`;
      pxv.textContent = px.value + '%'; pyv.textContent = py.value + '%';
      setPhotoOverride({ object_position: pos });
      const img = iframe.contentDocument.querySelector('.visual-box img');
      if (img) img.style.objectPosition = pos;
    };
    px.addEventListener('input', apply);
    py.addEventListener('input', apply);
  }
}

// レイアウト（カラム幅）Inspector
function renderInspectorLayout() {
  const sec = document.createElement('div');
  sec.className = 'ins-section';
  sec.innerHTML = `<div class="ins-title">カラム幅</div>`;
  const cur = state.override.layout || state.merged.layout;
  const ratio = (cur.left_fr || 1) / (cur.right_fr || 1);
  sec.innerHTML += `
    <div class="ins-row"><label>左:右</label>
      <input type="range" id="ratio" min="0.3" max="3.0" step="0.05" value="${ratio.toFixed(2)}">
      <span class="ins-val" id="ratio-v">${ratio.toFixed(2)}</span>
    </div>
  `;
  inspector.appendChild(sec);
  const r = sec.querySelector('#ratio');
  const rv = sec.querySelector('#ratio-v');
  r.addEventListener('input', () => {
    const v = parseFloat(r.value);
    rv.textContent = v.toFixed(2);
    applyLayout(v, 1);
    setLayoutOverride(v, 1);
  });
}

function applyLayout(left, right) {
  const doc = iframe.contentDocument;
  const body = doc.querySelector('.body');
  if (body) body.style.gridTemplateColumns = `${left}fr 1px ${right}fr`;
}

// col-divider ドラッグ（iframe 内）
function setupColDividerDrag(doc) {
  const divider = doc.querySelector('.col-divider');
  const body = doc.querySelector('.body');
  if (!divider || !body) return;
  let dragging = false;
  divider.addEventListener('mousedown', (e) => {
    if (window.YZRS && window.YZRS.isLocked('layout')) return;
    e.preventDefault();
    dragging = true;
    doc.body.style.userSelect = 'none';
  });
  doc.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const r = body.getBoundingClientRect();
    const x = e.clientX - r.left;
    const w = r.width;
    if (x < 40 || x > w - 40) return;
    const left = x / w * 2;        // 合計 ~2.0
    const right = (w - x) / w * 2;
    applyLayout(left, right);
    setLayoutOverride(left, right);
    if (state.selection && state.selection.kind === 'layout') {
      const r2 = inspector.querySelector('#ratio');
      const rv = inspector.querySelector('#ratio-v');
      if (r2 && rv) {
        const ratio = left / right;
        r2.value = ratio.toFixed(2); rv.textContent = ratio.toFixed(2);
      }
    }
  });
  doc.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    doc.body.style.userSelect = '';
  });
}

// ─── Save / Rebuild / Reset ──────────────────────────
$('#btn-save').addEventListener('click', async () => {
  await saveOverride();
});
async function saveOverride() {
  // contentEditable で編集中のものを blur 相当に拾う（保険）
  // 現状はテキストは Inspector 入力で同期しているので追加処理不要
  if (!Object.keys(state.override).length) {
    setStatus('変更なし');
    return;
  }
  try {
    const res = await apiPost(`/api/card/${state.currentId}`, state.override);
    clearDirty();
    setStatus(res.cleared ? 'override 削除しました' : '保存完了');
    // カード一覧の override マークを更新
    const c = state.cards.find(x => x.id === state.currentId);
    if (c) c.has_override = !res.cleared;
    refreshCardSelect();
  } catch (e) {
    setStatus('保存失敗: ' + e.message);
  }
}

$('#btn-rebuild').addEventListener('click', async () => {
  // 未保存があれば先に保存
  if (state.dirty) await saveOverride();
  try {
    const res = await apiPost('/api/rebuild', {});
    setStatus(`Rebuild OK: ${res.files.length} 件`);
    // iframe リロード
    iframe.src = `/output/yzrs-note-${state.currentId}-${state.data.title_en}.html?v=${Date.now()}`;
  } catch (e) {
    setStatus('Rebuild失敗: ' + e.message);
  }
});

$('#btn-reset-field').addEventListener('click', () => {
  const sel = state.selection;
  if (!sel) { setStatus('要素を選択してください'); return; }
  if (sel.kind === 'text' && state.override.text) {
    delete state.override.text[sel.field];
    if (!Object.keys(state.override.text).length) delete state.override.text;
  } else if (sel.kind === 'stars') {
    delete state.override.stars;
  } else if (sel.kind === 'layout') {
    delete state.override.layout;
  } else if (sel.kind === 'photo') {
    delete state.override.photo;
  }
  markDirty();
  setStatus('リセット（保存ボタンで確定）');
  // 再描画用に再リロード
  iframe.src = `/output/yzrs-note-${state.currentId}-${state.data.title_en}.html?v=${Date.now()}`;
});

$('#btn-reset-all').addEventListener('click', async () => {
  if (!confirm('この作品の override をすべて削除します。よろしいですか？')) return;
  state.override = {};
  markDirty();
  await saveOverride();
  iframe.src = `/output/yzrs-note-${state.currentId}-${state.data.title_en}.html?v=${Date.now()}`;
});

$('#btn-preview').addEventListener('click', () => {
  state.previewMode = !state.previewMode;
  applyPreviewMode();
});
function applyPreviewMode() {
  const doc = iframe.contentDocument;
  if (!doc) return;
  let style = doc.getElementById('__editor_preview__');
  if (state.previewMode) {
    if (!style) {
      style = doc.createElement('style');
      style.id = '__editor_preview__';
      doc.head.appendChild(style);
    }
    style.textContent = `[data-editor-field]:hover { outline: none !important; } .editor-selected { outline: none !important; }`;
  } else if (style) {
    style.remove();
  }
  $('#btn-preview').textContent = state.previewMode ? '編集モード' : 'プレビュー';
}

function refreshCardSelect() {
  // ● マーク更新のみ
  for (const opt of cardSelect.options) {
    const c = state.cards.find(x => x.id === opt.value);
    if (c) opt.textContent = `${c.id} — ${c.title_en}${c.has_override ? ' ●' : ''}`;
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── 画像クロップ・モーダル ─────────────────────────
const cropState = { img: null, rect: null, naturalW: 0, naturalH: 0 };

function openCropModal(file) {
  const modal = $('#crop-modal');
  const canvas = $('#crop-canvas');
  const ctx = canvas.getContext('2d');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    cropState.img = img;
    cropState.naturalW = img.naturalWidth;
    cropState.naturalH = img.naturalHeight;
    // 表示サイズ：最大幅 80vw / 高さ 70vh で fit
    const maxW = Math.min(window.innerWidth * 0.8, 1100);
    const maxH = Math.min(window.innerHeight * 0.7, 800);
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const dispW = Math.round(img.naturalWidth * scale);
    const dispH = Math.round(img.naturalHeight * scale);
    canvas.width = dispW;
    canvas.height = dispH;
    ctx.drawImage(img, 0, 0, dispW, dispH);
    // 初期クロップ：中央 4:3 で最大
    initCropRect(dispW, dispH);
    modal.hidden = false;
    cropState._file = file;
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function initCropRect(canvW, canvH) {
  // 4:3 をフィットさせる最大矩形
  let w, h;
  if (canvW / canvH > 4/3) {
    h = canvH; w = h * 4 / 3;
  } else {
    w = canvW; h = w * 3 / 4;
  }
  w = Math.round(w * 0.9); h = Math.round(h * 0.9);
  const x = Math.round((canvW - w) / 2);
  const y = Math.round((canvH - h) / 2);
  cropState.rect = { x, y, w, h };
  positionCropRect();
  setupCropDrag();
}

function positionCropRect() {
  const r = $('#crop-rect');
  const canvas = $('#crop-canvas');
  const cr = canvas.getBoundingClientRect();
  const sr = $('#crop-stage').getBoundingClientRect();
  r.style.left = (cr.left - sr.left + cropState.rect.x) + 'px';
  r.style.top = (cr.top - sr.top + cropState.rect.y) + 'px';
  r.style.width = cropState.rect.w + 'px';
  r.style.height = cropState.rect.h + 'px';
}

function setupCropDrag() {
  const r = $('#crop-rect');
  const canvas = $('#crop-canvas');
  let mode = null, startX = 0, startY = 0, orig = null, corner = null;

  const onDown = (e) => {
    const tg = e.target;
    if (tg.classList.contains('crop-handle')) {
      mode = 'resize';
      corner = tg.dataset.corner;
    } else {
      mode = 'move';
    }
    startX = e.clientX; startY = e.clientY;
    orig = { ...cropState.rect };
    e.preventDefault();
  };
  const onMove = (e) => {
    if (!mode) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    let nx = orig.x, ny = orig.y, nw = orig.w, nh = orig.h;
    if (mode === 'move') {
      nx = orig.x + dx; ny = orig.y + dy;
    } else {
      // aspect-lock resize: use dx, derive dh from dw / aspect
      const aspect = 4 / 3;
      if (corner === 'se') {
        nw = orig.w + dx; nh = nw / aspect;
      } else if (corner === 'sw') {
        nw = orig.w - dx; nh = nw / aspect;
        nx = orig.x + (orig.w - nw);
      } else if (corner === 'ne') {
        nw = orig.w + dx; nh = nw / aspect;
        ny = orig.y + (orig.h - nh);
      } else if (corner === 'nw') {
        nw = orig.w - dx; nh = nw / aspect;
        nx = orig.x + (orig.w - nw);
        ny = orig.y + (orig.h - nh);
      }
    }
    // クランプ
    nw = Math.max(40, nw); nh = Math.max(30, nh);
    if (nx < 0) { nx = 0; }
    if (ny < 0) { ny = 0; }
    if (nx + nw > canvas.width) nw = canvas.width - nx;
    if (ny + nh > canvas.height) nh = canvas.height - ny;
    // aspect 再固定
    if (nw / nh > 4/3) nw = nh * 4 / 3;
    else nh = nw * 3 / 4;
    cropState.rect = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
    positionCropRect();
  };
  const onUp = () => { mode = null; };
  r.onmousedown = onDown;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

$('#crop-close').addEventListener('click', () => { $('#crop-modal').hidden = true; });
$('#crop-cancel').addEventListener('click', () => { $('#crop-modal').hidden = true; });
$('#crop-confirm').addEventListener('click', async () => {
  // 表示canvas座標 → natural座標スケール
  const canvas = $('#crop-canvas');
  const sx = cropState.naturalW / canvas.width;
  const sy = cropState.naturalH / canvas.height;
  const cx = cropState.rect.x * sx;
  const cy = cropState.rect.y * sy;
  const cw = cropState.rect.w * sx;
  const ch = cropState.rect.h * sy;
  // 出力 1200×900（4:3）
  const off = document.createElement('canvas');
  off.width = 1200; off.height = 900;
  off.getContext('2d').drawImage(cropState.img, cx, cy, cw, ch, 0, 0, 1200, 900);
  const blob = await new Promise(res => off.toBlob(res, 'image/jpeg', 0.9));
  // アップロード
  const fd = new FormData();
  fd.append('id', state.currentId);
  fd.append('file', blob, cropState._file.name.replace(/\.[^.]+$/, '') + '.jpg');
  const r = await fetch('/api/upload-image', { method: 'POST', body: fd });
  const j = await r.json();
  if (j.ok) {
    setPhotoOverride({ file: j.filename, object_fit: 'cover', object_position: '50% 50%' });
    setStatus('画像アップロード完了。Rebuild してプレビュー');
    // 即時反映：iframe内 visual-box の中身を <img> に差し替え
    const doc = iframe.contentDocument;
    const box = doc.querySelector('.visual-box');
    if (box) {
      box.innerHTML = `<img src="/photos/${j.filename}" style="object-fit:cover;object-position:50% 50%" alt="">`;
      box.setAttribute('data-editor-field', 'photo:photo'); // 再タグ
    }
    $('#crop-modal').hidden = true;
    renderInspector(); // 位置スライダ表示のため
  } else {
    setStatus('アップロード失敗');
  }
});

// ─── override → iframe DOM 再適用（undo/redo 用） ─────────
// 保存値ではなく in-memory の state.override を「最後にrebuildされたDOM」へ
// 重ねて反映する。override が無いフィールドは data のベース値に戻す。
function textToBr(s) {
  return String(s).split('\n').map(escapeHtml).join('<br>');
}
// フィールドの baseline 値（override 不在時にレンダされる値）。
// Task8 クリーンアップの「override === baseline」判定もこれを唯一の真実として使う。
function baselineText(field) {
  if (field === 'parts') return (state.data.parts || []).join(', ');
  return state.data[field] != null ? state.data[field] : '';
}
function effectiveText(field) {
  const t = state.override.text || {};
  if (field in t) return t[field];
  return baselineText(field);
}
function applyOverrideToDom(doc) {
  doc = doc || iframe.contentDocument;
  if (!doc || !doc.body) return;

  // テキスト系
  const titleEl = doc.querySelector('.header-title-jp');
  if (titleEl) titleEl.textContent = formatHeaderTitle(effectiveText('title_en'));
  const svals = doc.querySelectorAll('.s-val');
  if (svals[0]) svals[0].textContent = effectiveText('type');
  if (svals[1]) svals[1].textContent = effectiveText('rarity');
  const concept = doc.querySelector('.concept-text');
  if (concept) concept.innerHTML = textToBr(effectiveText('concept_jp'));
  const memo = doc.querySelector('.memo-text');
  if (memo) memo.innerHTML = textToBr(effectiveText('memo'));
  const SPEC = ['size', 'mount', 'power', 'mcu', 'parts', 'wire'];
  doc.querySelectorAll('.spec-val').forEach((el, i) => {
    if (SPEC[i]) el.textContent = effectiveText(SPEC[i]);
  });

  // font-size（override に無いクラスはインラインを解除）
  const FS_CLASSES = ['header-title-jp', 'concept-text', 'memo-text', 'spec-val', 's-val', 'stars-val'];
  const fs = state.override.font_size || {};
  FS_CLASSES.forEach((cls) => {
    doc.querySelectorAll('.' + cls).forEach((el) => {
      el.style.fontSize = (fs[cls] !== undefined) ? (fs[cls] + 'px') : '';
    });
  });

  // line-height（override に無いクラスはインラインを解除）
  const lh = state.override.line_height || {};
  FS_CLASSES.forEach((cls) => {
    doc.querySelectorAll('.' + cls).forEach((el) => {
      el.style.lineHeight = (lh[cls] !== undefined) ? String(lh[cls]) : '';
    });
  });

  // spacing（カラムの gap / padding。無ければ解除）
  const sp = state.override.spacing;
  doc.querySelectorAll('.col-left, .col-right').forEach((el) => {
    if (sp && sp.scale != null) {
      const s = Number(sp.scale);
      el.style.gap = (20 * s) + 'px';
      el.style.padding = (22 * s) + 'px 24px ' + (26 * s) + 'px';
    } else {
      el.style.gap = '';
      el.style.padding = '';
    }
  });

  // layout
  const body = doc.querySelector('.body');
  if (body) {
    const L = state.override.layout;
    body.style.gridTemplateColumns = L ? `${L.left_fr}fr 1px ${L.right_fr}fr` : '';
  }

  // stars
  const host = doc.querySelector('.stars-val');
  if (host) wrapStars(host);

  // photo
  const box = doc.querySelector('.visual-box');
  if (box) {
    const p = state.override.photo;
    const file = (p && p.file) ? p.file : (state.data.photo || null);
    if (file) {
      const fit = (p && p.object_fit) || 'cover';
      const pos = (p && p.object_position) || '50% 50%';
      box.innerHTML = `<img src="/photos/${file}" style="object-fit:${fit};object-position:${pos}" alt="">`;
    } else {
      box.innerHTML = '<span class="photo-placeholder">PHOTO HERE</span>';
    }
    box.setAttribute('data-editor-field', 'photo:photo');
  }
}

// ─── YZRS ハブへ実体を登録（モジュール連携） ──────────────
if (window.YZRS) {
  window.YZRS.state = state;
  window.YZRS.iframe = iframe;
  window.YZRS.switchCard = switchCard;
  window.YZRS.applyOverrideToDom = applyOverrideToDom;
  window.YZRS.showDirty = markDirty;
  window.YZRS.setFontSize = (cssClass, px) => {
    applyFontSizeToClass(cssClass, px);
    setFontSizeOverride(cssClass, px);
  };
  // Auto-Fit（autofit.js）が使う apply-only / write 系ヘルパ
  window.YZRS.applyFontSizeToClass = applyFontSizeToClass;
  window.YZRS.applyLineHeightToClass = applyLineHeightToClass;
  window.YZRS.applySpacing = applySpacing;
  window.YZRS.applyLayout = applyLayout;
  window.YZRS.setLineHeight = (cssClass, lh) => {
    applyLineHeightToClass(cssClass, lh);
    setLineHeightOverride(cssClass, lh);
  };
  window.YZRS.setSpacing = (scale) => {
    applySpacing(scale);
    setSpacingOverride(scale);
  };
  window.YZRS.setLayout = (left, right) => {
    applyLayout(left, right);
    setLayoutOverride(left, right);
  };
  // field 名（data-editor-field の末尾）→ iframe 内要素。locks / heatmap が共用。
  window.YZRS.fieldToElements = (doc, field) => {
    doc = doc || iframe.contentDocument;
    if (!doc || !field) return [];
    return Array.from(doc.querySelectorAll(`[data-editor-field$=":${field}"]`));
  };
  window.YZRS.clearSelection = () => {
    state.selection = null;
    renderInspectorEmpty();
    const d = iframe.contentDocument;
    if (d) d.querySelectorAll('.editor-selected').forEach((n) => n.classList.remove('editor-selected'));
  };
  // Task8 cleanup（cleanup.js）が baseline 比較に使う唯一の真実 + UI ヘルパ
  window.YZRS.baselineText = baselineText;
  window.YZRS.setStatus = setStatus;
}

// ─── 起動 ───────────────────────────────────────
loadCardList().catch(e => setStatus('起動失敗: ' + e.message));

// Cmd-S 保存
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveOverride();
  }
});
