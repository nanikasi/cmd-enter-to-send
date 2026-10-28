const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { EditorState, TextSelection } = require('prosemirror-state');
const { EditorView } = require('prosemirror-view');
const { Schema } = require('prosemirror-model');
const { schema: basic } = require('prosemirror-schema-basic');

// Integration test against a real ProseMirror editor for the openai/codex#53972 workaround.
// Chrome's editing behaviour is simulated by hand: composition text is inserted as DOM text,
// and the small tsu is appended where Chrome would put it.

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A non-inclusive mark like ChatGPT's literal-paste mark.
const schema = new Schema({
  nodes: basic.spec.nodes,
  marks: {
    literal: {
      inclusive: false,
      parseDOM: [{ tag: 'span[data-prompt-literal-paste]' }],
      toDOM: () => ['span', { 'data-prompt-literal-paste': '' }, 0],
    },
  },
});

function setupEditor({ withExtension }) {
  const dom = new JSDOM('<!doctype html><body><div id="ed"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  // prosemirror-view reads these from the global scope.
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    MutationObserver: win.MutationObserver,
    Node: win.Node,
    getSelection: () => win.getSelection(),
    getComputedStyle: win.getComputedStyle.bind(win),
  });
  const zero = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  win.Element.prototype.getClientRects = () => [];
  win.Range.prototype.getClientRects = () => [];
  win.Range.prototype.getBoundingClientRect = zero;
  if (withExtension) win.eval(SCRIPT);

  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('ABC', [schema.marks.literal.create()])]),
  ]);
  const view = new EditorView(win.document.getElementById('ed'), {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 4) }),
  });
  view.dom.focus();
  const p = view.dom.firstChild;
  const span = p.firstChild;
  const spanText = span.firstChild;

  const spanWrites = [];
  new win.MutationObserver((records) => {
    for (const r of records) if (r.type === 'characterData' && r.target === spanText) spanWrites.push(r.oldValue);
  }).observe(span, { subtree: true, characterData: true, characterDataOldValue: true });
  let flushes = 0;
  new win.MutationObserver(() => { flushes++; })
    .observe(p, { subtree: true, childList: true, characterData: true, attributes: true });

  const compositionNode = () => [...p.childNodes].filter((n) => n.nodeType === 3).pop();
  return { win, view, p, span, spanText, spanWrites, flushes: () => flushes, compositionNode };
}

async function typeFirstChar(ed, text) {
  const { win, view } = ed;
  view.dom.dispatchEvent(new win.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  const sel = win.getSelection();
  const at = sel.focusNode;
  const node = win.document.createTextNode(text);
  if (at.nodeType === 3) at.parentNode.insertBefore(node, at.nextSibling);
  else at.insertBefore(node, at.childNodes[sel.focusOffset] || null);
  sel.collapse(node, node.length);
  await sleep(30);
}

async function endComposition(ed, data) {
  ed.view.dom.dispatchEvent(new ed.win.CompositionEvent('compositionend', { bubbles: true, data }));
  await sleep(60);
}

test('without the extension, ProseMirror rewrites the mark text node when Chrome writes into it', async () => {
  const ed = setupEditor({ withExtension: false });
  await typeFirstChar(ed, 't');

  // Chrome prepends the small tsu at the end of the previous text node, inside the mark.
  ed.spanText.appendData('っ');
  await sleep(30);

  assert.equal(ed.view.state.doc.textContent, 'ABCっt');
  assert.deepEqual(ed.spanWrites, ['ABC', 'ABCっ']);
  ed.view.destroy();
});

test('with the extension, the mark is sealed during composition and never rewritten', async () => {
  const ed = setupEditor({ withExtension: true });
  await typeFirstChar(ed, 't');
  assert.equal(ed.span.getAttribute('contenteditable'), 'false');

  // With the mark non-editable, Chrome inserts into the composition node instead.
  ed.compositionNode().insertData(0, 'っ');
  await sleep(30);
  assert.equal(ed.view.state.doc.textContent, 'ABCっt');
  assert.equal(ed.span.getAttribute('contenteditable'), 'false');

  ed.compositionNode().replaceData(1, 1, 'て');
  await sleep(30);
  assert.equal(ed.view.state.doc.textContent, 'ABCって');

  await endComposition(ed, 'って');
  assert.equal(ed.span.hasAttribute('contenteditable'), false);
  assert.equal(ed.p.innerHTML, '<span data-prompt-literal-paste="">ABC</span>って');
  assert.deepEqual(ed.spanWrites, []);
  assert.ok(ed.flushes() < 20, `editor and extension must not ping-pong (flushes=${ed.flushes()})`);
  ed.view.destroy();
});
