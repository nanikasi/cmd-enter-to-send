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

  // The element that owns focus for a message input: the textarea itself or the editing host.
  function editableRoot(el) {
    if (!el || typeof el.closest !== 'function') return null;
    if (el.tagName === 'TEXTAREA') return el;
    return el.closest('[contenteditable]:not([contenteditable="false"])');
  }

  function isEditable(el) {
    return editableRoot(el) !== null;
  }

  function install(win) {
    const ours = new WeakSet();
    let composing = false;

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

    // Workaround for https://github.com/openai/codex/issues/53972.
    //
    // ChatGPT wraps pasted text in a mark element (<span data-prompt-literal-paste>) that typed
    // text must not inherit, so an IME composition started right after it lives in a sibling text
    // node. Chrome applies composition updates incrementally, and a character inserted at the
    // start of the composition (e.g. the small tsu of "tte") is placed at the end of the previous
    // text node, i.e. inside the mark. ProseMirror then rewrites that text node's nodeValue to
    // move the character out, which per the DOM live-range rules collapses the start of Chrome's
    // internal composition range to offset 0 of the mark. The next update replaces that range
    // and wipes the pasted text.
    //
    // Chrome does not move a caret position across an editing boundary, so making the mark
    // element non-editable for the duration of the composition keeps every composition update
    // inside the composition's own text node. ProseMirror removes any DOM node it does not own on
    // every redraw, so a placeholder of our own cannot be kept there, but its DOM observer
    // ignores contenteditable attribute changes, so this attribute survives and causes no redraw.
    const sealed = new Set();

    function compositionTextNode() {
      const sel = win.document.getSelection();
      const node = sel && sel.focusNode;
      if (!node || node.nodeType !== 3 || !isEditable(node.parentNode)) return null;
      return node;
    }

    function markBefore(textNode) {
      const prev = textNode.previousSibling;
      if (prev === null || prev.nodeType !== 1 || prev.textContent === '') return null;
      if (prev.hasAttribute('contenteditable')) return null;
      return prev;
    }

    function seal(el) {
      el.setAttribute('contenteditable', 'false');
      sealed.add(el);
    }

    function unsealAll() {
      for (const el of sealed) el.removeAttribute('contenteditable');
      sealed.clear();
    }

    function onMutation() {
      if (!composing) return;
      const textNode = compositionTextNode();
      const mark = textNode && markBefore(textNode);
      if (mark) seal(mark);
    }

    // Capture on window runs before any listener the page registers on the document or elements.
    win.addEventListener('keydown', onKeydown, true);
    win.addEventListener('keypress', onKeypress, true);
    win.addEventListener('compositionstart', () => { composing = true; }, true);
    win.addEventListener('compositionend', () => { composing = false; unsealAll(); }, true);
    // Registered at document_start, so this observer runs before the editor's own observer
    // in each mutation flush.
    new win.MutationObserver(onMutation).observe(win.document, { subtree: true, childList: true, characterData: true });
  }

  install(window);
})();
