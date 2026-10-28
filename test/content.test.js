const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

// Loads content.js the same way Chrome does: as a classic script in the page.
function setup(body) {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only' });
  dom.window.eval(SCRIPT);
  return dom.window;
}

// Mimics Claude / ChatGPT: Enter sends, Shift+Enter inserts a newline.
function fakeSite(el) {
  const log = [];
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    if (e.shiftKey) {
      e.preventDefault();
      log.push('newline');
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      log.push('send');
    }
  });
  return log;
}

function press(win, target, init = {}, type = 'keydown') {
  const ev = new win.KeyboardEvent(type, {
    key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true, ...init,
  });
  target.dispatchEvent(ev);
  return ev;
}

test('contenteditable: Enter becomes a newline instead of sending', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const log = fakeSite(ed);

  const ev = press(win, ed);

  assert.deepEqual(log, ['newline']);
  assert.equal(ev.defaultPrevented, true);
});

test('contenteditable: Cmd+Enter sends', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const log = fakeSite(ed);

  const ev = press(win, ed, { metaKey: true });

  assert.deepEqual(log, ['send']);
  assert.equal(ev.defaultPrevented, true);
});

test('textarea: Enter is hidden from the site and left to the native newline', () => {
  const win = setup('<textarea id="ta"></textarea>');
  const ta = win.document.getElementById('ta');
  const sent = [];
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) sent.push(e);
  });

  const ev = press(win, ta);

  assert.equal(sent.length, 0);
  assert.equal(ev.defaultPrevented, false);
});

test('Shift+Enter is passed through untouched', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const log = fakeSite(ed);

  press(win, ed, { shiftKey: true });

  assert.deepEqual(log, ['newline']);
});

test('Enter during IME composition is passed through untouched', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const seen = [];
  ed.addEventListener('keydown', (e) => seen.push(e));

  const composing = press(win, ed, { isComposing: true });
  const legacyIme = press(win, ed, { keyCode: 229 });

  assert.deepEqual(seen, [composing, legacyIme]);
  assert.equal(composing.defaultPrevented, false);
  assert.equal(legacyIme.defaultPrevented, false);
});

test('Ctrl+Enter and Alt+Enter are passed through untouched', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const seen = [];
  ed.addEventListener('keydown', (e) => seen.push(e));

  const ctrl = press(win, ed, { ctrlKey: true });
  const alt = press(win, ed, { altKey: true });

  assert.deepEqual(seen, [ctrl, alt]);
});

test('Enter in a non-editable element or <input> is passed through untouched', () => {
  const win = setup('<input id="in"><button id="btn">x</button>');
  const seen = [];
  for (const id of ['in', 'btn']) {
    win.document.getElementById(id).addEventListener('keydown', (e) => seen.push(id));
    press(win, win.document.getElementById(id));
  }

  assert.deepEqual(seen, ['in', 'btn']);
});

test('Cmd+Enter falls back to the nearest send button when the site ignores Enter', () => {
  const win = setup(`
    <form><div id="ed" contenteditable="true"></div>
      <button type="button" data-testid="send-button" id="send">send</button></form>`);
  const ed = win.document.getElementById('ed');
  let clicks = 0;
  win.document.getElementById('send').addEventListener('click', () => clicks++);

  press(win, ed, { metaKey: true });

  assert.equal(clicks, 1);
});

test('Cmd+Enter does not also click the send button when the site already sent', () => {
  const win = setup(`
    <div id="ed" contenteditable="true"></div>
    <button type="button" aria-label="Send message" id="send">send</button>`);
  const ed = win.document.getElementById('ed');
  const log = fakeSite(ed);
  let clicks = 0;
  win.document.getElementById('send').addEventListener('click', () => clicks++);

  press(win, ed, { metaKey: true });

  assert.deepEqual(log, ['send']);
  assert.equal(clicks, 0);
});

test('Cmd+Enter does not click a disabled send button', () => {
  const win = setup(`
    <div id="ed" contenteditable="true"></div>
    <button type="button" aria-label="Send message" id="send" disabled>send</button>`);
  const ed = win.document.getElementById('ed');
  let clicks = 0;
  win.document.getElementById('send').addEventListener('click', () => clicks++);

  press(win, ed, { metaKey: true });

  assert.equal(clicks, 0);
});

test('plain Enter keypress is hidden from the site as well', () => {
  const win = setup('<textarea id="ta"></textarea>');
  const ta = win.document.getElementById('ta');
  const seen = [];
  ta.addEventListener('keypress', (e) => seen.push(e));

  const ev = press(win, ta, {}, 'keypress');

  assert.equal(seen.length, 0);
  assert.equal(ev.defaultPrevented, false);
});

test('events re-dispatched to the site carry keyCode 13', () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = win.document.getElementById('ed');
  const seen = [];
  ed.addEventListener('keydown', (e) => seen.push({ shift: e.shiftKey, meta: e.metaKey, keyCode: e.keyCode }));

  press(win, ed);
  press(win, ed, { metaKey: true });

  assert.deepEqual(seen, [
    { shift: true, meta: false, keyCode: 13 },
    { shift: false, meta: false, keyCode: 13 },
  ]);
});

// --- IME composition after a non-inclusive mark (openai/codex#53972) ---

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

function composer(win, html) {
  const ed = win.document.getElementById('ed');
  ed.innerHTML = html;
  return ed;
}

// Mimics Chrome inserting composition text as a new text node and moving the caret into it.
function startComposition(win, parent, text) {
  parent.dispatchEvent(new win.Event('compositionstart', { bubbles: true }));
  const node = win.document.createTextNode(text);
  parent.appendChild(node);
  win.getSelection().collapse(node, node.length);
  return node;
}

function endComposition(win, parent) {
  parent.dispatchEvent(new win.Event('compositionend', { bubbles: true }));
}

test('makes the mark before the composition text node non-editable while composing', async () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = composer(win, '<p><span data-prompt-literal-paste="">ABC</span></p>');
  const p = ed.firstChild;
  const span = p.firstChild;

  startComposition(win, p, 't');
  await flush();
  assert.equal(span.getAttribute('contenteditable'), 'false');

  p.lastChild.data = 'っt';
  await flush();
  assert.equal(span.getAttribute('contenteditable'), 'false');
  assert.equal(p.innerHTML, '<span data-prompt-literal-paste="" contenteditable="false">ABC</span>っt');
});

test('restores the mark when the composition ends', async () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = composer(win, '<p><span data-prompt-literal-paste="">ABC</span></p>');
  const p = ed.firstChild;
  const span = p.firstChild;
  startComposition(win, p, 'って');
  await flush();
  assert.equal(span.hasAttribute('contenteditable'), true);

  endComposition(win, p);
  await flush();

  assert.equal(span.hasAttribute('contenteditable'), false);
});

test('leaves an element that already declares contenteditable alone', async () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = composer(win, '<p><span contenteditable="false">chip</span></p>');
  const p = ed.firstChild;
  const span = p.firstChild;

  startComposition(win, p, 't');
  await flush();
  endComposition(win, p);
  await flush();

  assert.equal(span.getAttribute('contenteditable'), 'false');
});

test('leaves the DOM alone when the composition does not follow a mark', async () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = composer(win, '<p>ABC<br></p>');
  const p = ed.firstChild;

  startComposition(win, p, 't');
  await flush();

  assert.equal(p.innerHTML, 'ABC<br>t');
});

test('leaves the DOM alone outside a composition', async () => {
  const win = setup('<div id="ed" contenteditable="true"></div>');
  const ed = composer(win, '<p><span data-prompt-literal-paste="">ABC</span></p>');
  const p = ed.firstChild;
  const node = win.document.createTextNode('x');
  p.appendChild(node);
  win.getSelection().collapse(node, 1);
  await flush();

  assert.equal(p.innerHTML, '<span data-prompt-literal-paste="">ABC</span>x');
});

test('leaves non-editable content alone', async () => {
  const win = setup('<div id="ed"></div>');
  const ed = composer(win, '<p><span data-prompt-literal-paste="">ABC</span></p>');
  const p = ed.firstChild;

  startComposition(win, p, 't');
  await flush();

  assert.equal(p.innerHTML, '<span data-prompt-literal-paste="">ABC</span>t');
});
