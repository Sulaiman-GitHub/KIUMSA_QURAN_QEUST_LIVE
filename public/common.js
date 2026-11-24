'use strict';

/* Small helpers shared by the player and host pages. No innerHTML anywhere: all text goes through textContent. */
window.QQ = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** h('div', 'class names', 'text', [children]) */
  function h(tag, cls, text, children) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    if (children) children.forEach((c) => c && el.appendChild(c));
    return el;
  }

  const LETTERS = ['A', 'B', 'C', 'D'];

  /**
   * Countdown driven by the server's remaining time. onTick(leftMs, limitMs) runs ~10x/second.
   * Using remaining-time (not a wall-clock deadline from the server) keeps phones with a wrong
   * clock accurate.
   */
  function makeTimer(onTick) {
    let deadline = 0;
    let limit = 1;
    let frozenLeft = 0;
    let frozen = true;
    const tick = () => onTick(frozen ? frozenLeft : Math.max(0, deadline - Date.now()), limit);
    setInterval(tick, 100);
    return {
      set(remainingMs, limitMs, isFrozen) {
        limit = limitMs || 1;
        frozen = !!isFrozen;
        frozenLeft = remainingMs;
        deadline = Date.now() + remainingMs;
        tick();
      },
    };
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  return { $, $$, h, LETTERS, makeTimer, ordinal };
})();
