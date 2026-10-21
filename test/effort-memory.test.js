import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function memory(storage = new Map()) {
  let definition;
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { definition = value; } } },
  });
  const plugin = definition.factory(() => ({}));
  assert.equal(typeof plugin.createEffortMemory, 'function', 'plugin supplies per-model reasoning memory');
  return plugin.createEffortMemory({
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
}
function directory() {
  const groups = ['one', 'two'].map(id => ({ id, models: ['A', 'B'].map(id => ({
    id, reasoning: { defaultEffort: 'medium', efforts: ['medium', 'high', 'low'].map(id => ({ id })) },
  })) }));
  let snapshot = { groups, current: { provider: 'one', model: 'A' }, status: 'ready', pending: null };
  const listeners = new Set();
  const calls = [];
  const api = {
    store: { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
    fail: false,
    async select(selection) {
      calls.push({ ...selection });
      if (api.fail) return { ok: false, error: { code: 'failed' } };
      snapshot = { ...snapshot, current: { ...selection }, status: 'ready', pending: null };
      listeners.forEach(fn => fn());
      return { ok: true };
    },
  };
  return { api, calls, groups, listeners,
    publish(value) { snapshot = { ...snapshot, ...value }; listeners.forEach(fn => fn()); },
  };
}

test('A High and B Low survive A → B → A and a fresh memory instance', async () => {
  const storage = new Map();
  const remembered = memory(storage);
  const { api, calls } = directory();
  const detach = remembered.attach(api);
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'B', reasoningEffort: 'low' });
  await api.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  await api.select({ provider: 'one', model: 'B' });
  assert.equal(calls.at(-1).reasoningEffort, 'low');
  detach();
  const restarted = memory(storage);
  const next = directory();
  const off = restarted.attach(next.api);
  await next.api.select({ provider: 'one', model: 'B' });
  assert.equal(next.calls.at(-1).reasoningEffort, 'low');
  off();
});

test('provider ids isolate memories; unsupported remembered levels fall back to DSH', async () => {
  const remembered = memory();
  const { api, calls, groups } = directory();
  const off = remembered.attach(api);
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  await api.select({ provider: 'two', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, undefined);
  groups[0].models[0].reasoning.efforts = [{ id: 'medium' }];
  await api.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, undefined);
  off();
});

test('failed changes do not replace saved levels; command menu defaults restore saved values', async () => {
  const remembered = memory();
  const { api, calls } = directory();
  const off = remembered.attach(api);
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  api.fail = true;
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'low' });
  api.fail = false;
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'medium' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  // An explicit non-default level from a caller is still respected.
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'low' });
  assert.equal(calls.at(-1).reasoningEffort, 'low');
  off();
});

test('disable restores the original selector and does not stack wrappers on shared composers', async () => {
  const remembered = memory();
  const { api, calls, listeners } = directory();
  const original = api.select;
  const offOne = remembered.attach(api);
  const wrapped = api.select;
  const offTwo = remembered.attach(api);
  assert.equal(api.select, wrapped);
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  offOne();
  assert.equal(api.select, wrapped);
  offTwo();
  assert.equal(api.select, original);
  assert.equal(listeners.size, 0);
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, undefined);
});

test('a late completion after disable cannot persist', async () => {
  const remembered = memory();
  const { api } = directory();
  let resolve;
  api.select = () => new Promise(done => { resolve = done; });
  const off = remembered.attach(api);
  const selecting = api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  off();
  resolve({ ok: true });
  await selecting;
  const next = directory();
  const stop = remembered.attach(next.api);
  await next.api.select({ provider: 'one', model: 'B' });
  await next.api.select({ provider: 'one', model: 'A' });
  assert.equal(next.calls.at(-1).reasoningEffort, undefined);
  stop();
});

test('the already selected level is captured when the initial catalog finishes loading', async () => {
  const remembered = memory();
  const { api, calls, groups, publish } = directory();
  publish({ groups: [], current: { provider: 'one', model: 'A', reasoningEffort: 'high' }, status: 'loading' });
  const off = remembered.attach(api);
  publish({ groups, status: 'ready' });
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  off();
});

test('blocked browser storage retains page-local memory without breaking model selection', async () => {
  const remembered = memory({ get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } });
  const { api, calls } = directory();
  const off = remembered.attach(api);
  await api.select({ provider: 'one', model: 'A', reasoningEffort: 'high' });
  await api.select({ provider: 'one', model: 'B' });
  await api.select({ provider: 'one', model: 'A' });
  assert.equal(calls.at(-1).reasoningEffort, 'high');
  off();
});
