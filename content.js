(function () {
  'use strict';

  // Fallback only: used when the site does not react to a re-dispatched Enter.
  const SEND_BUTTON_SELECTOR = [
    'button[data-testid="send-button"]', // ChatGPT
    '#composer-submit-button', // ChatGPT
    'button[aria-label="Send message"]', // Claude
    'button[aria-label="Send Message"]',
    'button[aria-label="メッセージを送信"]',
  ].join(',');

  // 'newline' | 'send' | 'pass'
  function classify(event) {
    if (event.key !== 'Enter') return 'pass';
    // Enter that confirms an IME conversion (e.g. Japanese input) must reach the site as-is.
    if (event.isComposing || event.keyCode === 229) return 'pass';
    if (event.shiftKey || event.ctrlKey || event.altKey) return 'pass';
    return event.metaKey ? 'send' : 'newline';
  }

  function isEditable(el) {
    if (!el || typeof el.closest !== 'function') return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.closest('[contenteditable]:not([contenteditable="false"])') !== null;
  }

  function install(win) {
    const ours = new WeakSet();

    // Returns true when a site handler consumed the event (called preventDefault).
    function redispatch(target, init) {
      const ev = new win.KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        ...init,
      });
      ours.add(ev);
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    }

    function clickNearestSendButton(from) {
      for (let node = from.parentElement; node; node = node.parentElement) {
        const button = node.querySelector(SEND_BUTTON_SELECTOR);
        if (!button) continue;
        if (!button.disabled) button.click();
        return;
      }
    }

    function onKeydown(event) {
      if (ours.has(event)) return;
      const action = classify(event);
      if (action === 'pass' || !isEditable(event.target)) return;

      // Hide the original event from every site handler.
      event.stopImmediatePropagation();

      if (action === 'newline') {
        // Let the site insert its own newline via Shift+Enter; if nobody handles it,
        // leave the original event's native default (a newline) alone.
        if (redispatch(event.target, { shiftKey: true })) event.preventDefault();
        return;
      }

      event.preventDefault();
      if (!redispatch(event.target, {})) clickNearestSendButton(event.target);
    }

    // Some handlers send on keypress instead of keydown.
    function onKeypress(event) {
      if (classify(event) !== 'pass' && isEditable(event.target)) event.stopImmediatePropagation();
    }

    // Capture on window runs before any listener the page registers on the document or elements.
    win.addEventListener('keydown', onKeydown, true);
    win.addEventListener('keypress', onKeypress, true);
  }

  install(window);
})();
