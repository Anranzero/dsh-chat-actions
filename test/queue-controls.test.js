import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const textRow = (id, text = id) => ({ id, content: [{ type: 'text', text }] });
const defaultRows = () => [textRow('first', '第一行\n    保留缩进\n第三行'), textRow('second', '第二条消息')];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Render the actual registered queue view through the plugin's hook slots.
// Projection changes are explicit, so an RPC acknowledgement cannot masquerade
// as admission; no DOM, model requests, timers or composer writes are used.
function setup({ rows = defaultRows(), running = true, update = async () => {}, wake = async () => {},
  subagent = null, pending = [], sentinelIds = new Set(), loadImage = async () => 'blob:image' } = {}) {
  let definition;
  const slots = new Map();
  const hooks = [];
  const cleanups = [];
  const notices = [];
  const calls = [];
  const copies = [];
  let cursor = 0;
  let effects = [];
  let dirty = false;
  let inbox = { 'next-turn': rows };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) }),
    useState(initial) {
      const i = cursor++;
      if (!hooks[i]) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[i].value, value => {
        const next = typeof value === 'function' ? value(hooks[i].value) : value;
        if (!Object.is(next, hooks[i].value)) { hooks[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!hooks[i] || !same(hooks[i].deps, deps)) hooks[i] = { deps, value: factory() };
      return hooks[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (hooks[i] && same(hooks[i].deps, deps)) return;
      effects.push(() => {
        hooks[i]?.off?.();
        hooks[i] = { deps, off: fn() };
      });
    }
  };
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: entry => { definition = entry; } }, setInterval: () => 1, clearInterval() {},
      navigator: { clipboard: { writeText: async value => { copies.push(value); } } }
    },
    console: { info() {}, warn() {} }
  });
  const ctx = {
    get() {}, effect: fn => { const off = fn(); if (typeof off === 'function') cleanups.push(off); }, inject() {},
    locale: { register() {}, bind: () => key => key },
    slots: { inject: (_name, fn) => fn(), register: (options, view) => slots.set(options.id || options.key, view) }
  };
  definition.factory(id => id === 'react' ? react : {}).apply(ctx);
  const props = {
    useSession: selector => selector({ pendingSubmissions: pending, running, subagent }),
    useProjection: () => inbox,
    updateQueue: async (...args) => { calls.push(['update', ...args]); return update(...args); },
    wakeQueue: async id => { calls.push(['wake', id]); return wake(id); },
    sentinelIds,
    loadImage,
    notify: (...args) => notices.push(args),
    t: key => key
  };
  const render = () => {
    let tree;
    for (let pass = 0; pass < 10; pass++) {
      dirty = false; cursor = 0; effects = [];
      tree = slots.get('queue')(props);
      effects.forEach(effect => effect());
      if (!dirty) return tree;
    }
    throw new Error('Queue render did not settle');
  };
  return {
    calls, notices, copies, render,
    project(next) { rows = next; inbox = { 'next-turn': rows }; },
    setRunning(value) { running = value; },
    setSubagent(value) { subagent = value; },
    dispose() { hooks.forEach(hook => hook?.off?.()); cleanups.reverse().forEach(off => off()); }
  };
}

function findAll(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => findAll(child, predicate))];
}
const attr = (node, name) => node?.props && Object.hasOwn(node.props, 'data-chat-actions-queue-' + name);
const panel = tree => findAll(tree, node => node?.props && Object.hasOwn(node.props, 'data-chat-actions-queue'))[0];
const control = (tree, name) => findAll(tree, node => attr(node, name))[0];
const rowsOf = tree => findAll(tree, node => attr(node, 'row'));
const row = (tree, id) => rowsOf(tree).find(node => node.props['data-queue-id'] === String(id));
const rowControl = (tree, id, name) => control(row(tree, id), name);
const textarea = tree => findAll(tree, node => node.type === 'textarea')[0];
const contents = node => typeof node === 'object' && node !== null ? (node.children || []).map(contents).join('') : String(node ?? '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const keyEvent = (key, extra = {}) => {
  const event = {
    key, isComposing: false, nativeEvent: {}, keyCode: 0,
    preventions: 0, stops: 0,
    preventDefault() { this.preventions += 1; },
    stopPropagation() { this.stops += 1; },
    ...extra
  };
  return event;
};
// The panel handler only acts when the strip itself owns focus, matching the
// browser where a focused child button/textarea keeps its native keys.
const press = (tree, key, extra = {}) => {
  const container = panel(tree);
  const event = keyEvent(key, { target: container, currentTarget: container, ...extra });
  container.props.onKeyDown(event);
  return event;
};
const focusEvent = container => ({ target: container, currentTarget: container, relatedTarget: null });
const focusPanel = tree => { const container = panel(tree); container.props.onFocus(focusEvent(container)); };
const blurPanel = tree => { const container = panel(tree); container.props.onBlur(focusEvent(container)); };

test('rows expose edit, remove and send controls, expanded by default', () => {
  const app = setup();
  const tree = app.render();
  assert.equal(rowsOf(tree).length, 2);
  assert.ok(rowControl(tree, 'first', 'edit'));
  assert.ok(rowControl(tree, 'first', 'remove'));
  assert.ok(rowControl(tree, 'first', 'send'));
  assert.ok(rowControl(tree, 'second', 'send'));
  assert.ok(control(tree, 'more') === undefined);
  assert.ok(control(tree, 'toggle'));
  app.dispose();
});

test('row action buttons share one icon-button shape and never add a text label', () => {
  const app = setup();
  const tree = app.render();
  for (const name of ['edit', 'remove', 'send']) {
    const button = rowControl(tree, 'first', name);
    assert.match(button.props.className, /^chat-actions-queue-control( chat-actions-queue-remove)?$/);
    assert.equal(button.props.className.includes('chat-actions-queue-send'), false, name + ' must not use the text-button style');
    assert.equal(button.props.style, undefined);
    assert.equal(button.children.length, 1);
    assert.equal(button.children[0].type, 'svg');
  }
  // The action still has an accessible name even though the visual is icon-only.
  const paused = setup({ running: false }).render();
  assert.match(rowControl(paused, 'first', 'send').props['aria-label'], /queue\.sendHint/);
  app.dispose();
});

test('send while running steers exactly the clicked row and never cancels the turn', async () => {
  const app = setup();
  const tree = app.render();
  await rowControl(tree, 'second', 'send').props.onClick();
  assert.deepEqual(app.calls, [['wake', 'second']]);
  app.dispose();
});

test('paused send only enables the FIFO head and a stale second-row handler cannot bypass it', async () => {
  const app = setup({ running: false });
  let tree = app.render();
  const stale = rowControl(tree, 'second', 'send');
  assert.equal(rowControl(tree, 'first', 'send').props.disabled, false);
  assert.equal(rowControl(tree, 'second', 'send').props.disabled, true);
  await stale.props.onClick();
  await rowControl(app.render(), 'second', 'send').props.onClick();
  assert.equal(app.calls.length, 0);
  app.project([textRow('second')]);
  tree = app.render();
  assert.equal(rowControl(tree, 'second', 'send').props.disabled, false);
  await rowControl(tree, 'second', 'send').props.onClick();
  assert.deepEqual(app.calls, [['wake', 'second']]);
  app.dispose();
});

test('inline editing saves with Ctrl/Meta+Enter, keeps Enter as a newline and cancels with Escape', async () => {
  const app = setup();
  rowControl(app.render(), 'second', 'edit').props.onClick();
  let tree = app.render();
  const input = textarea(tree);
  assert.ok(input);
  const enter = keyEvent('Enter', { target: input, currentTarget: input });
  input.props.onKeyDown(enter);
  assert.equal(enter.preventions, 0);
  assert.equal(app.calls.length, 0);
  input.props.onChange({ target: { value: 'edited\n    code' } });
  tree = app.render();
  const save = control(tree, 'save');
  await save.props.onClick();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], 'update');
  assert.equal(app.calls[0][1], 'second');
  assert.equal(app.calls[0][2].kind, 'edit');
  assert.equal(app.calls[0][2].content[0].text, 'edited\n    code');
  assert.equal(textarea(app.render()), undefined);
  // Escape closes without an RPC.
  rowControl(app.render(), 'first', 'edit').props.onClick();
  const editing = textarea(app.render());
  const escape = keyEvent('Escape', { target: editing, currentTarget: editing });
  editing.props.onKeyDown(escape);
  assert.equal(escape.preventions, 1);
  assert.equal(textarea(app.render()), undefined);
  assert.equal(app.calls.length, 1);
  app.dispose();
});

test('removing a row issues one RPC and keeps that row locked until the projection confirms it', async () => {
  const flight = deferred();
  const app = setup({ update: () => flight.promise });
  let tree = app.render();
  const removing = rowControl(tree, 'second', 'remove').props.onClick();
  await rowControl(tree, 'first', 'remove').props.onClick();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], 'update');
  assert.equal(app.calls[0][1], 'second');
  assert.equal(app.calls[0][2].kind, 'remove');
  tree = app.render();
  assert.equal(rowControl(tree, 'second', 'remove').props.disabled, true);
  assert.equal(rowControl(tree, 'first', 'remove').props.disabled, true);
  assert.ok(control(row(tree, 'second'), 'status'));
  flight.resolve(); await removing;
  tree = app.render();
  assert.equal(rowControl(tree, 'first', 'remove').props.disabled, false);
  app.project([textRow('first')]); app.render();
  app.project(defaultRows());
  assert.equal(rowControl(app.render(), 'second', 'remove').props.disabled, false);
  assert.equal(app.notices.length, 0);
  app.dispose();
});

test('keyboard: arrows move the active row and the strip advertises the shortcuts', () => {
  const app = setup();
  let tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], undefined);
  const container = panel(tree);
  container.props.onFocus(focusEvent(container));
  tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], 'true');
  assert.equal(contents(tree).includes('queue.shortcuts'), true);
  press(tree, 'ArrowDown');
  tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], undefined);
  assert.equal(row(tree, 'second').props['data-queue-active'], 'true');
  press(tree, 'ArrowUp');
  tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], 'true');
  press(tree, 'End');
  tree = app.render();
  assert.equal(row(tree, 'second').props['data-queue-active'], 'true');
  press(tree, 'Home');
  assert.equal(row(app.render(), 'first').props['data-queue-active'], 'true');
  // Leaving the strip restores the normal status line.
  container.props.onBlur(focusEvent(container));
  tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], undefined);
  assert.equal(contents(tree).includes('queue.count'), true);
  app.dispose();
});

test('keyboard: Enter sends, E edits and Delete removes the active row', async () => {
  const app = setup();
  let tree = app.render();
  focusPanel(tree);
  press(tree, 'ArrowDown');
  tree = app.render();
  // E opens the inline editor for the active row.
  press(tree, 'e');
  tree = app.render();
  assert.equal(textarea(tree).props.value, '第二条消息');
  control(tree, 'dismiss').props.onClick();
  tree = app.render();
  assert.equal(textarea(tree), undefined);
  // Enter sends the active row.
  const enter = press(tree, 'Enter');
  assert.equal(enter.preventions, 1);
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], 'wake');
  assert.equal(app.calls[0][1], 'second');
  // Delete removes the active row (the send acknowledgement locks only its
  // own row, so the untouched head is still actionable).
  tree = app.render();
  press(tree, 'Home');
  tree = app.render();
  press(tree, 'Delete');
  await flush();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1][0], 'update');
  assert.equal(app.calls[1][1], 'first');
  assert.equal(app.calls[1][2].kind, 'remove');
  app.dispose();
});

test('keyboard ignores events that belong to a child control, an editor or an IME composition', async () => {
  const app = setup();
  const tree = app.render();
  const container = panel(tree);
  const child = rowControl(tree, 'first', 'remove');
  const toChild = keyEvent('Delete', { target: child, currentTarget: container });
  container.props.onKeyDown(toChild);
  await flush();
  assert.equal(app.calls.length, 0);
  const ime = press(app.render(), 'Enter', { isComposing: true });
  assert.equal(ime.preventions, 0);
  await flush();
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('focusing a child control never advertises or enables the strip shortcuts', () => {
  const app = setup();
  const tree = app.render();
  const container = panel(tree);
  const child = rowControl(tree, 'first', 'remove');
  container.props.onFocus({ target: child, currentTarget: container });
  const next = app.render();
  assert.equal(row(next, 'first').props['data-queue-active'], undefined);
  assert.equal(contents(next).includes('queue.shortcuts'), false);
  const event = keyEvent('Delete', { target: child, currentTarget: container });
  container.props.onKeyDown(event);
  assert.equal(event.preventions, 0);
  assert.equal(app.calls.length, 0);
  app.dispose();
});

test('modifier chords and repeated keydowns never trigger queue actions', async () => {
  const app = setup();
  let tree = app.render();
  focusPanel(tree);
  press(tree, 'e', { ctrlKey: true });
  tree = app.render();
  assert.equal(textarea(tree), undefined);
  press(tree, 'Delete', { metaKey: true });
  press(tree, 'Enter', { altKey: true });
  await flush();
  assert.equal(app.calls.length, 0);
  press(tree, 'Enter', { repeat: true });
  await flush();
  assert.equal(app.calls.length, 0);
  press(tree, 'Enter');
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][0], 'wake');
  app.dispose();
});

test('a collapsed strip expands before a keyboard action reaches a hidden row', async () => {
  const app = setup({ running: true });
  const tree = app.render();
  control(tree, 'toggle').props.onClick();
  let next = app.render();
  assert.equal(rowsOf(next).length, 1);
  focusPanel(next);
  press(next, 'End');
  next = app.render();
  assert.equal(rowsOf(next).length, 2);
  await press(next, 'Enter');
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][1], 'second');
  app.dispose();
});

test('action buttons expose the shortcut they implement', () => {
  const app = setup();
  const tree = app.render();
  assert.equal(rowControl(tree, 'first', 'edit').props['aria-keyshortcuts'], 'E');
  assert.equal(rowControl(tree, 'first', 'remove').props['aria-keyshortcuts'], 'Delete');
  assert.equal(rowControl(tree, 'first', 'send').props['aria-keyshortcuts'], 'Enter');
  const paused = setup({ running: false }).render();
  assert.equal(rowControl(paused, 'second', 'send').props['aria-keyshortcuts'], undefined);
  app.dispose();
});

test('keyboard navigation clamps at both ends and paused Enter ignores non-head rows', async () => {
  const app = setup({ running: false });
  let tree = app.render();
  focusPanel(tree);
  press(tree, 'ArrowUp');
  tree = app.render();
  assert.equal(row(tree, 'first').props['data-queue-active'], 'true');
  press(tree, 'End');
  tree = app.render();
  assert.equal(row(tree, 'second').props['data-queue-active'], 'true');
  press(tree, 'ArrowDown');
  tree = app.render();
  assert.equal(row(tree, 'second').props['data-queue-active'], 'true');
  press(tree, 'Enter');
  await flush();
  assert.equal(app.calls.length, 0, 'paused send stays limited to the FIFO head');
  press(tree, 'Home');
  tree = app.render();
  press(tree, 'Enter');
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0][1], 'first');
  app.dispose();
});

test('failed removal stays on its row and retry reuses the same native message ID', async () => {
  let attempts = 0;
  const app = setup({ update: async () => { if (++attempts === 1) throw new Error('offline'); } });
  await rowControl(app.render(), 'second', 'remove').props.onClick();
  let tree = app.render();
  assert.equal(app.notices[0][0], 'error');
  assert.equal(app.notices[0][1], 'queue.removeFailed');
  assert.ok(control(row(tree, 'second'), 'error'));
  assert.equal(control(row(tree, 'first'), 'error'), undefined);
  await control(row(tree, 'second'), 'retry').props.onClick();
  assert.deepEqual(app.calls.map(call => call[1]), ['second', 'second']);
  app.dispose();
});

test('queue text preview keeps line breaks and toggles between clamp and full view', () => {
  const app = setup();
  const preview = rowControl(app.render(), 'first', 'preview');
  assert.equal(contents(preview), '第一行\n    保留缩进\n第三行');
  assert.equal(preview.props['aria-expanded'], false);
  preview.props.onClick();
  const expanded = rowControl(app.render(), 'first', 'preview');
  assert.equal(expanded.props['aria-expanded'], true);
  assert.equal(expanded.children[0].props.className, 'chat-actions-queue-full');
  app.dispose();
});

test('sentinel and transcript rows stay hidden while queued echoes are non-actionable', () => {
  const app = setup({
    rows: [
      { ...textRow('sentinel'), source: { kind: 'user', rpcId: 'wake' } },
      { ...textRow('echo'), source: { kind: 'user', rpcId: 'visible-transcript' } },
      { ...textRow('admitted'), source: { kind: 'user', rpcId: 'already-admitted' } }
    ],
    sentinelIds: new Set(['wake']),
    pending: [
      { placement: 'transcript', requestId: 'visible-transcript' },
      { placement: 'queued', requestId: 'already-admitted', text: 'same row' },
      { placement: 'queued', requestId: 'not-admitted', text: 'waiting for host' }
    ]
  });
  const tree = app.render();
  assert.deepEqual(rowsOf(tree).map(node => node.props['data-queue-id']), ['admitted']);
  const pendingRow = control(tree, 'pending');
  assert.ok(contents(pendingRow).includes('waiting for host'));
  assert.equal(control(pendingRow, 'send'), undefined);
  app.dispose();
});

test('read-only subagents keep the list but cannot send, edit or remove', async () => {
  const app = setup({ subagent: { address: { mode: 'readonly' } } });
  let tree = app.render();
  for (const name of ['send', 'edit', 'remove']) {
    assert.equal(rowControl(tree, 'first', name).props.disabled, true);
    await rowControl(tree, 'first', name).props.onClick();
  }
  tree = app.render();
  focusPanel(tree);
  press(tree, 'Enter');
  await flush();
  assert.equal(app.calls.length, 0);
  assert.equal(textarea(app.render()), undefined);
  app.dispose();
});

test('attachment rows still send and remove but never open the text editor', async () => {
  const attachment = { attachmentId: 'document-id', name: '项目说明.pdf' };
  const attachmentRow = { id: 'file', content: [{ type: 'text', text: '请看文件' }, { type: 'file', attachment }] };
  const app = setup({ rows: [attachmentRow] });
  const tree = app.render();
  assert.ok(contents(tree).includes('项目说明.pdf'));
  assert.equal(rowControl(tree, 'file', 'edit').props.disabled, true);
  await rowControl(tree, 'file', 'edit').props.onClick();
  assert.equal(textarea(app.render()), undefined);
  await rowControl(app.render(), 'file', 'send').props.onClick();
  assert.deepEqual(app.calls, [['wake', 'file']]);
  assert.equal(attachmentRow.content[1].attachment, attachment);
  app.dispose();
});

test('queued image blocks use host-resolved thumbnails and collapse extras behind a count', () => {
  const images = [1, 2, 3, 4].map(index => ({ type: 'image', attachment: { attachmentId: 'shot-' + index, name: 'shot-' + index + '.png' } }));
  const imageRow = { id: 'image', content: [{ type: 'text', text: '' }, ...images] };
  const app = setup({ rows: [imageRow], loadImage: async () => 'blob:shot' });
  let tree = app.render();
  const thumbsOf = node => findAll(node, child => typeof child.type === 'function' && child.type.name === 'QueueThumb');
  assert.equal(thumbsOf(tree).length, 3);
  assert.equal(thumbsOf(tree)[0].props.attachment, images[0].attachment);
  assert.equal(typeof thumbsOf(tree)[0].props.loadImage, 'function');
  const more = findAll(tree, node => node.type === 'button' && contents(node) === '+1')[0];
  assert.ok(more, 'the fourth image collapses behind a +1 control');
  more.props.onClick();
  tree = app.render();
  assert.equal(thumbsOf(tree).length, 4);
  assert.equal(imageRow.content.length, 5);
  app.dispose();
});

test('an unsaved edit survives its row being claimed and stays copyable', async () => {
  const app = setup({ rows: [textRow('first', 'original')] });
  rowControl(app.render(), 'first', 'edit').props.onClick();
  textarea(app.render()).props.onChange({ target: { value: 'draft\n  keeps' } });
  app.project([]);
  let tree = app.render();
  assert.ok(findAll(tree, node => node?.props && Object.hasOwn(node.props, 'data-chat-actions-queue-orphan')).length);
  assert.equal(textarea(tree).props.value, 'draft\n  keeps');
  const copy = findAll(tree, node => node?.props && Object.hasOwn(node.props, 'data-chat-actions-queue-copy'))[0];
  await copy.props.onClick();
  assert.deepEqual(app.copies, ['draft\n  keeps']);
  const dismiss = findAll(tree, node => node?.props && Object.hasOwn(node.props, 'data-chat-actions-queue-dismiss'))[0];
  dismiss.props.onClick();
  assert.equal(app.render(), null);
  app.dispose();
});

test('a save against changed original text is rejected and keeps the draft', async () => {
  const app = setup({ rows: [textRow('first', 'original')] });
  rowControl(app.render(), 'first', 'edit').props.onClick();
  textarea(app.render()).props.onChange({ target: { value: 'my draft' } });
  app.project([textRow('first', 'edited elsewhere')]);
  let tree = app.render();
  await control(tree, 'save').props.onClick();
  assert.equal(app.calls.length, 0);
  tree = app.render();
  assert.equal(textarea(tree).props.value, 'my draft');
  assert.ok(contents(control(row(tree, 'first'), 'error')).includes('queue.editChanged'));
  app.dispose();
});

test('collapse hides later rows and the more button restores them', () => {
  const app = setup({ rows: [...defaultRows(), textRow('third')] });
  let tree = app.render();
  control(tree, 'toggle').props.onClick();
  tree = app.render();
  assert.equal(rowsOf(tree).length, 1);
  assert.ok(contents(control(tree, 'more')).includes('queue.more'));
  control(tree, 'more').props.onClick();
  tree = app.render();
  assert.equal(rowsOf(tree).length, 3);
  app.dispose();
});

test('an unchanged edit closes without issuing a text replacement', () => {
  const app = setup({ rows: [textRow('first', 'original')] });
  rowControl(app.render(), 'first', 'edit').props.onClick();
  let tree = app.render();
  const input = textarea(tree);
  const enter = keyEvent('Enter', { ctrlKey: true, target: input, currentTarget: input });
  input.props.onKeyDown(enter);
  assert.equal(enter.preventions, 1);
  assert.equal(app.calls.length, 0);
  assert.equal(textarea(app.render()), undefined);
  app.dispose();
});
