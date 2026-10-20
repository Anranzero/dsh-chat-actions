import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const quoteSource = 'chat-actions-quote';

// Exercise the actual plugin's registration and insertion paths, not its views.
// No DOM, React rendering, network requests or real timers are needed.
function setup(initialTriggers, { hostConversationFirst = false } = {}) {
  let definition;
  const inserted = [];
  const cleanups = [];
  const dependencies = [];
  const slots = new Map();
  const declaredSlots = new Set();
  const declareSlots = (children) => {
    for (const name of Object.keys(children || {})) {
      assert.equal(declaredSlots.has(name), false, `slot "${name}" is already declared`);
      declaredSlots.add(name);
    }
  };
  const registerHostConversation = () => declareSlots({
    'conversation.session': { kind: 'single', scope: 'session' }
  });
  if (hostConversationFirst) registerHostConversation();
  const services = { inputTriggers: initialTriggers };
  const input = {
    state: { getSnapshot: () => ({ phase: 'plain', draft: '', draftRev: 1, occurrences: [] }) },
    insertReference: (reference) => { inserted.push(reference); return true; },
    focus() {}
  };
  const conversation = { input: { for: () => input } };
  const sessionScope = { get: (name) => name === 'conversation' ? conversation : undefined };
  services.sessions = {
    binding: () => ({ ctx: sessionScope }),
    scope: () => sessionScope
  };
  const effect = (run) => {
    const dispose = run();
    if (typeof dispose === 'function') cleanups.push(dispose);
    return dispose;
  };
  const ctx = {
    get: (name) => services[name],
    effect,
    locale: { register: () => () => {}, bind: () => (key) => key },
    slots: {
      inject: (_name, run) => run(),
      register: (options) => {
        declareSlots(options.children);
        slots.set(options.id || options.key, options);
        return () => {};
      }
    },
    inject: (names, run) => { dependencies.push({ names, run }); }
  };
  const window = {
    __ModuleLoader__: { load: (module) => { definition = module; } },
    setInterval: () => 1,
    clearInterval() {}
  };
  vm.runInNewContext(source, { window, console: { info() {}, warn() {} } });
  const plugin = definition.factory((name) => {
    assert.equal(name, 'react');
    return { createElement() { throw new Error('Rendering is outside this test'); } };
  });
  plugin.apply(ctx);
  const activate = (triggers) => {
    services.inputTriggers = triggers;
    const disposers = [];
    for (const dependency of dependencies) {
      if (!dependency.names.includes('inputTriggers')) continue;
      const scope = { ...ctx, inputTriggers: triggers, effect: (run) => {
        const dispose = run();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      } };
      dependency.run(scope);
    }
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const dispose of disposers.reverse()) dispose();
    };
    cleanups.push(stop);
    return stop;
  };
  if (initialTriggers) activate(initialTriggers);
  return {
    registerHostConversation,
    insert: (text) => slots.get('chat-actions-tools').inject('session-a').insertQuote(text),
    inserted,
    activate,
    dispose: () => { for (const dispose of cleanups.reverse()) dispose(); }
  };
}

test('sidebar ask registration coexists with host conversation slots in either startup order', () => {
  for (const hostConversationFirst of [false, true]) {
    const client = setup(undefined, { hostConversationFirst });
    if (!hostConversationFirst) client.registerHostConversation();
    client.dispose();
  }
});

function registry({ fail = false } = {}) {
  const sources = new Map();
  return {
    sources,
    registerSource(source) {
      if (fail) throw new Error('registration failed');
      assert.equal(sources.has(source.name), false, 'A codec must not be registered twice');
      sources.set(source.name, source);
      return () => sources.delete(source.name);
    }
  };
}

test('does not insert an orphan quote when the trigger service is not ready', () => {
  const client = setup();
  assert.equal(client.insert('完整引用'), false);
  assert.equal(client.inserted.length, 0);
  client.dispose();
});

test('registers a late trigger service and serializes the entire quote', async () => {
  const client = setup();
  const triggers = registry();
  const stop = client.activate(triggers);
  const text = '完整引用，不能只发送摘要。'.repeat(30) + '\n第二行';
  assert.equal(client.insert(text), true);
  const reference = client.inserted[0];
  assert.equal(reference.source, quoteSource);
  const codec = triggers.sources.get(quoteSource)?.codec;
  assert.ok(codec, 'Late service activation must register the codec');
  const serialized = await codec.serialize(reference.ref);
  assert.equal(serialized, '> [引用 · 对话片段]\n> ' + text.replaceAll('\n', '\n> ') + '\n\n');
  stop();
  client.dispose();
});

test('rejects new quote chips after the trigger registration is disposed', () => {
  const client = setup();
  const triggers = registry();
  const stop = client.activate(triggers);
  assert.equal(client.insert('已就绪'), true);
  stop();
  assert.equal(triggers.sources.size, 0);
  assert.equal(client.insert('不可产生无归属引用'), false);
  assert.equal(client.inserted.length, 1);
  client.dispose();
});

test('service replacement restores serialization for existing quote refs', async () => {
  const client = setup();
  const first = registry();
  const stopFirst = client.activate(first);
  assert.equal(client.insert('重载前的引用'), true);
  const reference = client.inserted[0];
  stopFirst();
  const second = registry();
  const stopSecond = client.activate(second);
  const codec = second.sources.get(quoteSource)?.codec;
  assert.ok(codec, 'Replacement service must register the same source');
  assert.match(await codec.serialize(reference.ref), /重载前的引用/);
  assert.equal(client.insert('重载后的引用'), true);
  stopSecond();
  client.dispose();
});

test('failed codec registration never permits an unserializable chip', () => {
  const client = setup(registry({ fail: true }));
  assert.equal(client.insert('不能丢失的内容'), false);
  assert.equal(client.inserted.length, 0);
  client.dispose();
});

test('an already available service registers a codec once', async () => {
  const triggers = registry();
  const client = setup(triggers);
  assert.equal(triggers.sources.size, 1);
  assert.equal(await triggers.sources.get(quoteSource).codec.serialize('invalid JSON'), '');
  client.dispose();
});

test('plugin disposal unregisters its codec and prevents further insertion', () => {
  const triggers = registry();
  const client = setup(triggers);
  assert.equal(client.insert('插件存活时'), true);
  client.dispose();
  assert.equal(triggers.sources.size, 0);
  assert.equal(client.insert('插件已卸载'), false);
});

test('a service without the registration API cannot create quote chips', () => {
  const client = setup({});
  assert.equal(client.insert('不可序列化'), false);
  assert.equal(client.inserted.length, 0);
  client.dispose();
});

test('queue layout follows the composer width and side-clearance contract', () => {
  const style = source.match(/'data-chat-actions-queue': '',\s*style: \{([^}]+)\}/)?.[1];
  assert.ok(style);
  assert.match(style, /maxWidth:\s*'var\(--dsh-composer-card-max-width, 100%\)'/);
  assert.match(style, /width:\s*'calc\(100% - var\(--dsh-composer-side-clearance, 0px\) - var\(--dsh-composer-side-clearance, 0px\)\)'/);
  assert.match(style, /marginInline:\s*'auto'/);
  assert.match(style, /boxSizing:\s*'border-box'/);
  assert.match(style, /minWidth:\s*0/);
});
