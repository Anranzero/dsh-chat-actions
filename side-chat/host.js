// Host adapter for the MIT-licensed read-only service; see ./LICENSE.
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { BlockAssembler, createAssistantMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { deriveEventMessage, foldRequestHeader, foldSurface, SessionId as dshSessionId } from '@deepseek-ai/dsh-session';
import { ReadOnlySideChatService } from './service.js';

export default class ChatActionsSideChat extends TypertRemoteService {
  static inject = ['llm', 'sessions', 'sessionQuery'];
  owners = new Set();

  constructor(ctx) {
    super(ctx, 'chatActionsSideChat');
    this.discussions = new ReadOnlySideChatService(ctx, {
      BlockAssembler, createAssistantMessage, ReasoningEffortId,
      deriveEventMessage, foldRequestHeader, foldSurface, dshSessionId
    });
    ctx.effect(() => () => this.discussions.dispose(), 'chat-actions: read-only discussions');
  }

  owner() {
    const peer = this.ctx.invocation?.peer;
    if (peer === undefined) return 'local';
    const id = String(peer.id);
    if (!this.owners.has(id)) {
      this.owners.add(id);
      peer.ctx.effect(() => () => {
        this.owners.delete(id);
        this.discussions.closeOwner(id);
      }, 'chat-actions: release disconnected discussions');
    }
    return id;
  }

  create(request, signal) { return this.discussions.create(request, this.owner(), signal); }
  selectModel(request, signal) { return this.discussions.selectModel(request, this.owner(), signal); }
  stream(request, signal) { return this.discussions.stream(request, this.owner(), signal); }
  cancel(request) { return this.discussions.cancel(request, this.owner()); }
  close(request) { return this.discussions.close(request, this.owner()); }
}
