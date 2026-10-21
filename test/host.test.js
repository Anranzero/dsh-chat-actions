import assert from 'node:assert/strict';
import test from 'node:test';

test('the installed host entry imports its side-chat runtime without loader stubs', async () => {
  const plugin = await import('../index.js');
  const registered = [];
  plugin.apply({ plugin: value => registered.push(value), inject() {} });
  assert.equal(registered.length, 1);
  assert.equal(typeof registered[0].prototype.create, 'function');
  assert.equal(typeof registered[0].prototype.stream, 'function');
});

test('the host plugin activates and releases its side-chat service in real Cordis', async () => {
  const { Context } = await import('@deepseek-ai/cordis');
  const plugin = await import('../index.js');
  const ctx = new Context();
  for (const name of ['llm', 'sessions', 'sessionQuery']) ctx.provide(name, {});
  const fiber = ctx.plugin(plugin);
  let discussions;
  try {
    await fiber;
    const service = ctx.get('chatActionsSideChat');
    assert.ok(service);
    assert.equal(typeof service.stream, 'function');
    assert.equal(service.owner(), 'local');
    discussions = service.discussions;
  } finally {
    await fiber.dispose();
  }
  assert.equal(ctx.get('chatActionsSideChat'), undefined);
  assert.equal(discussions.disposed, true);
});
