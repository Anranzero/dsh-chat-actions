import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
function setup() {
  let definition;
  const slots = new Map();
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: entry => { definition = entry; } }, setInterval: () => 1, clearInterval() {} },
    console: { info() {}, warn() {} },
  });
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(Boolean) }),
    useRef: current => ({ current }), useState: value => [value, () => {}], useEffect() {},
  };
  const plugin = definition.factory(() => react);
  plugin.apply({
    effect: fn => fn(), get() {}, inject() {},
    locale: { register: () => () => {}, bind: () => key => key },
    slots: { inject: (_name, fn) => fn(), register: (entry, view) => { slots.set(entry.id || entry.key, { ...entry, view }); return () => {}; } },
  });
  return { actions: plugin.quoteActions, view: slots.get('chat-actions-tools').view };
}

// A text-only DOM adapter exercises the actual range/locator functions across
// message boundaries without starting a browser or touching a real draft.
function transcript(messages) {
  const root = { querySelectorAll: () => rows };
  const doc = {
    createTreeWalker: row => {
      let i = 0;
      return { nextNode: () => row.nodes[i++] || null };
    },
    createRange: () => {
      const range = {
        setStart(node, offset) { this.startContainer = node; this.startOffset = offset; },
        setEnd(node, offset) { this.endContainer = node; this.endOffset = offset; },
        toString() {
          const row = this.startContainer.parentElement;
          const offset = node => row.nodes.slice(0, row.nodes.indexOf(node)).reduce((n, item) => n + item.textContent.length, 0);
          return row.textContent.slice(offset(this.startContainer) + this.startOffset, offset(this.endContainer) + this.endOffset);
        },
      };
      return range;
    },
  };
  const rows = messages.map(([key, text]) => {
    const row = { key, ownerDocument: doc, getAttribute: () => key, closest: () => root };
    row.nodes = (Array.isArray(text) ? text : [text]).map(value => ({ nodeType: 3, textContent: value, parentElement: row }));
    Object.defineProperty(row, 'textContent', { get: () => row.nodes.map(node => node.textContent).join('') });
    return row;
  });
  return { root, rows };
}

test('saved source identity selects the correct original message even when text repeats', () => {
  const { actions } = setup();
  const { root, rows } = transcript([['first', 'same text'], ['second', 'same text']]);
  const found = actions.locateQuote(root, { text: 'same', origin: { sessionId: 'main', key: 'second', start: 0, end: 4 } }, 'main');
  assert.equal(found.row, rows[1]);
  assert.equal(found.range.toString(), 'same');
});

test('a foreign session, missing source or changed source cannot redirect a quote', () => {
  const { actions } = setup();
  const { root } = transcript([['original', 'changed'], ['other', 'quoted text']]);
  const payload = { text: 'quoted text', origin: { sessionId: 'main', key: 'original', start: 0, end: 11 } };
  assert.equal(actions.locateQuote(root, payload, 'side'), null);
  assert.equal(actions.locateQuote(root, payload, 'main'), null);
  payload.origin.key = 'gone';
  assert.equal(actions.locateQuote(root, payload, 'main'), null);
});

test('legacy quotes require one unambiguous source, including duplicates within one message', () => {
  const { actions } = setup();
  for (const messages of [[['a', 'quoted'], ['b', 'quoted']], [['a', 'quoted quoted'], ['b', 'quoted']]]) {
    assert.equal(actions.locateQuote(transcript(messages).root, { text: 'quoted' }, 'main'), null);
  }
  const { root, rows } = transcript([['a', ['first ', 'quoted', ' last']]]);
  const found = actions.locateQuote(root, { text: 'quoted' }, 'main');
  assert.equal(found.row, rows[0]);
  assert.equal(found.range.toString(), 'quoted');
});

test('rendered line breaks and whitespace can be mapped without accepting invented text', () => {
  const { actions } = setup();
  const { root } = transcript([['a', 'before hello   world after']]);
  const found = actions.locateQuote(root, { text: 'hello\nworld' }, 'main');
  assert.equal(found.range.toString(), 'hello   world');
  assert.equal(actions.locateQuote(root, { text: 'invented replacement' }, 'main'), null);
  const block = transcript([['a', 'firstsecond']]);
  assert.ok(actions.locateQuote(block.root, {
    text: 'first\nsecond', origin: { sessionId: 'main', key: 'a', start: 0, end: 11, domText: 'firstsecond' },
  }, 'main'));
});

test('reselection stores new provenance and preserves unrelated references and text', () => {
  const { actions } = setup();
  const ref = { source: 'chat-actions-quote', ref: JSON.stringify({ text: 'old', origin: { key: 'old' } }), offset: 0, length: 3 };
  const file = { source: 'files', offset: 4, length: 4, ref: 'file' };
  const origin = { sessionId: 'main', key: 'original', start: 7, end: 12 };
  const draft = actions.replaceQuote({ text: 'old file tail', references: [ref, file] }, ref, 'quote', origin);
  assert.equal(JSON.parse(draft.references[0].ref).origin.key, 'original');
  assert.equal(draft.text.slice(draft.references[1].offset, draft.references[1].offset + 4), 'file');
  assert.ok(draft.text.endsWith(' tail'));
  let received;
  actions.addSelectedQuote({ insertQuote: (...args) => { received = args; return true; } }, { text: 'quote', origin });
  assert.equal(received[2], origin);
});

test('quote controls use a count entry and a native popover containing read-only previews', () => {
  const app = setup();
  const input = { draftRev: 1, occurrences: [{ source: 'chat-actions-quote', ref: JSON.stringify({ text: 'original' }), offset: 0 }] };
  const tools = app.view({ useInput: () => input, t: key => key });
  const child = tools.children[0];
  const view = child.type(child.props);
  const all = [];
  const walk = node => { if (!node || typeof node !== 'object') return; all.push(node); node.children.forEach(walk); };
  walk(view);
  assert.ok(all.some(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog'));
  assert.ok(all.some(node => node.props.popover === 'auto' && node.props.role === 'dialog'));
  assert.equal(all.some(node => node.type === 'textarea' || node.props.contentEditable), false);
  assert.ok(all.some(node => node.children.includes('original')));
});
