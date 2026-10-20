import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function setup({ rows = [], running = false, prompt, create, ready, input } = {}) {
  let definition;
  let codec;
  const slots = new Map();
  const timers = [];
  const calls = [];
  const effects = [];
  const subscriptions = new Set();
  const inbox = { getSnapshot: () => ({ 'next-turn': rows }), subscribe: (fn) => { subscriptions.add(fn); return () => subscriptions.delete(fn); } };
  const session = {
    getSnapshot: () => ({ running }),
    projections: { faceOf: () => inbox },
    beginSubmission: () => ({ requestId: 'submission-id', abandon: () => calls.push(['abandon']) }),
    prompt: async (...args) => { calls.push(['prompt', ...args]); return prompt ? prompt(...args) : { ok: true }; },
    updateQueue: async (...args) => { calls.push(['updateQueue', ...args]); return { ok: true }; }
  };
  const conversation = {
    input: { for: () => input },
    updateQueue: async (id, action) => { calls.push(['remove', id, action]); rows = rows.filter((row) => row.id !== id); },
    send: async () => { calls.push(['unidentified-send']); }
  };
  const binding = { ctx: { get: () => conversation }, session };
  const services = { sessions: {
    binding: () => binding,
    scope: () => binding.ctx,
    list: { getSnapshot: () => ({ byId: { main: { cwd: '/workspace' } } }) },
    create: async (options) => { calls.push(['create', options]); return create ? create(options) : 'side'; },
    retain: (id, options) => { calls.push(['retain', id, options]); return { sessionId: id, binding, ready: ready ? ready() : Promise.resolve(), release: () => calls.push(['release', id]) }; }
  } };
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => { const off = fn(); if (typeof off === 'function') effects.push(off); return off; },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { inject: (_name, fn) => fn(), register: (entry, view) => { slots.set(entry.id || entry.key, { ...entry, view }); return () => {}; } },
    inject: (names, fn) => { if (names.includes('inputTriggers')) fn({ ...ctx, inputTriggers: { registerSource: (entry) => { codec = entry.codec; return () => {}; } } }); }
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { definition = entry; } }, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {} },
    console: { info() {}, warn() {} }, Date, Map, Set, Promise
  });
  const state = [];
  const refs = [];
  const hookEffects = [];
  let cursor = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useRef: (initial) => { const i = cursor++; return refs[i] ||= { current: initial }; },
    useEffect: (fn, deps) => {
      const i = cursor++;
      const old = hookEffects[i];
      if (old && deps.every((value, index) => Object.is(value, old.deps[index]))) return;
      old?.off?.();
      hookEffects[i] = { deps, off: fn() };
    }
  };
  const plugin = definition.factory(() => react);
  plugin.apply(ctx);
  return {
    codec, plugin, slots, calls,
    tick: async () => { for (const fn of timers) fn(); await new Promise(setImmediate); },
    arrive: (row) => { rows.push(row); for (const fn of subscriptions) fn(); },
    wake: (id = 'queued') => slots.get('queue').inject('main').wakeQueue(id),
    tools: slots.get('chat-actions-tools').inject('main'),
    renderAsk: (props) => { cursor = 0; return slots.get('dsh-chat-actions/ask').view(props); },
    unmountAsk: () => hookEffects.forEach((effect) => effect?.off?.()),
    dispose: () => effects.reverse().forEach((fn) => fn())
  };
}

test('quotes preserve code indentation and blank lines', async () => {
  const app = setup();
  const text = 'if ready:\n    run()\n\n\tfinish()';
  assert.equal(await app.codec.serialize(JSON.stringify({ text })), '> [引用 · 对话片段]\n> if ready:\n>     run()\n> \n> \tfinish()\n\n');
  app.dispose();
});

test('editing one reference preserves the rest of the draft and shifts later references', () => {
  const app = setup();
  const first = { source: 'chat-actions-quote', ref: JSON.stringify({ text: 'old' }), offset: 2, length: 3, clipboardText: 'old', label: 'old' };
  const second = { source: 'files', ref: '/file', offset: 6, length: 4, clipboardText: 'file', label: 'file' };
  const draft = { text: 'Q old file tail', references: [first, second] };
  const edited = app.plugin.quoteActions.replaceQuote(draft, first, 'new\n    code');
  assert.equal(edited.text.slice(0, 2), 'Q ');
  assert.ok(edited.text.endsWith(' file tail'));
  assert.equal(JSON.parse(edited.references[0].ref).text, 'new\n    code');
  assert.equal(edited.text.slice(edited.references[1].offset, edited.references[1].offset + 4), 'file');
  assert.equal(draft.text, 'Q old file tail');
  const removed = app.plugin.quoteActions.replaceQuote(draft, first, null);
  assert.equal(removed.text, 'Q  file tail');
  assert.equal(removed.references.length, 1);
  app.dispose();
});

test('quote edits reject stale revisions and busy drafts before replacing the semantic document', () => {
  let revision = 1;
  let phase = 'plain';
  const reference = { source: 'chat-actions-quote', ref: JSON.stringify({ text: 'old' }), offset: 7, length: 3 };
  const input = {
    state: { getSnapshot: () => ({ draftRev: revision, phase }) },
    draftSnapshot: { text: 'before old after', references: [reference], command: { token: '/plan' } },
    setDraft: (draft) => { input.draftSnapshot = draft; revision += 1; }, focus() {}
  };
  const app = setup({ input });
  assert.equal(app.tools.updateQuote(reference, 'new', 0), false);
  assert.equal(input.draftSnapshot.text, 'before old after');
  phase = 'busy';
  assert.equal(app.tools.updateQuote(reference, 'new', revision), false);
  phase = 'plain';
  assert.equal(app.tools.updateQuote(reference, 'new', revision), true);
  assert.ok(input.draftSnapshot.text.startsWith('before > [引用'));
  assert.ok(input.draftSnapshot.text.endsWith(' after'));
  assert.equal(input.draftSnapshot.command.token, '/plan');
  app.dispose();
});

test('resending an edited user message queues it without steering the current turn', async () => {
  const app = setup();
  await app.tools.sendPrompt('edited message');
  assert.equal(app.calls.find((call) => call[0] === 'prompt')[2], 'queue');
  app.dispose();
});

test('a transport failure retires the pending submission echo', async () => {
  const app = setup({ prompt: async () => { throw new Error('offline'); } });
  await assert.rejects(app.tools.sendPrompt('edited message'), /offline/);
  assert.ok(app.calls.some((call) => call[0] === 'abandon'));
  app.dispose();
});

test('paused queue wake tracks the actual request and removes a late marker without touching attachments', async () => {
  const queued = { id: 'queued', content: [{ type: 'image', attachment: { id: 'photo' } }, { type: 'text', text: 'question' }] };
  const app = setup({ rows: [queued] });
  await app.wake();
  const prompt = app.calls.find((call) => call[0] === 'prompt');
  assert.ok(prompt, 'Wake must use an identified session prompt');
  await app.tick();
  app.arrive({ id: 'marker', content: prompt[1], source: { kind: 'user', rpcId: prompt[4] } });
  await app.tick();
  assert.deepEqual(app.calls.filter((call) => call[0] === 'remove').map((call) => call[1]), ['marker']);
  assert.equal(queued.content[0].attachment.id, 'photo');
  app.dispose();
});

test('running queue sends its existing row through native steering', async () => {
  const app = setup({ running: true, rows: [{ id: 'queued', content: [{ type: 'text', text: 'next' }] }] });
  await app.wake();
  const action = app.calls.find((call) => call[0] === 'updateQueue');
  assert.equal(action?.[1], 'queued');
  assert.equal(action?.[2].kind, 'steer');
  assert.equal(app.calls.some((call) => call[0] === 'prompt'), false);
  app.dispose();
});

test('concurrent wake clicks admit only one request', async () => {
  const app = setup({ rows: [{ id: 'queued', content: [{ type: 'text', text: 'next' }] }] });
  await Promise.all([app.wake(), app.wake()]);
  assert.equal(app.calls.filter((call) => call[0] === 'prompt').length, 1);
  app.dispose();
});

test('side chat retains a separate session without submitting to the main chat', async () => {
  const app = setup();
  const sidebar = app.slots.get('dsh-chat-actions/ask').inject('main');
  const reference = await sidebar.createSideSession('main');
  assert.equal(reference.sessionId, 'side');
  assert.ok(app.calls.some((call) => call[0] === 'retain' && call[1] === 'side'));
  assert.equal(app.calls.some((call) => call[0] === 'prompt'), false);
  reference.release();
  app.dispose();
});

test('side chat releases its reference if attachment to the new session fails', async () => {
  const app = setup({ ready: () => Promise.reject(new Error('attach-failed')) });
  await assert.rejects(app.slots.get('dsh-chat-actions/ask').inject('main').createSideSession('main'), /attach-failed/);
  assert.ok(app.calls.some((call) => call[0] === 'release' && call[1] === 'side'));
  app.dispose();
});

test('a second click before the queue projection catches up does not wake twice', async () => {
  const app = setup({ rows: [{ id: 'queued', content: [{ type: 'text', text: 'next' }] }] });
  await app.wake();
  await assert.rejects(app.wake(), /queue.waking/);
  assert.equal(app.calls.filter((call) => call[0] === 'prompt').length, 1);
  app.dispose();
});

test('wake rejection allows a retry and never removes a user message containing the marker text', async () => {
  let attempt = 0;
  const app = setup({ rows: [{ id: 'queued', content: [{ type: 'text', text: '·' }] }],
    prompt: async () => ++attempt === 1 ? { ok: false, error: { code: 'offline' } } : { ok: true } });
  await assert.rejects(app.wake(), /offline/);
  await app.wake();
  await app.tick();
  assert.equal(app.calls.some((call) => call[0] === 'remove'), false);
  assert.equal(attempt, 2);
  app.dispose();
});

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const child of node.children || []) { const match = find(child, predicate); if (match) return match; }
}

test('the ask panel routes to an isolated chat, renders native conversation content, and releases on close', async () => {
  const app = setup();
  const sent = [];
  const props = {
    ...app.slots.get('dsh-chat-actions/ask').inject('main'),
    sessionId: 'main',
    useTabInfo: () => ({ tab: { navigation: { params: { text: 'selected\n    code', sessionId: 'main' } } } }),
    t: (key) => key,
    SessionProvider: function Provider() {},
    renderFactorySlot: (name, options) => ({ type: 'native-conversation', props: { name, ...options } }),
    sendToSession: async (id, text) => sent.push({ id, text })
  };
  let view = app.renderAsk(props);
  find(view, (node) => node.type === 'textarea').props.onChange({ target: { value: 'explain' } });
  view = app.renderAsk(props);
  await find(view, (node) => node.type === 'button').props.onClick();
  view = app.renderAsk(props);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 'side');
  assert.ok(sent[0].text.includes('>     code'));
  assert.equal(find(view, (node) => node.type === props.SessionProvider).props.session.sessionId, 'side');
  assert.equal(find(view, (node) => node.type === 'native-conversation').props.name, 'conversation.content');
  app.unmountAsk();
  assert.equal(app.calls.filter((call) => call[0] === 'release' && call[1] === 'side').length, 1);
  app.dispose();
});

test('closing the ask panel during session creation releases the late reference without sending', async () => {
  let resolve;
  const app = setup({ create: () => new Promise((done) => { resolve = done; }) });
  let sent = false;
  const props = { ...app.slots.get('dsh-chat-actions/ask').inject('main'),
    sessionId: 'main', t: (key) => key,
    useTabInfo: () => ({ tab: { navigation: { params: { text: 'selected' } } } }),
    SessionProvider: function Provider() {}, renderFactorySlot() {},
    sendToSession: async () => { sent = true; } };
  const sending = find(app.renderAsk(props), (node) => node.type === 'button').props.onClick();
  app.unmountAsk();
  resolve('side');
  await sending;
  assert.equal(sent, false);
  assert.equal(app.calls.filter((call) => call[0] === 'release' && call[1] === 'side').length, 1);
  app.dispose();
});
