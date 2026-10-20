import assert from 'node:assert/strict';
import test from 'node:test';
import { ReadOnlySideChatService, completedContextBoundary } from '../side-chat/service.js';

function setup(stream) {
  const calls = [];
  const events = [
    { seq: 0, type: 'user/message', message: { role: 'user', content: [{ type: 'text', text: 'original' }] } },
    { seq: 1, type: 'assistant/message', message: { role: 'assistant', content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'selected reply' }] } },
    { seq: 2, type: 'turn/end' },
    { seq: 3, type: 'user/message', message: { role: 'user', content: [{ type: 'text', text: 'later question' }] } },
    { seq: 4, type: 'turn/end' }
  ];
  class BlockAssembler {
    blocks = [];
    push(chunk) { if (chunk.type === 'text') this.blocks.push(chunk); else this.finish = chunk.finish; }
    interruptedBlocks() { return this.blocks; }
  }
  const runtime = { BlockAssembler, createAssistantMessage: (value) => ({ role: 'assistant', ...value }),
    ReasoningEffortId: (value) => value, dshSessionId: (value) => value,
    foldSurface: (prefix) => ({ nodes: prefix.filter((e) => e.message).map((e) => e.seq) }),
    deriveEventMessage: (event) => event.message,
    foldRequestHeader: () => ({ config: { provider: 'test', model: 'inherited' } }) };
  const ctx = { sessions: { messageProjections: {} },
    sessionQuery: { observeSession: async (id) => { calls.push(['observe', id]); return { events, [Symbol.dispose]() { calls.push(['release']); } }; } },
    llm: { prepareCall: async (config) => ({ config, stream: stream || (async function* (request) {
      calls.push(['model', request]);
      yield { type: 'text', text: 'answer' };
      yield { type: 'finish', finish: { kind: 'stop' } };
    }) }) } };
  const service = new ReadOnlySideChatService(ctx, runtime);
  return { service, calls, create: () => service.create({ parentSessionId: 'main', atSeq: 1, selectedText: 'selected reply' }, 'owner', new AbortController().signal) };
}

test('side chat freezes a completed turn and streams without writing a Session', async (t) => {
  const app = setup(); t.after(() => app.service.dispose());
  const created = await app.create();
  assert.equal(created.ok, true);
  assert.equal(created.value.boundarySeq, 2);
  assert.equal(created.value.modelSelection.model, 'inherited');
  const events = await Array.fromAsync(app.service.stream({ chatId: created.value.chatId, requestId: 'request', text: 'explain' }, 'owner', new AbortController().signal));
  assert.equal(events.at(-1).status, 'complete');
  assert.equal(events.find((e) => e.type === 'content').text, 'answer');
  const request = app.calls.find((c) => c[0] === 'model')[1];
  assert.deepEqual(request.tools, []);
  const payload = JSON.stringify(request.messages);
  assert.ok(payload.includes('selected reply'));
  assert.ok(!payload.includes('later question'));
  assert.ok(!payload.includes('private'));
  assert.ok(app.calls.some((c) => c[0] === 'release'));
  const replay = await Array.fromAsync(app.service.stream({ chatId: created.value.chatId, requestId: 'request', text: 'explain' }, 'owner', new AbortController().signal));
  assert.equal(replay.at(-1).status, 'complete');
  assert.equal(app.calls.filter((c) => c[0] === 'model').length, 1);
});

test('stop aborts the active provider, preserves partial text, and close isolates owners', async (t) => {
  let started;
  const active = new Promise((resolve) => { started = resolve; });
  const app = setup(async function* (request) {
    yield { type: 'text', text: 'partial' };
    started();
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    throw new Error('aborted');
  });
  t.after(() => app.service.dispose());
  const { value } = await app.create();
  const consuming = Array.fromAsync(app.service.stream({ chatId: value.chatId, requestId: 'request', text: 'explain' }, 'owner', new AbortController().signal));
  await active;
  assert.equal((await app.service.close({ chatId: value.chatId }, 'other')).ok, false);
  await app.service.cancel({ chatId: value.chatId }, 'owner');
  const result = await consuming;
  assert.equal(result.at(-1).status, 'stopped');
  assert.equal(result.at(-2).text, 'partial');
  await app.service.close({ chatId: value.chatId }, 'owner');
  assert.equal(app.service.chats.size, 0);
});

test('invalid and unfinished context boundaries are rejected', () => {
  assert.equal(completedContextBoundary([{ seq: 1, type: 'assistant/message' }], 1), undefined);
  assert.equal(completedContextBoundary([{ seq: 2, type: 'turn/end' }], 1), undefined);
});
