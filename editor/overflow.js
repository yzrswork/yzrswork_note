/* YZRS NOTE — Task4: Overflow Detection
 *
 * 印刷前にレイアウト破綻を検知する。
 * - 対象フィールド: concept / memo / parts / spec
 *   判定: el.scrollHeight - el.clientHeight > 1
 *   （+1 は Windows のフォントレンダリング差を吸収する許容値）
 * - さらに A5 ページ全体のはみ出し（印刷時 overflow:hidden で切れる領域）も検知。
 * - 再計算は debounce(100ms)。iframe には editor 専用 CSS のみ注入し、
 *   出力HTMLには一切痕跡を残さない。
 */
(function () {
  let timer = null;

  function injectCss(doc) {
    if (!doc || doc.getElementById('__overflow_css__')) return;
    const st = doc.createElement('style');
    st.id = '__overflow_css__';
    // 仕様: outline: 2px solid red;（offset を内側にしてカード端でも見えるように）
    st.textContent =
      '.__overflow__{outline:2px solid red !important;outline-offset:-1px;}' +
      '.__page_overflow__{outline:2px dashed red !important;outline-offset:-2px;}';
    doc.head.appendChild(st);
  }

  function overflows(el) {
    return el && (el.scrollHeight - el.clientHeight > 1);
  }

  // A5 縦長: 横148mm × 縦210mm。画面上の .page 幅から目標高さを逆算して判定。
  function pageOverflows(doc) {
    const page = doc.querySelector('.page');
    if (!page) return false;
    const targetH = page.clientWidth * (210 / 148);
    return (page.scrollHeight - targetH > 1);
  }

  function check() {
    const frame = window.YZRS.iframe;
    const doc = frame && frame.contentDocument;
    if (!doc) return;

    doc.querySelectorAll('.__overflow__').forEach((el) => el.classList.remove('__overflow__'));
    doc.querySelectorAll('.__page_overflow__').forEach((el) => el.classList.remove('__page_overflow__'));

    const warns = [];
    const mark = (el, name) => {
      if (overflows(el)) {
        el.classList.add('__overflow__');
        if (!warns.includes(name)) warns.push(name);
      }
    };

    mark(doc.querySelector('.concept-text'), 'concept');
    mark(doc.querySelector('.memo-text'), 'memo');
    // spec-val 6つ（5番目=PARTS）
    doc.querySelectorAll('.spec-val').forEach((el, i) => mark(el, i === 4 ? 'parts' : 'spec'));

    // ページ全体（印刷はみ出し）
    if (pageOverflows(doc)) {
      const page = doc.querySelector('.page');
      if (page) page.classList.add('__page_overflow__');
      warns.push('page (A5)');
    }

    renderWarnings(warns);
  }

  function renderWarnings(warns) {
    const host = document.getElementById('overflow-warnings');
    if (!host) return;
    host.innerHTML = '';
    for (const n of warns) {
      const s = document.createElement('span');
      s.className = 'overflow-warn';
      s.textContent = '⚠ ' + n + ' overflow';
      host.appendChild(s);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, 100);
  }

  window.YZRS.onIframeLoad((doc) => { injectCss(doc); schedule(); });
  window.YZRS.onChange(schedule);
  window.addEventListener('resize', schedule);

  window.YZRS.overflow = { check, schedule };
})();
