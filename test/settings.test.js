import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function setup(storage, directories) {
  let definition;
  const slots = new Map();
  const cleanups = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: run => { const off = run(); if (typeof off === 'function') cleanups.push(off); },
  };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const window = { localStorage, __ModuleLoader__: { load: value => { definition = value; } }, setInterval: () => 1, clearInterval() {} };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), { window, localStorage, console: { info() {}, warn() {} } });
  const plugin = definition.factory(name => name === 'react' ? react : { Switch: 'native-switch' });
  const ctx = {
    get() {}, inject(names, run) { if (directories && names.includes('modelDirectories')) run({ ...ctx, modelDirectories: directories }); }, effect: run => run(),
    locale: { register() {}, bind: () => key => key },
    slots: { inject: (_name, run) => run(), register: (entry, view) => { slots.set(entry.key ?? entry.id ?? entry.name, { entry, view }); } },
  };
  plugin.apply(ctx);
  return { slots, dispose: () => cleanups.reverse().forEach(off => off()),
    mount(view, props) {
      const start = cleanups.length;
      view(props);
      const owned = cleanups.splice(start);
      return () => owned.reverse().forEach(off => off());
    },
  };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flatMap(nodes)];

test('plugin detail card saves the reasoning-memory toggle independently of chat actions', () => {
  const storage = new Map();
  let app = setup(storage);
  let card = app.slots.get('dsh-chat-actions');
  assert.equal(card?.entry.name, 'plugins.bundle.config', 'settings live on this bundle detail page');
  const render = card => { const view = card.view({ view: 'page' }); return view.type(view.props); };
  let tree = render(card);
  assert.equal(tree.type, 'div');
  assert.equal(nodes(tree).some(node => node.type === 'details' || node.type === 'summary'), false);
  let toggle = nodes(tree).find(node => node.type === 'native-switch');
  assert.equal(toggle.props.checked, true);
  toggle.props.onChange();
  assert.ok(app.slots.has('chat-actions-tools'), 'existing chat actions remain registered');
  app.dispose();
  app = setup(storage);
  card = app.slots.get('dsh-chat-actions');
  tree = render(card);
  toggle = nodes(tree).find(node => node.type === 'native-switch');
  assert.equal(toggle.props.checked, false, 'disabled memory survives plugin reload');
  toggle.props.onChange(true);
  app.dispose();
  app = setup(storage);
  assert.equal(nodes(render(app.slots.get('dsh-chat-actions'))).find(node => node.type === 'native-switch').props.checked, true);
  app.dispose();
});

test('the composer attaches to the native directory and the settings switch really releases restoration', async () => {
  let current = { provider: 'one', model: 'A' };
  const groups = [{ id: 'one', models: ['A', 'B'].map(id => ({ id,
    reasoning: { defaultEffort: 'medium', efforts: [{ id: 'medium' }, { id: 'high' }] },
  })) }];
  const calls = [];
  const directory = {
    store: { getSnapshot: () => ({ groups, current, status: 'ready', pending: null }), subscribe: () => () => {} },
    async select(selection) { calls.push({ ...selection }); current = selection; return { ok: true }; },
  };
  const original = directory.select;
  const app = setup(new Map(), { directoryFor: id => { assert.equal(id, 'main'); return directory; } });
  const seat = app.slots.get('chat-actions-effort-memory');
  assert.equal(seat.entry.name, 'conversation.input.right');
  const props = seat.entry.inject('main');
  let unmount = app.mount(seat.view, props);
  await directory.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  await directory.select({ provider: 'one', model: 'B' });
  await directory.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  const card = app.slots.get('dsh-chat-actions');
  const config = card.view({ view: 'page' });
  const toggle = nodes(config.type(config.props)).find(node => node.type === 'native-switch');
  toggle.props.onChange(false);
  unmount();
  unmount = app.mount(seat.view, props);
  assert.equal(directory.select, original);
  await directory.select({ provider: 'one', model: 'B' });
  await directory.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, undefined);
  toggle.props.onChange(true);
  unmount();
  unmount = app.mount(seat.view, props);
  await directory.select({ provider: 'one', model: 'B' });
  await directory.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  unmount();
  app.dispose();
});
