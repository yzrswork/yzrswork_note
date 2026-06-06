/* YZRS NOTE — Task1: Session Restore + Recent Cards
 *
 * localStorage に「最後に開いたカード」「最近のカード（最大5）」を保持し、
 * 起動時に復元する。Windows Chrome の localStorage 破損に備え、
 * 読込は必ず try/catch で安全化する（壊れていたら破棄して既定値）。
 */
(function () {
  const KEY = 'yzrs.editor.session.v1';
  const DEFAULT_SESSION = { lastCardId: null, recentCards: [] };
  const MAX_RECENT = 5;

  function loadSession() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULT_SESSION };
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') throw new Error('shape');
      return {
        lastCardId: (typeof o.lastCardId === 'string') ? o.lastCardId : null,
        recentCards: Array.isArray(o.recentCards)
          ? o.recentCards.filter((x) => typeof x === 'string').slice(0, MAX_RECENT)
          : [],
      };
    } catch (e) {
      // 破損時は破棄して既定値（仕様: localStorage Corruption Handling）
      try { localStorage.removeItem(KEY); } catch (_) { /* noop */ }
      return { ...DEFAULT_SESSION };
    }
  }

  function saveSession(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* quota等は無視 */ }
  }

  let session = loadSession();

  function pushRecent(id) {
    if (!id) return;
    // 重複なし・新しい順・最大5
    session.recentCards = [id, ...session.recentCards.filter((x) => x !== id)].slice(0, MAX_RECENT);
    session.lastCardId = id;
    saveSession(session);
    renderRecent();
  }

  function renderRecent() {
    const host = document.getElementById('recent-list');
    if (!host) return;
    const st = window.YZRS.state || {};
    const cards = st.cards || [];
    host.innerHTML = '';
    if (!session.recentCards.length) {
      host.innerHTML = '<span class="recent-empty">—</span>';
      return;
    }
    for (const id of session.recentCards) {
      const c = cards.find((x) => x.id === id);
      const b = document.createElement('button');
      b.className = 'recent-item' + (id === st.currentId ? ' active' : '');
      b.title = c ? `${id} — ${c.title_en}` : id;
      b.textContent = id;
      b.addEventListener('click', () => {
        if (window.YZRS.switchCard) window.YZRS.switchCard(id);
      });
      host.appendChild(b);
    }
  }

  // 起動時のカード選択（仕様: 1.restore lastCardId / 2.fallback first）
  window.YZRS.session = {
    restoreStartCard(cards) {
      if (session.lastCardId && cards.some((c) => c.id === session.lastCardId)) {
        return session.lastCardId;
      }
      return cards.length ? cards[0].id : null;
    },
    renderRecent,
  };

  // カード切替のたびに recent を更新
  window.YZRS.onCardSwitch((id) => pushRecent(id));
})();
