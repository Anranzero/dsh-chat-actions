import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { SIDE_CHAT_INVOCATIONS } from '../side-chat/typert.js';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function setup({ rows = [], running = false, prompt, create, ready, input, events = [], fork, chat } = {}) {
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
  // The Client session face exposes committed events only through the binding's window.
  const eventSource = { getSnapshot: () => ({ entries: events.map((event) => ({ type: 'event', event })), hasMore: false, revision: 1 }) };
  const childSession = {
    beginSubmission: () => ({ requestId: 'child-submission', abandon: () => calls.push(['abandon']) }),
    prompt: async (...args) => { calls.push(['prompt-child', ...args]); return prompt ? prompt(...args) : { ok: true }; }
  };
  const conversation = {
    input: { for: () => input },
    updateQueue: async (id, action) => { calls.push(['remove', id, action]); rows = rows.filter((row) => row.id !== id); },
    send: async () => { calls.push(['unidentified-send']); }
  };
  const binding = { ctx: { get: () => conversation }, session, eventSource };
  const bindingFor = (id) => id === 'child' ? { ctx: binding.ctx, session: childSession, eventSource } : binding;
  const services = { uiConversation: { binding: () => ({ activate() {}, target: () => ({ getSnapshot: () => chat }) }) }, sessions: {
    binding: (id) => bindingFor(id),
    scope: () => binding.ctx,
    list: { getSnapshot: () => ({ byId: { main: { cwd: '/workspace' } } }) },
    create: async (options) => { calls.push(['create', options]); return create ? create(options) : 'side'; },
    fork: async (options) => { calls.push(['fork', options]); return fork ? fork(options) : 'child'; },
    retain: (id, options) => { calls.push(['retain', id, options]); return { sessionId: id, binding: bindingFor(id), ready: ready ? ready() : Promise.resolve(), release: () => calls.push(['release', id]) }; }
  }, uiWorkspace: {
    openSession: (id) => { calls.push(['openSession', id]); },
    archiveSession: async (id, options) => { calls.push(['archiveSession', id, options]); }
  } };
  const ctx = {
    get: (name) => services[name],
    effect: (fn) => { const off = fn(); if (typeof off === 'function') effects.push(off); return off; },
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: { inject: (_name, fn) => fn(), register: (entry, view) => { slots.set(entry.id || entry.key || entry.name, { ...entry, view }); return () => {}; } },
    inject: (names, fn) => { if (names.includes('inputTriggers')) fn({ ...ctx, inputTriggers: { registerSource: (entry) => { codec = entry.codec; return () => {}; } } }); }
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { definition = entry; } }, setInterval: (fn) => { timers.push(fn); return timers.length; }, clearInterval() {} },
    console: { info() {}, warn() {} }, Date, Map, Set, Promise, AbortController
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
  const plugin = definition.factory((id) => id === 'react' ? react : { MarkdownText: 'markdown' });
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

test('editing a sent message forks before that message and queues the edit on the child', async () => {
  const app = setup({ events: [
    { type: 'turn/start', seq: 2, data: {} },
    { type: 'user/message', seq: 4, data: { id: 'msg-1', source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 5, data: {} }
  ] });
  await app.tools.sendPrompt('edited message', { key: '13:input-messagemsg-1' });
  const fork = app.calls.find((call) => call[0] === 'fork');
  assert.ok(fork, 'edit must fork before the edited message');
  assert.equal(fork[1].sessionId, 'main');
  assert.equal(fork[1].atSeq, 3);
  assert.equal(fork[1].increaseTitle, undefined);
  assert.equal(app.calls.some((call) => call[0] === 'prompt'), false);
  const prompted = app.calls.findIndex((call) => call[0] === 'prompt-child');
  assert.ok(prompted > 0, 'the edit is sent into the child');
  const child = app.calls[prompted];
  assert.equal(child[1][0].text, 'edited message');
  assert.equal(child[2], 'queue');
  // Send first, then switch the view, then fold the pre-edit branch away.
  const opened = app.calls.findIndex((call) => call[0] === 'openSession');
  assert.equal(app.calls[opened][1], 'child');
  assert.ok(prompted < opened, 'the view switches only after the edit landed');
  const archived = app.calls.findIndex((call) => call[0] === 'archiveSession');
  assert.ok(archived > opened, 'the pre-edit session is archived after the switch');
  assert.equal(app.calls[archived][1], 'main');
  assert.ok(app.calls.some((call) => call[0] === 'release' && call[1] === 'child'));
  app.dispose();
});

test('a transport failure after forking retires the child submission and does not prompt the original session', async () => {
  const app = setup({
    events: [{ type: 'user/message', seq: 4, data: { id: 'msg-1' } }],
    prompt: async () => { throw new Error('offline'); }
  });
  await assert.rejects(app.tools.sendPrompt('edited message', { key: '13:input-messagemsg-1' }), /offline/);
  assert.equal(app.calls.find((call) => call[0] === 'fork')[1].atSeq, 3);
  assert.equal(app.calls.some((call) => call[0] === 'prompt'), false);
  assert.ok(app.calls.some((call) => call[0] === 'abandon'));
  app.dispose();
});

test('editing the first message fails instead of leaving that message on screen', async () => {
  const app = setup({ events: [{ type: 'user/message', seq: 0, data: { id: 'msg-1' } }] });
  await assert.rejects(app.tools.sendPrompt('edited message', { key: '13:input-messagemsg-1' }), /edit-source-unavailable/);
  assert.equal(app.calls.some((call) => call[0] === 'fork' || call[0] === 'prompt' || call[0] === 'prompt-child'), false);
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

test('side chat streams through the plugin remote without creating a Session', async () => {
  const app = setup();
  let state;
  const calls = [];
  const remote = { create: async (request) => { calls.push(request); return { chatId: 'discussion', modelSelection: { model: 'inherited' } }; },
    stream: async function* (request) { yield { type: 'started', requestId: request.requestId }; yield { type: 'content', text: 'answer', reasoning: 'reason' }; yield { type: 'finished', status: 'complete' }; },
    close: async () => { calls.push('closed'); } };
  const controller = app.plugin.sideChatActions.createController(async () => remote, (value) => { state = value; });
  await controller.send({ parentSessionId: 'main', atSeq: 4, selectedText: 'selected' }, 'explain');
  assert.equal(state.messages.length, 2);
  assert.equal(state.messages[1].text, 'answer');
  assert.equal(state.messages[1].status, 'complete');
  assert.equal(calls[0].atSeq, 4);
  assert.equal(app.calls.some((call) => ['create', 'prompt', 'fork', 'archiveSession', 'openSession'].includes(call[0])), false);
  await controller.close();
  assert.equal(calls.at(-1), 'closed');
  app.dispose();
});

test('side-chat wire endpoints match the host and source anchors reject streaming or foreign messages', () => {
  const node = { anchorSeq: 4, visibility: 'visible', location: { kind: 'step', turn: { status: 'closed' }, step: { status: 'closed' } } };
  const app = setup({ chat: { nodes: new Map([['message-key', node]]) } });
  const client = app.plugin.sideChatActions.contribution();
  const signature = (descriptor) => JSON.stringify({ id: descriptor.id, namespace: descriptor.namespace,
    service: descriptor.service, method: descriptor.method, mode: descriptor.mode,
    cancellation: descriptor.cancellation, input: descriptor.parameters[0].codec.typeSymbol,
    output: descriptor.result.typeSymbol });
  assert.equal(JSON.stringify(client.descriptors.map(signature)), JSON.stringify(SIDE_CHAT_INVOCATIONS.map(signature)));
  const source = app.slots.get('dsh-chat-actions/ask').inject('main');
  const context = source.contextFor('main', { sessionId: 'main', key: 'message-key' }, 'selected');
  assert.equal(context.atSeq, 4);
  assert.equal(context.parentSessionId, 'main');
  assert.throws(() => source.contextFor('main', { sessionId: 'other', key: 'message-key' }, 'selected'));
  node.location.turn.status = 'running';
  assert.throws(() => source.contextFor('main', { sessionId: 'main', key: 'message-key' }, 'selected'));
  app.dispose();
});

test('closing a side chat during creation closes a late result without sending', async () => {
  const app = setup();
  let resolve;
  let streamed = false;
  const closed = [];
  const controller = app.plugin.sideChatActions.createController(async () => ({
    create: () => new Promise((done) => { resolve = done; }),
    stream: () => { streamed = true; }, close: async (request) => closed.push(request.chatId)
  }), () => {});
  const sending = controller.send({ parentSessionId: 'main', atSeq: 4 }, 'explain');
  await new Promise(setImmediate);
  const closing = controller.close();
  resolve({ chatId: 'late' });
  await Promise.all([sending, closing]);
  assert.equal(streamed, false);
  assert.deepEqual(closed, ['late']);
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

function askPanelProps(app, overrides = {}) {
  return {
    ...app.slots.get('dsh-chat-actions/ask').inject('main'),
    sessionId: 'main', t: (key) => key,
    contextFor: (parentSessionId, origin, selectedText) => ({ parentSessionId, atSeq: 4, selectedText }),
    useTabInfo: () => ({ tab: { navigation: { params: { text: 'selected\n    code', sessionId: 'main' } } } }),
    ...overrides
  };
}

test('the ask panel displays replies and adds the discussion to the parent without sending', async () => {
  const app = setup();
  const quotes = [];
  const props = askPanelProps(app, {
    sideChatRemote: async () => ({
      create: async () => ({ chatId: 'discussion', modelSelection: { model: 'inherited' } }),
      stream: async function* (request) {
        yield { type: 'started', requestId: request.requestId };
        yield { type: 'content', text: 'answer', reasoning: '' };
        yield { type: 'finished', status: 'complete' };
      },
      close: async () => {}
    }),
    insertDiscussion: (...args) => { quotes.push(args); return true; }
  });
  let view = app.renderAsk(props);
  find(view, (node) => node.type === 'textarea').props.onChange({ target: { value: 'explain' } });
  view = app.renderAsk(props);
  await find(view, (node) => node.type === 'button' && node.children[0] === 'ask.send').props.onClick();
  view = app.renderAsk(props);
  assert.equal(find(view, (node) => node.type === 'textarea').props.value, '');
  assert.equal(find(view, (node) => node.type === 'markdown').props.text, 'answer');
  find(view, (node) => node.type === 'button' && node.children[0] === 'tools.addToComposer').props.onClick();
  assert.equal(quotes[0][0], 'main');
  assert.ok(quotes[0][1].includes('selected\n    code'));
  assert.ok(quotes[0][1].includes('answer'));
  assert.equal(app.calls.some((call) => ['prompt', 'create', 'fork', 'openSession'].includes(call[0])), false);
  app.unmountAsk();
  app.dispose();
});

test('transport retry before admission reuses its identity and keeps a single user message', async () => {
  const app = setup();
  const requests = [];
  let state;
  const controller = app.plugin.sideChatActions.createController(async () => ({
    create: async () => ({ chatId: 'discussion' }),
    stream: async function* (request) {
      requests.push(request.requestId);
      if (requests.length === 1) throw new Error('offline');
      yield { type: 'started', requestId: request.requestId };
      yield { type: 'content', text: 'reply', reasoning: '' };
      // A missing terminal status must remain visible as an error.
    }, close: async () => {}
  }), (value) => { state = value; });
  await controller.send({ atSeq: 4 }, 'question');
  assert.equal(state.messages.length, 0);
  await controller.send({ atSeq: 4 }, 'question');
  assert.equal(requests[0], requests[1]);
  assert.equal(state.messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(state.messages[1].text, 'reply');
  assert.equal(state.messages[1].status, 'error');
  assert.ok(state.error.includes('connection ended'));
  await controller.close();
  // Closing an uncreated discussion must not permanently block later sends.
  await controller.close();
  await controller.send({ atSeq: 4 }, 'another');
  assert.equal(requests.length, 3);
  await controller.close();
  app.dispose();
});

test('stop aborts the stream and preserves the partial reply', async () => {
  const app = setup();
  let started;
  const active = new Promise((resolve) => { started = resolve; });
  let state;
  let cancelled = false;
  const controller = app.plugin.sideChatActions.createController(async () => ({
    create: async () => ({ chatId: 'discussion' }),
    stream: async function* (request, signal) {
      yield { type: 'started', requestId: request.requestId };
      yield { type: 'content', text: 'partial', reasoning: '' };
      started();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    },
    cancel: async () => { cancelled = true; }, close: async () => {}
  }), (value) => { state = value; });
  const sending = controller.send({ atSeq: 4 }, 'question');
  await active;
  await controller.stop();
  await sending;
  assert.equal(cancelled, true);
  assert.equal(state.messages[1].text, 'partial');
  assert.equal(state.messages[1].status, 'stopped');
  assert.equal(state.error, '');
  await controller.close();
  app.dispose();
});
