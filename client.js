window.__ModuleLoader__.load({
  id: 'dsh-chat-actions',
  factory(require) {
    const React = require('react');
    const { MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;

    const NS = 'chatActions';
    /** Build marker: bumped on every behaviour change so the running page can
     *  prove which bundle it actually loaded (see console + toolbar tooltip). */
    const BUILD = 'v22-queue-manager-shortcuts';
    /** How many queued attachments a row shows before the rest collapse into a
     *  count button; the full list stays one click away. */
    const MAX_QUEUE_THUMBS = 3;
    const ASK_KIND = 'chat-actions-ask';
    const ASK_ID = 'dsh-chat-actions/ask';
    const TOOLS_ID = 'chat-actions-tools';
    const SENTINEL_TEXT = '·';
    const QUOTE_SOURCE = 'chat-actions-quote';
    const QUOTE_LABEL_CHARS = 60;
    let hostSwitch;
    try { hostSwitch = require('@deepseek-ai/dsh-client-ui-primitives').Switch; } catch (_error) { /* older host */ }
    let browserStorage;
    try { browserStorage = window.localStorage; } catch (_error) { /* restricted client */ }
    const EFFORT_SETTING = 'dsh-chat-actions.remember-reasoning';
    const effortListeners = new Set();
    let effortEnabled = true;
    try { effortEnabled = browserStorage?.getItem(EFFORT_SETTING) !== 'false'; } catch (_error) { /* default */ }
    function setEffortEnabled(next) {
      effortEnabled = next === true;
      try { browserStorage?.setItem(EFFORT_SETTING, String(effortEnabled)); } catch (_error) { /* page-local choice */ }
      for (const notify of effortListeners) notify(effortEnabled);
    }
    function useEffortEnabled() {
      const [enabled, setEnabled] = useState(() => effortEnabled);
      useEffect(() => {
        effortListeners.add(setEnabled);
        setEnabled(effortEnabled);
        return () => effortListeners.delete(setEnabled);
      }, []);
      return enabled;
    }
    function EffortMemorySeat({ directory, memory }) {
      const enabled = useEffortEnabled();
      useEffect(() => enabled ? memory.attach(directory) : undefined, [directory, memory, enabled]);
      return null;
    }
    function ChatActionsSettings({ t, view }) {
      const enabled = useEffortEnabled();
      if (view === 'summary') return null;
      return h('div', { style: {
        padding: '12px 2px', color: 'var(--dsw-alias-label-primary)',
        display: 'flex', alignItems: 'center', gap: 16, minWidth: 0,
      } },
        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 2, minWidth: 0 } },
          h('div', { style: { fontSize: 13.5, fontWeight: 500, lineHeight: '20px', overflowWrap: 'anywhere' } }, t('rememberEffort')),
          h('div', { style: {
            fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 11.5, lineHeight: '16px', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-tertiary)',
          } }, t('rememberEffortHint'))),
        hostSwitch ? h(hostSwitch, { checked: enabled, onChange: next => setEffortEnabled(typeof next === 'boolean' ? next : !enabled), label: t('rememberEffort') })
          : h('input', { type: 'checkbox', role: 'switch', checked: enabled, 'aria-label': t('rememberEffort'), onChange: event => setEffortEnabled(event.currentTarget.checked) }));
    }

    /** Model-visible projection of one quote chip (Markdown blockquote). */
    function quoteFrame(payload) {
      const text = String((payload && payload.text) || '');
      const head = payload && payload.truncated ? '> [引用 · 对话片段 · 已截断]' : '> [引用 · 对话片段]';
      const body = text.split('\n').map((line) => '> ' + line).join('\n');
      return head + '\n' + body + '\n\n';
    }

    /** Codec: a chip ref (JSON) becomes the Markdown the model reads. */
    function quoteProject(ref) {
      try {
        const payload = JSON.parse(String(ref));
        if (payload === null || typeof payload !== 'object' || typeof payload.text !== 'string') return '';
        return quoteFrame(payload);
      } catch (_error) {
        return '';
      }
    }

    function quotePayloadOf(text, origin) {
      const raw = String(text || '');
      // Only the label is shortened. Never silently truncate model-facing text.
      return { text: raw, truncated: false, ...(origin ? { origin } : {}) };
    }

    function quoteLabelOf(text) {
      const flat = String(text || '').replace(/\s+/g, ' ').trim();
      return flat.length > QUOTE_LABEL_CHARS ? flat.slice(0, QUOTE_LABEL_CHARS) + '…' : flat;
    }

    /** Replace one native reference without flattening other chips or commands. */
    function replaceQuote(draft, reference, text, origin) {
      const refs = draft.references || [];
      const index = refs.findIndex((item) => item.source === QUOTE_SOURCE
        && item.ref === reference.ref && item.offset === reference.offset && item.length === reference.length);
      if (index < 0) return undefined;
      const current = refs[index];
      const payload = text === null ? null : quotePayloadOf(text, origin);
      const replacement = payload === null ? '' : quoteFrame(payload);
      const delta = replacement.length - current.length;
      return {
        ...draft,
        text: draft.text.slice(0, current.offset) + replacement + draft.text.slice(current.offset + current.length),
        references: refs.flatMap((item, i) => {
          if (i === index) return payload === null ? [] : [{ ...item,
            ref: JSON.stringify(payload), label: quoteLabelOf(text), clipboardText: replacement, length: replacement.length
          }];
          return [{ ...item, offset: item.offset >= current.offset + current.length ? item.offset + delta : item.offset }];
        })
      };
    }

    /** The same props-to-handler bridge used by the real toolbar and tests. */
    function toolsApiOf(props, input) {
      return {
        inputActions: props.inputActions,
        insertQuote: props.insertQuote,
        updateQuote: props.updateQuote,
        openAsk: props.openAsk,
        sendPrompt: props.sendPrompt,
        sessionId: props.sessionId,
        t: props.t,
        draft: input && typeof input.draft === 'string' ? input.draft : ''
      };
    }

    /** Chip-only action: failure never substitutes or truncates the selection. */
    function addSelectedQuote(api, target) {
      if (!target || typeof target.text !== 'string' || target.text.trim() === '') {
        return { ok: false, reason: 'empty-selection' };
      }
      if (!api || typeof api.insertQuote !== 'function') {
        return { ok: false, reason: 'quote-action-missing' };
      }
      let span;
      try { span = api.inputActions?.captureInsertion?.(); } catch (_error) { /* append instead */ }
      try {
        const inserted = api.insertQuote(target.text, span, target.origin);
        return inserted === true
          ? { ok: true }
          : { ok: false, reason: 'quote-chip-rejected' };
      } catch (error) {
        return { ok: false, reason: 'quote-chip-error', error };
      }
    }

    // ------------------------------------------------------------------
    // Copy
    // ------------------------------------------------------------------
    const zh = {
      rememberEffort: '记住模型推理等级',
      rememberEffortHint: '按服务商和模型记住手选档位，切回时恢复。保存在当前客户端，关闭后保留记忆。',
      'tools.addToComposer': '添加到对话',
      'tools.quoteFailed': '引用未添加，点击重试',
      'tools.askSidebar': '在侧边栏提问',
      'tools.editMessage': '编辑消息',
      'tools.editResend': '编辑后重发',
      'tools.editTitle': '编辑消息',
      'tools.send': '发送',
      'tools.cancel': '取消',
      'quote.label': '引用 {n}',
      'quote.edit': '重新选择原文',
      'quote.count': '{n} 条引用',
      'quote.close': '关闭引用预览',
      'quote.reselect': '在原消息中重新圈选，然后保存',
      'quote.unavailable': '无法唯一定位原文，请在原消息中重新划选并添加引用。',
      'quote.remove': '删除引用',
      'quote.changed': '草稿已变化，请重新打开引用预览后再操作',
      'editor.placeholder': '从这条消息之前继续，原消息及其后的回复不再显示…',
      'editor.empty': '内容不能为空',
      'editor.sendFailed': '发送失败：{message}',
      'editor.sent': '已发送',
      'editor.unavailable': '无法从这条消息之前继续，原消息仍会留在当前会话',
      'editor.textOnly': '仅重发文字；原消息的附件不会随之发送。这条消息之后的回复也会离开当前会话',
      'ask.title': '选区提问',
      'ask.readOnly': '只读侧聊 · 不执行工具',
      'ask.model': '侧聊模型',
      'ask.effort': '推理等级',
      'ask.defaultEffort': '默认',
      'ask.inheritModel': '继承原对话模型',
      'ask.modelsLoading': '正在加载模型…',
      'ask.modelsUnavailable': '模型列表暂不可用，仍可继承原对话模型',
      'ask.reloadModels': '重新加载',
      'ask.nextModel': '模型只用于侧聊；切换后从下一次回复生效',
      'ask.modelChanging': '正在切换模型…',
      'ask.generating': '正在生成，按 Esc 或点击停止',
      'ask.stopping': '正在停止…',
      'ask.stopHint': '停止生成（Esc），保留已有回复',
      'ask.contextUnavailable': '无法定位已完成的原消息，请在已完成的回复中重新划选。',
      'ask.stop': '停止生成',
      'ask.stopped': '已停止',
      'ask.new': '新侧聊',
      'ask.added': '已引用到主输入框，尚未发送',
      'ask.user': '你',
      'ask.assistant': '助手',
      'ask.reasoning': '思考过程',
      'ask.copy': '复制',
      'ask.copied': '已复制',
      'ask.footnotes': '脚注',
      'ask.quoteLabel': '选中的对话内容',
      'ask.questionPlaceholder': '针对选中内容提问，回车发送…',
      'ask.send': '发送问题',
      'ask.sent': '已发送到独立侧边会话',
      'ask.defaultQuestion': '请解释以上内容',
      'ask.failed': '发送失败：{message}',
      'ask.empty': '没有拿到选中的内容，请重新选择后再试',
      'queue.count': '{n} 条排队消息',
      'queue.sendHint': '发送队列中的下一条',
      'queue.edit': '编辑',
      'queue.attachmentEdit': '含附件的消息暂不支持编辑，可直接发送或删除',
      'queue.save': '保存',
      'queue.cancel': '取消',
      'queue.remove': '删除',
      'queue.sending': '发送中…',
      'queue.waking': '正在恢复队列，请稍候',
      'queue.attachments': '{n} 个附件',
      'queue.image': '点击查看大图',
      'queue.waiting': '前面还有 {n} 条，按顺序发送',
      'queue.sendFailed': '发送失败，请重试',
      'queue.removeFailed': '删除失败：这条消息可能已经开始发送。',
      'queue.editFailed': '编辑失败：这条消息可能已经开始发送。',
      'queue.pausedHint': '对话已停止，点击队首发送按钮继续；消息仍按排队顺序保留',
      'queue.steer': '立即插话',
      'queue.steerHint': '加入当前任务，在下一步骤处理；不会中断正在执行的模型请求或工具',
      'queue.sendNext': '发送下一条',
      'queue.expandMessage': '展开查看完整消息',
      'queue.collapseMessage': '收起完整消息',
      'queue.finishEdit': '请先保存或取消当前编辑',
      'queue.editKeys': 'Ctrl/⌘ + Enter 保存 · Esc 取消',
      'queue.editChanged': '原消息已变化或开始发送，修改未提交；请先复制保留，再重新编辑。',
      'queue.editOrphaned': '原消息已离开队列。未保存的修改仍保留在这里。',
      'queue.editKeep': '可复制修改后关闭；不会自动重新发送',
      'queue.copyEdit': '复制修改',
      'queue.copied': '已复制',
      'queue.copyFailed': '无法自动复制，已选中文字；请按 Ctrl/⌘ + C 复制。',
      'queue.closeEdit': '关闭编辑',
      'queue.retry': '重试',
      'queue.saving': '正在保存，等待队列确认…',
      'queue.removing': '正在移除，等待队列确认…',
      'queue.steering': '正在加入当前任务…',
      'queue.admitting': '正在加入队列…',
      'queue.file': '文件',
      'queue.shortcuts': '↑↓ 选择 · Enter 发送 · E 编辑 · Del 删除',
      'queue.shortcutHelp': '↑↓ 选择消息，Enter 发送或插话，E 编辑，Del 删除；Tab 进入队列'
    };
    const en = {
      rememberEffort: 'Remember model reasoning effort',
      rememberEffortHint: 'Restore the last chosen effort per provider and model. Saved in this client and retained while disabled.',
      'tools.addToComposer': 'Add to chat',
      'tools.quoteFailed': 'Quote not added — retry',
      'tools.askSidebar': 'Ask in sidebar',
      'tools.editMessage': 'Edit message',
      'tools.editResend': 'Edit & resend',
      'tools.editTitle': 'Edit message',
      'tools.send': 'Send',
      'tools.cancel': 'Cancel',
      'quote.label': 'Quote {n}',
      'quote.edit': 'Reselect source text',
      'quote.count': '{n} quotes',
      'quote.close': 'Close quote preview',
      'quote.reselect': 'Select text in the original message, then save',
      'quote.unavailable': 'The source could not be uniquely located. Select it in the original message and add a new quote.',
      'quote.remove': 'Remove quote',
      'quote.changed': 'Draft changed. Reopen the quote preview and try again.',
      'editor.placeholder': 'Continue from before this message; it and later replies leave this view…',
      'editor.empty': 'Content cannot be empty',
      'editor.sendFailed': 'Send failed: {message}',
      'editor.sent': 'Sent',
      'editor.unavailable': 'Cannot continue from before this message, so it stays in the current session',
      'editor.textOnly': 'Resends text only; original attachments are not included. Replies after this message also leave the current session',
      'ask.title': 'Ask about selection',
      'ask.readOnly': 'Read-only · No tools',
      'ask.model': 'Side Chat model',
      'ask.effort': 'Reasoning effort',
      'ask.defaultEffort': 'Default',
      'ask.inheritModel': 'Inherit parent model',
      'ask.modelsLoading': 'Loading models…',
      'ask.modelsUnavailable': 'Model list unavailable; the parent model can still be inherited',
      'ask.reloadModels': 'Reload',
      'ask.nextModel': 'Side Chat only; changes apply to the next reply',
      'ask.modelChanging': 'Changing model…',
      'ask.generating': 'Generating. Press Esc or click Stop',
      'ask.stopping': 'Stopping…',
      'ask.stopHint': 'Stop (Esc) and keep the partial reply',
      'ask.contextUnavailable': 'The completed source message could not be located. Select it again.',
      'ask.stop': 'Stop',
      'ask.stopped': 'Stopped',
      'ask.new': 'New discussion',
      'ask.added': 'Quoted in the main composer; not sent',
      'ask.user': 'You',
      'ask.assistant': 'Assistant',
      'ask.reasoning': 'Reasoning',
      'ask.copy': 'Copy',
      'ask.copied': 'Copied',
      'ask.footnotes': 'Footnotes',
      'ask.quoteLabel': 'Selected conversation content',
      'ask.questionPlaceholder': 'Ask about the selection, Enter to send…',
      'ask.send': 'Send question',
      'ask.sent': 'Sent to the independent side chat',
      'ask.defaultQuestion': 'Please explain the content above',
      'ask.failed': 'Send failed: {message}',
      'ask.empty': 'No selection content was provided. Select the text again and retry.',
      'queue.count': '{n} queued messages',
      'queue.sendHint': 'Send the next queued message',
      'queue.edit': 'Edit',
      'queue.attachmentEdit': 'Messages with attachments can be sent or removed, but cannot be edited yet',
      'queue.save': 'Save',
      'queue.cancel': 'Cancel',
      'queue.remove': 'Remove',
      'queue.sending': 'Sending…',
      'queue.waking': 'Resuming the queue. Please wait.',
      'queue.attachments': '{n} attachment(s)',
      'queue.image': 'Click to enlarge',
      'queue.waiting': '{n} ahead — messages send in order',
      'queue.sendFailed': 'Send failed, please retry',
      'queue.removeFailed': 'Removal failed: this message may have already started sending.',
      'queue.editFailed': 'Edit failed: this message may have already started sending.',
      'queue.pausedHint': 'The conversation is stopped. Send the first message to continue; queue order is preserved.',
      'queue.steer': 'Send now',
      'queue.steerHint': 'Join the current task at its next step; does not interrupt an active model request or tool.',
      'queue.sendNext': 'Send next',
      'queue.expandMessage': 'Show the complete message',
      'queue.collapseMessage': 'Collapse the message',
      'queue.finishEdit': 'Save or cancel the current edit first',
      'queue.editKeys': 'Ctrl/⌘ + Enter to save · Esc to cancel',
      'queue.editChanged': 'The original message changed or started sending. Your changes were not submitted; copy them before editing again.',
      'queue.editOrphaned': 'The original message left the queue. Your unsaved changes are still here.',
      'queue.editKeep': 'Copy your changes before closing; they will not be resent automatically',
      'queue.copyEdit': 'Copy changes',
      'queue.copied': 'Copied',
      'queue.copyFailed': 'Could not copy automatically. Text selected; press Ctrl/⌘ + C to copy.',
      'queue.closeEdit': 'Close editor',
      'queue.retry': 'Retry',
      'queue.saving': 'Saving — waiting for the queue…',
      'queue.removing': 'Removing — waiting for the queue…',
      'queue.steering': 'Joining the current task…',
      'queue.admitting': 'Joining the queue…',
      'queue.file': 'File',
      'queue.shortcuts': '↑↓ select · Enter send · E edit · Del remove',
      'queue.shortcutHelp': '↑↓ select a message, Enter send or steer, E edit, Del remove; Tab enters the queue'
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    function textOf(content) {
      if (!Array.isArray(content)) return '';
      let out = '';
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') out += block.text;
      }
      return out;
    }

    /** Image and file blocks of one queued message. The strip only reports
     *  their count; sending keeps the original content untouched. */
    function attachmentCountOf(content) {
      if (!Array.isArray(content)) return 0;
      let count = 0;
      for (const block of content) {
        if (block && (block.type === 'image' || block.type === 'file')) count += 1;
      }
      return count;
    }

    /** Image and file blocks of one queued message, in order. An image carries
     *  the durable attachment the host resolves to a URL; a file only its name. */
    function attachmentsOf(content) {
      if (!Array.isArray(content)) return [];
      const out = [];
      for (const block of content) {
        if (!block || (block.type !== 'image' && block.type !== 'file')) continue;
        if (!block.attachment) continue;
        out.push({ type: block.type, attachment: block.attachment });
      }
      return out;
    }

    function formatT(t, key, params) {
      let text = '';
      try { text = t(key); } catch (_error) { text = key; }
      if (params === undefined) return text;
      return String(text).replace(/\{(\w+)\}/g, (whole, name) => {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole;
      });
    }

    function newRequestId() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch (_error) { /* fall through */ }
      return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function isEditableMessageKind(kind) {
      return kind === 'user' || kind === 'steering';
    }

    /** Chat row key for an input message: `${kind.length}:${kind}${id}`. */
    const INPUT_MESSAGE_KEY_PREFIX = '13:input-message';

    function inputMessageId(key) {
      if (typeof key !== 'string' || !key.startsWith(INPUT_MESSAGE_KEY_PREFIX)) return undefined;
      const id = key.slice(INPUT_MESSAGE_KEY_PREFIX.length);
      return id === '' ? undefined : id;
    }

    /**
     * Inclusive fork boundary that drops the edited message.
     * Host `atSeq` keeps that event, so the cut is the previous seq.
     * Seq 0 has no earlier event; omitting `atSeq` can still keep the message.
     */
    function editCutSeq(binding, key) {
      const id = inputMessageId(key);
      // ISession has no event list; the binding's event window is the only
      // supported way to read committed events from the Client.
      const source = binding && binding.eventSource;
      const window = source && typeof source.getSnapshot === 'function' ? source.getSnapshot() : undefined;
      if (!id || !window || !Array.isArray(window.entries)) throw new Error('edit-source-unavailable');
      let match;
      for (const entry of window.entries) {
        if (!entry || entry.type !== 'event') continue;
        const event = entry.event;
        if (!event || event.type !== 'user/message' || !event.data || String(event.data.id) !== id) continue;
        if (match) throw new Error('edit-source-unavailable');
        match = event;
      }
      if (!match || !Number.isSafeInteger(match.seq) || match.seq < 1) throw new Error('edit-source-unavailable');
      return match.seq - 1;
    }

    function messageTextOf(row) {
      try {
        const clone = row.cloneNode(true);
        const drop = clone.querySelectorAll('button, [data-clock], [aria-hidden="true"]');
        for (const node of drop) node.remove();
        const text = clone.textContent || '';
        return text.trim() === '' ? '' : text;
      } catch (_error) {
        return '';
      }
    }

    // DOM text offsets survive a render without retaining detached message nodes.
    function rangeAt(row, start, end) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
      const walker = row.ownerDocument.createTreeWalker(row, 4);
      const range = row.ownerDocument.createRange();
      let offset = 0, began = false, node;
      while ((node = walker.nextNode())) {
        const next = offset + node.textContent.length;
        if (!began && start < next) { range.setStart(node, start - offset); began = true; }
        if (began && end <= next) { range.setEnd(node, end - offset); return range; }
        offset = next;
      }
      return null;
    }

    function quoteOrigin(range, sessionId, text) {
      const element = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
      const row = element?.closest?.('[data-chat-flow-key]');
      if (!row || !row.contains(range.endContainer)) return undefined;
      const prefix = range.cloneRange();
      prefix.selectNodeContents(row);
      prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      const domText = range.toString();
      return { sessionId, key: row.getAttribute('data-chat-flow-key'), start, end: start + domText.length,
        ...(typeof text === 'string' && text !== domText ? { domText } : {}) };
    }

    function quoteOffsets(raw, text) {
      // Match rendered whitespace without guessing which of repeated excerpts was meant.
      const folded = [], offsets = [];
      for (let i = 0; i < raw.length; i++) {
        const char = /\s/.test(raw[i]) ? ' ' : raw[i];
        if (char === ' ' && folded[folded.length - 1] === ' ') continue;
        folded.push(char); offsets.push(i);
      }
      const needle = text.replace(/\s+/g, ' ').trim();
      const haystack = folded.join('');
      const start = needle ? haystack.indexOf(needle) : -1;
      if (start < 0 || haystack.indexOf(needle, start + 1) >= 0) return null;
      return { start: offsets[start], end: offsets[start + needle.length - 1] + 1 };
    }

    function locateQuote(root, payload, sessionId) {
      const rows = [...root.querySelectorAll('[data-chat-flow-key]')].filter(row => row.closest('[data-conversation-content]') === root);
      const sourceText = payload.origin?.domText ?? payload.text;
      const equalText = range => range && range.toString().replace(/\s+/g, ' ').trim() === sourceText.replace(/\s+/g, ' ').trim();
      if (payload.origin) {
        if (payload.origin.sessionId !== sessionId) return null;
        const row = rows.find(item => item.getAttribute('data-chat-flow-key') === payload.origin.key);
        if (!row) return null;
        const range = rangeAt(row, payload.origin.start, payload.origin.end);
        if (equalText(range)) return { row, range };
        // Streaming may change offsets, but it must never redirect to another message.
        const offsets = quoteOffsets(row.textContent || '', sourceText);
        const relocated = offsets && rangeAt(row, offsets.start, offsets.end);
        return equalText(relocated) ? { row, range: relocated } : null;
      }
      const matches = [];
      for (const row of rows) {
        const needle = payload.text.replace(/\s+/g, ' ').trim();
        const plain = (row.textContent || '').replace(/\s+/g, ' ');
        const first = plain.indexOf(needle);
        if (needle && first >= 0 && plain.indexOf(needle, first + 1) >= 0) return null;
        const offsets = quoteOffsets(row.textContent || '', payload.text);
        const range = offsets && rangeAt(row, offsets.start, offsets.end);
        if (!equalText(range) || matches.some(item => item.range.startContainer === range.startContainer && item.range.startOffset === range.startOffset && item.range.endContainer === range.endContainer && item.range.endOffset === range.endOffset)) continue;
        matches.push({ row, range });
      }
      return matches.length === 1 ? matches[0] : null;
    }

    const FONT = '12px/18px var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)';
    const TOKEN_BG = 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-module-platform, #2a2a2a))';
    const TOKEN_TEXT = 'var(--dsw-alias-label-primary, inherit)';
    const TOKEN_MUTED = 'var(--dsw-alias-label-secondary, inherit)';
    const TOKEN_BORDER = '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))';
    const TOKEN_HOVER = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18))';

    function makeButton(labelText, onClick, options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = labelText;
      if (options && options.title) button.title = options.title;
      Object.assign(button.style, {
        font: FONT,
        height: '24px',
        padding: '0 8px',
        borderRadius: '7px',
        border: 'none',
        cursor: 'pointer',
        background: options && options.quiet ? 'transparent' : TOKEN_HOVER,
        color: (options && options.quiet ? TOKEN_MUTED : TOKEN_TEXT),
        whiteSpace: 'nowrap'
      });
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', onClick);
      return button;
    }

    // ------------------------------------------------------------------
    // Floating UI: selection toolbar + message edit button + inline editor
    // (rendered into document.body so fixed coordinates are viewport ones)
    // ------------------------------------------------------------------
    function QuoteDraft({ input, updateQuote, onReselect, t }) {
      const [open, setOpen] = useState(false);
      const [error, setError] = useState('');
      const trigger = useRef(null);
      const popup = useRef(null);
      const popupId = useRef('chat-actions-quotes-' + newRequestId());
      const quotes = ((input && input.occurrences) || []).filter((item) => item.source === QUOTE_SOURCE);
      useEffect(() => {
        if (quotes.length === 0) { setOpen(false); return; }
        const panel = popup.current;
        if (!panel) return;
        const toggle = event => setOpen(event.newState === 'open');
        panel.addEventListener('toggle', toggle);
        return () => panel.removeEventListener('toggle', toggle);
      }, [quotes.length > 0]);
      useEffect(() => {
        if (!open) return;
        const close = event => { if (!popup.current?.contains(event.target)) popup.current?.hidePopover(); };
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
      }, [open]);
      const remove = reference => {
        if (typeof updateQuote !== 'function' || !updateQuote(reference, null, input.draftRev)) {
          setError(formatT(t, 'quote.changed'));
          return;
        }
        setError('');
        if (quotes.length === 1) popup.current?.hidePopover();
      };
      const reselect = reference => {
        popup.current?.hidePopover();
        if (!onReselect?.(reference, input.draftRev, setError)) {
          setError(formatT(t, 'quote.unavailable'));
          return;
        }
        setError('');
      };
      const togglePopup = () => {
        const panel = popup.current;
        if (!panel) return;
        if (panel.matches(':popover-open')) { panel.hidePopover(); return; }
        panel.showPopover();
        const anchor = trigger.current.getBoundingClientRect();
        const box = panel.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)) + 'px';
        const top = anchor.top - box.height - 8;
        panel.style.top = Math.max(8, Math.min(top >= 8 ? top : anchor.bottom + 8, window.innerHeight - box.height - 8)) + 'px';
      };
      if (quotes.length === 0) return null;
      const button = (label, onClick, disabled) => h('button', {
        key: label, type: 'button', onClick, disabled, title: label, 'aria-label': label,
        style: { border: 'none', borderRadius: '5px', padding: '3px 6px', background: TOKEN_HOVER, color: TOKEN_TEXT, font: FONT, cursor: 'pointer' }
      }, label);
      return h('div', {
        'data-chat-actions-quotes': '',
        style: {
          boxSizing: 'border-box', minWidth: 0,
          width: 'calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px))',
          maxWidth: 'var(--dsh-composer-card-max-width, 100%)', marginInline: 'auto',
          marginBottom: '6px', color: TOKEN_TEXT, font: FONT
        }
      }, h('button', {
        ref: trigger, type: 'button', onClick: togglePopup,
        'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': popupId.current,
        style: { border: TOKEN_BORDER, borderRadius: '7px', background: TOKEN_HOVER, color: TOKEN_TEXT, font: FONT, padding: '4px 8px', cursor: 'pointer' }
      }, formatT(t, 'quote.count', { n: quotes.length })), error && !open ? h('div', { role: 'status' }, error) : null, h('div', {
        ref: popup, id: popupId.current, popover: 'auto', role: 'dialog', 'aria-label': formatT(t, 'quote.count', { n: quotes.length }),
        style: { position: 'fixed', inset: 'auto', margin: 0, width: 'min(360px, calc(100vw - 32px))', maxHeight: 'min(320px, 50vh)', overflowY: 'auto', boxSizing: 'border-box', padding: '10px', border: TOKEN_BORDER, borderRadius: '9px', background: TOKEN_BG, color: TOKEN_TEXT, font: FONT, boxShadow: '0 8px 24px rgba(0,0,0,.30)' }
      }, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, formatT(t, 'quote.count', { n: quotes.length }), button(formatT(t, 'quote.close'), () => popup.current?.hidePopover())), quotes.map((reference, index) => {
        let text = '';
        try { text = JSON.parse(reference.ref).text; } catch (_error) { /* invalid chip can still be removed */ }
        return h('div', {
          key: String(reference.offset) + ':' + index,
          style: { padding: '8px 0', borderTop: TOKEN_BORDER, marginTop: '8px' }
        },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', color: TOKEN_MUTED } }, formatT(t, 'quote.label', { n: index + 1 }), h('div', null,
            button(formatT(t, 'quote.edit'), () => reselect(reference)), button(formatT(t, 'quote.remove'), () => remove(reference)))),
          h('div', { style: { marginTop: '6px', maxHeight: '180px', overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, text)
        );
      }), error ? h('div', { role: 'status', style: { color: 'var(--dsw-alias-label-error, #d9534f)' } }, error) : null));
    }

    function ChatTools(props) {
      const { useInput } = props;
      const input = typeof useInput === 'function' ? useInput((state) => state) : undefined;
      const ref = useRef({});
      const anchor = useRef(null);
      const quoteEditor = useRef(null);
      ref.current = toolsApiOf(props, input);

      useEffect(() => {
        const api = ref.current;
        const t = api.t;
        const root = anchor.current && anchor.current.closest('[data-conversation-content]');
        if (!root) return;
        const owns = (node) => {
          const element = node?.nodeType === 3 ? node.parentElement : node;
          return element?.closest?.('[data-conversation-content]') === root;
        };
        // ---------- selection toolbar -------------------------------
        const bar = document.createElement('div');
        bar.setAttribute('data-chat-actions-tools', '');
        Object.assign(bar.style, {
          position: 'fixed', zIndex: '2147483000', display: 'none',
          alignItems: 'center', gap: '2px', padding: '3px 4px',
          borderRadius: '9px', background: TOKEN_BG, color: TOKEN_TEXT,
          border: TOKEN_BORDER, boxShadow: '0 8px 24px rgba(0,0,0,.30)',
          font: FONT, whiteSpace: 'nowrap', userSelect: 'none'
        });

        const addButton = makeButton(formatT(t, 'tools.addToComposer'), () => {
          const outcome = addSelectedQuote(ref.current, stateRef.current.toolbar);
          if (outcome.ok) {
            hideBar();
          } else {
            // Keep the quote selected for retry; never silently paste an excerpt.
            addButton.textContent = formatT(ref.current.t, 'tools.quoteFailed');
            addButton.title = outcome.reason;
            console.warn('[chat-actions] add quote failed', outcome.reason, outcome.error);
          }
        });
        const askButton = makeButton(formatT(t, 'tools.askSidebar'), () => {
          const target = stateRef.current.toolbar;
          if (!target || typeof ref.current.openAsk !== 'function') return;
          if (ref.current.openAsk(target.text, ref.current.sessionId, target.origin)) hideBar();
          else askButton.textContent = formatT(t, 'tools.quoteFailed');
        });
        // Selection tools apply to either role, but editing belongs ONLY to a
        // sent human message and is exposed separately next to its copy action.
        addButton.title = formatT(t, 'tools.addToComposer') + '  [' + BUILD + ']';
        bar.append(addButton, askButton);
        document.body.appendChild(bar);

        let reselecting = null;
        const selectionBar = document.createElement('div');
        selectionBar.setAttribute('data-chat-actions-reselect', '');
        selectionBar.setAttribute('role', 'toolbar');
        selectionBar.setAttribute('aria-label', formatT(t, 'quote.edit'));
        selectionBar.style.cssText = bar.style.cssText;
        selectionBar.style.maxWidth = 'calc(100vw - 16px)';
        selectionBar.style.flexWrap = 'wrap';
        const selectionHint = document.createElement('span');
        selectionHint.textContent = formatT(t, 'quote.reselect');
        const finishReselect = () => {
          reselecting = null;
          selectionBar.style.display = 'none';
          window.getSelection()?.removeAllRanges();
        };
        const saveSelection = makeButton(formatT(t, 'queue.save'), () => {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || !readSelection()) return;
          const current = reselecting;
          if (!current?.candidate || !current.row.isConnected || !root.contains(current.candidate.range.commonAncestorContainer)) return;
          const { text, origin } = current.candidate;
          const ok = ref.current.updateQuote?.(current.reference, text, current.revision, origin);
          finishReselect();
          if (!ok) current.report(formatT(t, 'quote.changed'));
        });
        selectionBar.append(selectionHint, makeButton(formatT(t, 'tools.cancel'), () => finishReselect(), { quiet: true }), saveSelection);
        document.body.appendChild(selectionBar);
        quoteEditor.current = (reference, revision, report) => {
          let payload;
          try { payload = JSON.parse(reference.ref); } catch (_error) { return false; }
          if (typeof payload?.text !== 'string') return false;
          const source = locateQuote(root, payload, props.sessionId);
          if (!source) return false;
          hideBar();
          source.row.scrollIntoView({ block: 'center', behavior: 'instant' });
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.addRange(source.range);
          reselecting = { reference, revision, report, row: source.row,
            candidate: { text: payload.text, range: source.range, origin: quoteOrigin(source.range, props.sessionId, payload.text) } };
          saveSelection.disabled = false;
          placeAbove(selectionBar, source.range.getBoundingClientRect());
          return true;
        };

        // ---------- per-message edit pencil (inside the host action row) ---
        // The host renders a sent user message's actions as a flex row (gap 8px)
        // of 28x28 buttons. We insert our button as a sibling of the Copy
        // button and reuse the host's own class, so size, radius, colour and
        // spacing match exactly. A floating overlay could not align.
        const pencilIcon = () => {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '16');
          svg.setAttribute('height', '16');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke', 'currentColor');
          svg.setAttribute('stroke-width', '1.7');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');
          svg.setAttribute('aria-hidden', 'true');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', 'M4 20h4L18.5 9.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z');
          svg.appendChild(path);
          return svg;
        };

        const actionsRowOf = (row) => {
          const candidates = row.querySelectorAll('[data-clock]');
          for (const candidate of candidates) {
            if (candidate.querySelector('button')) return candidate;
          }
          return null;
        };

        const attachPencil = (row) => {
          const actions = actionsRowOf(row);
          if (!actions) return null;
          const existing = actions.querySelector('[data-chat-actions-pencil]');
          if (existing) return existing;
          const copy = actions.querySelector('button');
          if (!copy) return null;
          const pencil = document.createElement('button');
          pencil.type = 'button';
          pencil.setAttribute('data-chat-actions-pencil', '');
          pencil.setAttribute('aria-label', formatT(t, 'tools.editMessage'));
          pencil.title = formatT(t, 'tools.editMessage');
          pencil.className = copy.className;
          pencil.appendChild(pencilIcon());
          const anchor = copy.parentElement && copy.parentElement !== actions ? copy.parentElement : copy;
          anchor.parentElement.insertBefore(pencil, anchor.nextSibling);
          return pencil;
        };

        // ---------- inline editor -----------------------------------
        const editor = document.createElement('div');
        editor.setAttribute('data-chat-actions-editor', '');
        Object.assign(editor.style, {
          display: 'none', flexDirection: 'column', gap: '6px',
          padding: '10px 12px', margin: '6px 0',
          boxSizing: 'border-box', width: '100%', maxWidth: 'none',
          borderRadius: '12px', background: TOKEN_BG, color: TOKEN_TEXT,
          border: TOKEN_BORDER, font: FONT
        });

        const textarea = document.createElement('textarea');
        textarea.setAttribute('aria-label', formatT(t, 'tools.editMessage'));
        textarea.name = 'chat-actions-edit-message';
        textarea.autocomplete = 'off';
        textarea.placeholder = formatT(t, 'editor.placeholder');
        Object.assign(textarea.style, {
          boxSizing: 'border-box', width: '100%', flex: '1 1 auto', minHeight: '38px',
          resize: 'none', padding: '0', border: 'none',
          background: 'transparent', color: TOKEN_TEXT,
          font: 'var(--dsh-content-font-size, 14px)/calc(24px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family, system-ui, sans-serif)'
        });

        const editorStatus = document.createElement('span');
        editorStatus.setAttribute('role', 'status');
        Object.assign(editorStatus.style, { font: FONT, opacity: '0.75', flex: '1 1 auto' });

        const editorActions = document.createElement('div');
        Object.assign(editorActions.style, {
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px',
        });

        let sending = false;
        let editingKey = '';
        const sendButton = makeButton(formatT(t, 'tools.send'), async () => {
          if (sending) return;
          const value = textarea.value;
          if (value.trim() === '') { editorStatus.textContent = formatT(t, 'editor.empty'); return; }
          sending = true;
          sendButton.disabled = true;
          cancelButton.disabled = true;
          editorStatus.textContent = '';
          try {
            await ref.current.sendPrompt(value, { key: editingKey });
            editorStatus.textContent = formatT(t, 'editor.sent');
            closeEditor();
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error);
            editorStatus.textContent = message === 'edit-source-unavailable'
              ? formatT(t, 'editor.unavailable')
              : formatT(t, 'editor.sendFailed', { message });
          } finally {
            sending = false;
            sendButton.disabled = false;
            cancelButton.disabled = false;
          }
        });
        const cancelButton = makeButton(formatT(t, 'tools.cancel'), () => closeEditor(), { quiet: true });

        editorActions.append(editorStatus, cancelButton, sendButton);
        editor.append(textarea, editorActions);

        // ---------- positioning -------------------------------------
        const placeAbove = (element, rect) => {
          element.style.display = 'inline-flex';
          element.style.left = '0px';
          element.style.top = '0px';
          const box = element.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          let left = rect ? rect.left : 24;
          let top = rect ? rect.top - box.height - 10 : 80;
          if (rect && top < 8) top = rect.bottom + 10;
          left = Math.max(8, Math.min(left, vw - box.width - 8));
          top = Math.max(8, Math.min(top, vh - box.height - 8));
          element.style.left = Math.round(left) + 'px';
          element.style.top = Math.round(top) + 'px';
        };

        // ---------- state -------------------------------------------
        const stateRef = { current: { toolbar: null, pencil: null } };

        let repositionPending = false;
        const repositionBar = () => {
          if (reselecting) placeAbove(selectionBar, (reselecting.candidate?.range || reselecting.row).getBoundingClientRect());
          if (repositionPending) return;
          const target = stateRef.current.toolbar;
          if (!target || bar.style.display === 'none') return;
          repositionPending = true;
          requestAnimationFrame(() => {
            repositionPending = false;
            const current = stateRef.current.toolbar;
            if (!current || bar.style.display === 'none') return;
            let rect = null;
            try {
              if (current.range && typeof current.range.getBoundingClientRect === 'function') {
                const live = current.range.getBoundingClientRect();
                if (live && (live.width > 0 || live.height > 0)) rect = live;
              }
            } catch (_error) { rect = null; }
            if (!rect) { hideBar(); return; }
            placeAbove(bar, rect);
          });
        };
        const hideBar = () => {
          stateRef.current.toolbar = null;
          bar.style.display = 'none';
        };
        const removePencil = () => {
          const nodes = root.querySelectorAll('[data-chat-actions-pencil]');
          for (const node of nodes) node.remove();
        };
        const closeEditor = () => {
          editor.style.display = 'none';
          if (editor.parentElement) editor.parentElement.removeChild(editor);
          textarea.value = '';
          editorStatus.textContent = '';
          editingKey = '';
        };
        const openEditor = (text, rect, row) => {
          if (sending) return;
          if (!row || !isEditableMessageKind(row.getAttribute('data-chat-flow-kind'))) return;
          editingKey = row.getAttribute('data-chat-flow-key') || '';
          textarea.value = text;
          editorStatus.textContent = formatT(t, 'editor.textOnly');
          // Full-width placement: a sibling of the message row inside the chat
          // column. Width therefore tracks the composer width, and document
          // flow keeps it under the message it edits.
          const flow = row.closest('[data-slot="conversation.chat.flow"]') || row.parentElement;
          if (flow && row.parentElement === flow) flow.insertBefore(editor, row.nextSibling);
          else if (row.parentElement) row.parentElement.insertBefore(editor, row.nextSibling);
          editor.style.display = 'flex';
          textarea.focus();
          try { textarea.setSelectionRange(textarea.value.length, textarea.value.length); } catch (_error) { /* ignore */ }
        };



        // ---------- listeners ---------------------------------------
        let timer;
        const schedule = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (stateRef.current.toolbar && stateRef.current.toolbar.kind === 'message') return;
            const selection = window.getSelection();
            const collapsed = !selection || selection.isCollapsed || selection.rangeCount === 0;
            if (collapsed) {
              if (reselecting) { reselecting.candidate = null; saveSelection.disabled = true; return; }
              if (stateRef.current.toolbar) hideBar();
              return;
            }
            readSelection();
          }, 120);
        };

        const readSelection = () => {
          try {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
            const text = String(selection.toString() || '');
            if (text.trim() === '') return false;
            const range = selection.getRangeAt(0);
            const node = range.commonAncestorContainer;
            const element = node && node.nodeType === 3 ? node.parentElement : node;
            if (!element || typeof element.closest !== 'function') return false;
            if (reselecting) {
              const valid = owns(element) && reselecting.row.contains(range.startContainer) && reselecting.row.contains(range.endContainer)
                && !element.closest('input, textarea, [contenteditable="true"], [data-chat-actions-editor]');
              reselecting.candidate = valid ? { text, range: range.cloneRange(), origin: quoteOrigin(range, props.sessionId, text) } : null;
              saveSelection.disabled = !valid;
              if (valid) placeAbove(selectionBar, range.getBoundingClientRect());
              return valid;
            }
            if (!owns(element) || !owns(selection.anchorNode) || !owns(selection.focusNode)) { hideBar(); return false; }
            if (element.closest('[data-slot="conversation.chat.flow"]') === null) return false;
            const rect = range.getBoundingClientRect();
            stateRef.current.toolbar = { kind: 'selection', text, rect, range: range.cloneRange(), origin: quoteOrigin(range, props.sessionId, text) };
            placeAbove(bar, rect);
            return true;
          } catch (_error) {
            return false;
          }
        };

        const onClick = (event) => {
          const element = event.target;
          if (!element || typeof element.closest !== 'function') return;
          if (bar.contains(element) || selectionBar.contains(element) || element.closest('[data-chat-actions-pencil]') || editor.contains(element)) return;
          if (element.closest('[contenteditable="true"], textarea, input') !== null) {
            hideBar();
            removePencil();
            return;
          }
          showUserPencil(element);
        };

        const showUserPencil = (element) => {
          if (!owns(element)) return;
          const row = element.closest('[data-chat-flow-kind]');
          if (!row || !isEditableMessageKind(row.getAttribute('data-chat-flow-kind'))) return;
          if (messageTextOf(row) === '') return;
          attachPencil(row);
        };

        // Attach to every human message row as it appears. Relying on a hover
        // event misses rows already under the pointer (notably right after a
        // hot swap), and the host reveals the whole action row on hover anyway.
        const attachAllUserRows = () => {
          const rows = root.querySelectorAll('[data-chat-flow-kind]');
          for (const row of rows) {
            const kind = row.getAttribute('data-chat-flow-kind');
            if (!isEditableMessageKind(kind)) continue;
            if (messageTextOf(row) === '') continue;
            attachPencil(row);
          }
        };

        let attachScheduled = false;
        let attachTimer;
        const scheduleAttach = () => {
          if (attachScheduled) return;
          attachScheduled = true;
          attachTimer = setTimeout(() => {
            attachScheduled = false;
            try { attachAllUserRows(); } catch (error) { /* ignore */ }
            repositionBar();
          }, 60);
        };
        const onUserHover = (event) => {
          const element = event.target;
          if (!element || typeof element.closest !== 'function') return;
          if (bar.contains(element) || editor.contains(element)) return;
          showUserPencil(element);
        };

        const onPencilClick = (event) => {
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          const pencil = target.closest('[data-chat-actions-pencil]');
          if (!pencil) return;
          const row = pencil.closest('[data-chat-flow-kind]');
          if (!owns(row)) return;
          event.preventDefault();
          event.stopPropagation();
          if (!row || !isEditableMessageKind(row.getAttribute('data-chat-flow-kind'))) return;
          const text = messageTextOf(row);
          if (text === '') return;
          openEditor(text, row.getBoundingClientRect(), row);
        };

        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          if (reselecting) { finishReselect(); event.preventDefault(); return; }
          if (sending) return;
          if (editor.style.display !== 'none') { closeEditor(); return; }
          hideBar();
          removePencil();
        };

        // Re-anchor on scroll/resize rather than dismissing the bar. Both are
        // passive and coalesced by repositionBar's animation frame.
        const onScroll = () => { repositionBar(); };
        const onResize = () => { repositionBar(); };

        document.addEventListener('mouseup', schedule, true);
        document.addEventListener('selectionchange', schedule);
        document.addEventListener('click', onClick, true);
        document.addEventListener('pointerover', onUserHover, true);
        document.addEventListener('click', onPencilClick, true);
        const rowObserver = new MutationObserver(scheduleAttach);
        rowObserver.observe(root, { childList: true, subtree: true });
        attachAllUserRows();
        document.addEventListener('focusin', onUserHover, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        window.addEventListener('resize', onResize, { passive: true });

        return () => {
          clearTimeout(timer);
          clearTimeout(attachTimer);
          document.removeEventListener('mouseup', schedule, true);
          document.removeEventListener('selectionchange', schedule);
          document.removeEventListener('click', onClick, true);
          document.removeEventListener('pointerover', onUserHover, true);
          document.removeEventListener('click', onPencilClick, true);
          rowObserver.disconnect();
          document.removeEventListener('focusin', onUserHover, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onScroll, { capture: true });
          window.removeEventListener('resize', onResize);
          bar.remove();
          quoteEditor.current = null;
          if (reselecting) finishReselect();
          selectionBar.remove();
          removePencil();
          editor.remove();
        };
      }, [props.sessionId]);

      return h('div', { ref: anchor }, h(QuoteDraft, { input, updateQuote: props.updateQuote, t: props.t,
        onReselect: (...args) => quoteEditor.current?.(...args) }));
    }

    // ------------------------------------------------------------------
    // Queue dock (requirement 2).
    // This cell REPLACES the shipped queue dock, so the page shows exactly
    // one queue strip: rows keep their native identity (attachments
    // included), the running turn can steer any row into its next step, and
    // a paused conversation can wake its FIFO head through a one-shot
    // sentinel prompt the Host claims natively.
    // ------------------------------------------------------------------

    /** Thumbnail geometry: fixed so a row keeps its height while the host
     *  resolves the durable attachment into a URL. */
    const QUEUE_THUMB = {
      width: '20px', height: '20px', flex: 'none', display: 'block',
      borderRadius: '4px', background: 'rgba(127,127,127,.22)'
    };

    /** One queued image: the host resolves the attachment, the click opens the
     *  full-size preview — a queued screenshot is otherwise unreadable before
     *  it is sent. */
    function QueueThumb(props) {
      const { attachment, loadImage, label, onOpen } = props;
      const [url, setUrl] = useState(null);
      useEffect(() => {
        let alive = true;
        if (typeof loadImage !== 'function') return () => { alive = false; };
        try {
          Promise.resolve(loadImage(attachment)).then((resolved) => {
            if (alive && typeof resolved === 'string' && resolved !== '') setUrl(resolved);
          }, () => { /* the placeholder stays */ });
        } catch (_error) { /* the placeholder stays */ }
        return () => { alive = false; };
      }, [attachment, loadImage]);
      if (url === null) return h('span', { 'aria-hidden': true, title: label, style: QUEUE_THUMB });
      return h('img', {
        src: url,
        alt: label,
        title: label,
        'data-chat-actions-queue-thumb': '',
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen({ url, name: attachment && attachment.name ? attachment.name : label });
        },
        style: { ...QUEUE_THUMB, objectFit: 'cover', cursor: 'zoom-in' }
      });
    }

    /** Full-size preview of one queued image: a fixed overlay; a click, the
     *  backdrop, or Escape closes it. */
    function QueueImagePreview(props) {
      const { image, onClose, label } = props;
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          onClose();
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
      }, [onClose]);
      const title = image.name || label;
      return h('div', {
        'data-chat-actions-image-preview': '',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        onClick: () => onClose(),
        style: {
          position: 'fixed', inset: '0', zIndex: '2147483300',
          background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '28px', cursor: 'zoom-out'
        }
      }, h('img', {
        src: image.url,
        alt: title,
        style: {
          maxWidth: '92vw', maxHeight: '90vh', objectFit: 'contain',
          borderRadius: '8px', boxShadow: '0 16px 56px rgba(0,0,0,.55)'
        }
      }));
    }

    // All queue styles are scoped to this dock; no host/global selectors.
    const QUEUE_CSS = `
      [data-chat-actions-queue] .chat-actions-queue-control {
        box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
        flex: none; width: 28px; height: 28px; padding: 0; gap: 5px;
        border: 1px solid transparent; border-radius: 6px;
        background: transparent; color: var(--dsw-alias-label-secondary, #999);
        font: inherit; cursor: pointer;
        transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
      }
      [data-chat-actions-queue] .chat-actions-queue-control:not(:disabled):hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18));
        color: var(--dsw-alias-label-primary, inherit);
      }
      [data-chat-actions-queue] .chat-actions-queue-remove:not(:disabled):hover {
        color: var(--dsw-alias-label-error, #d9534f);
        background: color-mix(in srgb, currentColor 12%, transparent);
        border-color: color-mix(in srgb, currentColor 24%, transparent);
      }
      [data-chat-actions-queue] .chat-actions-queue-remove:not(:disabled):active {
        color: var(--dsw-alias-label-error, #d9534f);
        background: color-mix(in srgb, currentColor 20%, transparent);
        border-color: color-mix(in srgb, currentColor 32%, transparent);
      }
      [data-chat-actions-queue] :is(button, textarea):focus-visible {
        outline: 2px solid var(--dsw-alias-label-primary, currentColor); outline-offset: -2px;
      }
      [data-chat-actions-queue] button:disabled { opacity: .4; cursor: default; }
      [data-chat-actions-queue] .chat-actions-queue-send {
        width: auto; min-width: 28px; padding: 0 7px;
        background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.18));
        color: var(--dsw-alias-label-primary, inherit);
      }
      [data-chat-actions-queue] .chat-actions-queue-text {
        display: block; width: 100%; min-width: 0; padding: 3px 0; border: 0; border-radius: 4px;
        background: transparent; color: inherit; text-align: start; font: inherit; cursor: pointer;
      }
      [data-chat-actions-queue] .chat-actions-queue-clamp {
        display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
        white-space: pre-wrap; overflow-wrap: anywhere; line-height: 20px;
      }
      [data-chat-actions-queue] .chat-actions-queue-full {
        display: block; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 20px;
        max-height: 200px; overflow-y: auto;
      }
      [data-chat-actions-queue] .chat-actions-queue-file {
        display: inline-block; max-width: 180px; padding: 2px 6px; border-radius: 4px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
      }
      @media (max-width: 520px) {
        [data-chat-actions-queue] .chat-actions-queue-actions { gap: 0 !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-chat-actions-queue] .chat-actions-queue-control { transition: none; }
      }
    `;

    function queueIcon(name) {
      const paths = {
        remove: 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6',
        edit: 'm16 3 5 5M4 15 15 4a2 2 0 0 1 5 5L9 20l-6 1z',
        send: 'M12 19V5m-6 6 6-6 6 6',
        expand: 'm6 9 6 6 6-6',
        collapse: 'm6 15 6-6 6 6',
        clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0'
      };
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: 'false', style: { display: 'block', flex: 'none', pointerEvents: 'none' }
      }, h('path', { d: paths[name] }));
    }

    function PausedQueueBar(props) {
      const { useSession, useProjection, updateQueue, wakeQueue, sentinelIds, notify, loadImage, t } = props;
      const inbox = typeof useProjection === 'function' ? useProjection('inbox') : undefined;
      const pendingSubmissions = useSession((state) => state.pendingSubmissions) || [];
      const running = useSession((state) => state.running) === true;
      const subagent = useSession((state) => state.subagent === undefined ? null : state.subagent);
      const queueMutable = subagent === null || subagent?.address?.mode === 'continuable';
      const queue = useMemo(() => {
        const transcript = new Set(pendingSubmissions.filter(item => item.placement === 'transcript').map(item => item.requestId));
        return ((inbox && inbox['next-turn']) || []).filter(row => {
          const rpcId = row?.source?.kind === 'user' ? row.source.rpcId : undefined;
          return !rpcId || (!sentinelIds?.has(rpcId) && !transcript.has(rpcId));
        });
      }, [inbox, pendingSubmissions, sentinelIds]);
      const pending = useMemo(() => {
        const admitted = new Set(queue.filter(row => row?.source?.kind === 'user').map(row => row.source.rpcId));
        return pendingSubmissions.filter(item => item.placement === 'queued' && !admitted.has(item.requestId));
      }, [pendingSubmissions, queue]);
      const [editing, setEditing] = useState(null);
      const [busy, setBusy] = useState(null);
      const [preview, setPreview] = useState(null);
      const [activeIndex, setActiveIndex] = useState(0);
      const [focused, setFocused] = useState(false);
      const [expanded, setExpanded] = useState(null);
      const [rowError, setRowError] = useState(null);
      const [copied, setCopied] = useState(false);
      const [, refreshConfirmations] = useState(0);
      const queueRef = useRef(queue);
      const editingRef = useRef(editing);
      const busyRef = useRef(false);
      const runningRef = useRef(running);
      const mutableRef = useRef(queueMutable);
      const confirmations = useRef(new Map());
      const editorRef = useRef(null);
      queueRef.current = queue;
      editingRef.current = editing;
      runningRef.current = running;
      mutableRef.current = queueMutable;
      const rowCount = queue.length + pending.length;
      const editingRow = editing === null ? null : queue.find(row => row.id === editing.id);
      const orphaned = editing !== null && !editingRow;

      // An RPC acknowledgement is not a new projection. Keep that row locked
      // until the host actually reflects the action, so stale UI cannot repeat it.
      useEffect(() => {
        let changed = false;
        for (const [id, action] of confirmations.current) {
          const row = queue.find(item => item.id === id);
          if (!row || (action.kind === 'edit' && textOf(row.content) === action.text)) {
            confirmations.current.delete(id);
            changed = true;
          }
        }
        if (changed) refreshConfirmations(value => value + 1);
        if (rowError && !queue.some(row => row.id === rowError.id) && editing?.id !== rowError.id) setRowError(null);
      }, [queue, editing, rowError]);

      if (rowCount === 0 && editing === null) return null;
      const changeEditing = value => {
        editingRef.current = value;
        setEditing(value);
        setCopied(false);
      };
      const fail = (id, kind, message) => {
        setRowError({ id, kind, message });
        try { notify?.('error', message); } catch (_error) { /* inline error remains */ }
      };
      const isLocked = id => busyRef.current || confirmations.current.has(id);
      const runAction = async (row, kind, action, text) => {
        if (!mutableRef.current || isLocked(row.id)) return;
        busyRef.current = true;
        setBusy({ id: row.id, kind });
        setRowError(null);
        try {
          await action();
          const current = queueRef.current.find(item => item.id === row.id);
          if (current && (kind !== 'edit' || textOf(current.content) !== text)) {
            confirmations.current.set(row.id, { kind, text });
          }
          if (kind === 'edit') changeEditing(null);
        } catch (error) {
          const key = kind === 'send' ? 'queue.sendFailed' : kind === 'edit' ? 'queue.editFailed' : 'queue.removeFailed';
          const detail = kind === 'send' && error?.message ? ' · ' + String(error.message) : '';
          fail(row.id, kind, formatT(t, key) + detail);
        } finally {
          busyRef.current = false;
          setBusy(null);
        }
      };
      const sendRow = row => {
        const current = queueRef.current.find(item => item.id === row.id);
        if (!current || editingRef.current !== null || (!runningRef.current && queueRef.current[0]?.id !== row.id)) return;
        return runAction(current, 'send', () => wakeQueue(current.id));
      };
      const removeRow = row => {
        const current = queueRef.current.find(item => item.id === row.id);
        if (!current || editingRef.current !== null) return;
        return runAction(current, 'remove', () => updateQueue(current.id, { kind: 'remove' }));
      };
      const beginEdit = row => {
        const current = queueRef.current.find(item => item.id === row.id);
        if (!current || !mutableRef.current || isLocked(row.id) || editingRef.current !== null
          || attachmentCountOf(current.content) > 0 || textOf(current.content).trim() === '') return;
        const text = textOf(current.content);
        changeEditing({ id: current.id, text, originalText: text });
        setRowError(null);
      };
      const activeQueueIndex = Math.min(activeIndex, Math.max(0, queue.length - 1));
      // Keyboard operation is scoped to the panel itself: the composer keeps
      // Enter, buttons keep their native activation, and typing can never
      // delete a queued message. Tab (or a click on the strip) enters the
      // queue; arrows move the active row; Enter/E/Del act on that row.
      const onPanelKeyDown = event => {
        if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.target !== event.currentTarget) return;
        if (editingRef.current !== null) return;
        // Ctrl/⌘/Alt chords belong to the browser or the Host, never to a
        // destructive queue action; repeat keydowns would delete several rows.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const rows = queueRef.current;
        if (rows.length === 0) return;
        const clamp = value => Math.max(0, Math.min(rows.length - 1, value));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          setActiveIndex(value => {
            const current = clamp(Number.isInteger(value) ? value : 0);
            if (event.key === 'Home') return 0;
            if (event.key === 'End') return rows.length - 1;
            return clamp(current + (event.key === 'ArrowDown' ? 1 : -1));
          });
          return;
        }
        if (event.repeat) return;
        const target = rows[clamp(activeQueueIndex)];
        if (event.key === 'Enter') {
          event.preventDefault();
          if (target) sendRow(target);
        } else if (event.key === 'e' || event.key === 'E') {
          event.preventDefault();
          if (target) beginEdit(target);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          if (target) removeRow(target);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setActiveIndex(0);
          if (event.currentTarget && typeof event.currentTarget.blur === 'function') event.currentTarget.blur();
        }
      };
      const saveEdit = () => {
        const draft = editingRef.current;
        if (!draft || !draft.text.trim() || !mutableRef.current || isLocked(draft.id)) return;
        const row = queueRef.current.find(item => item.id === draft.id);
        if (!row || attachmentCountOf(row.content) > 0 || textOf(row.content) !== draft.originalText) {
          fail(draft.id, 'edit', formatT(t, 'queue.editChanged'));
          return;
        }
        if (draft.text === draft.originalText) { changeEditing(null); return; }
        return runAction(row, 'edit', () => updateQueue(row.id, { kind: 'edit', content: [{ type: 'text', text: draft.text }] }), draft.text);
      };
      const copyEdit = async () => {
        try {
          if (typeof window.navigator?.clipboard?.writeText !== 'function') throw new Error('clipboard unavailable');
          await window.navigator.clipboard.writeText(editingRef.current.text);
          setCopied(true);
        } catch (_error) {
          editorRef.current?.focus();
          editorRef.current?.select();
          fail(editingRef.current.id, 'copy', formatT(t, 'queue.copyFailed'));
        }
      };
      // All row actions are icon-only and share one 28x28 ghost style; the
      // text-and-background variant is reserved for textButton actions.
      const control = (name, label, onClick, options = {}) => h('button', {
        type: 'button', className: 'chat-actions-queue-control' + (name === 'remove' ? ' chat-actions-queue-remove' : '') + (name === 'send' && options.text ? ' chat-actions-queue-send' : ''),
        ['data-chat-actions-queue-' + name]: '', title: options.title || label, 'aria-label': options.title || label,
        ...(options.shortcut ? { 'aria-keyshortcuts': options.shortcut } : {}),
        disabled: options.disabled === true, onClick
      }, options.text ? h('span', { className: 'chat-actions-queue-send-label' }, label) : null, queueIcon(name));
      const textButton = (label, onClick, options = {}) => h('button', {
        type: 'button', onClick, disabled: options.disabled === true, ...options.attributes,
        className: 'chat-actions-queue-control chat-actions-queue-send',
        style: options.quiet ? { background: 'transparent' } : undefined
      }, label);
      const editor = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', minWidth: 0 } },
        orphaned ? h('div', { role: 'status', style: { color: TOKEN_MUTED, lineHeight: '18px' } }, formatT(t, 'queue.editOrphaned')) : null,
        h('textarea', {
          ref: editorRef, value: editing.text, autoFocus: true, rows: 3,
          name: 'chat-actions-queued-message', autoComplete: 'off', 'aria-label': formatT(t, 'queue.edit'),
          disabled: busy !== null,
          onChange: event => changeEditing({ ...editingRef.current, text: event.target.value }),
          onKeyDown: event => {
            if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveEdit(); }
            else if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); changeEditing(null); }
          },
          style: { boxSizing: 'border-box', width: '100%', minWidth: 0, minHeight: '66px', maxHeight: '240px', padding: '7px 9px', resize: 'vertical', borderRadius: '7px', border: TOKEN_BORDER, background: 'var(--dsw-alias-bg-base, transparent)', color: TOKEN_TEXT, font: FONT, lineHeight: '20px' }
        }),
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } },
          h('span', { style: { color: TOKEN_MUTED, fontSize: '11px' } }, formatT(t, orphaned ? 'queue.editKeep' : 'queue.editKeys')),
          h('span', { style: { display: 'inline-flex', gap: '4px' } },
            orphaned ? textButton(formatT(t, copied ? 'queue.copied' : 'queue.copyEdit'), copyEdit, { attributes: { 'data-chat-actions-queue-copy': '' } })
              : textButton(formatT(t, 'queue.save'), saveEdit, { disabled: busy !== null || !queueMutable || !editing.text.trim() || editing.text === editing.originalText, attributes: { 'data-chat-actions-queue-save': '' } }),
            textButton(formatT(t, orphaned ? 'queue.closeEdit' : 'queue.cancel'), () => { if (!busyRef.current) changeEditing(null); }, { quiet: true, disabled: busy !== null, attributes: { 'data-chat-actions-queue-dismiss': '' } })
          )
        )
      );
      const errorView = id => rowError?.id === id ? h('div', {
        role: 'alert', 'data-chat-actions-queue-error': '', style: { color: 'var(--dsw-alias-label-error, #d9534f)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', lineHeight: '18px', overflowWrap: 'anywhere' }
      }, h('span', null, rowError.message), ['remove', 'send'].includes(rowError.kind) ? textButton(formatT(t, 'queue.retry'), () => {
        const row = queueRef.current.find(item => item.id === id);
        if (row) return rowError.kind === 'remove' ? removeRow(row) : sendRow(row);
      }, { quiet: true, disabled: busy !== null || editing !== null || !queueMutable, attributes: { 'data-chat-actions-queue-retry': '' } }) : null) : null;

      const rows = queue.map((row, index) => {
        const text = textOf(row.content);
        const attachments = attachmentCountOf(row.content);
        const blocks = attachmentsOf(row.content);
        const images = blocks.filter(entry => entry.type === 'image');
        const files = blocks.filter(entry => entry.type === 'file');
        const full = expanded === row.id;
        const isEditing = editing?.id === row.id;
        const acknowledged = confirmations.current.get(row.id);
        const operation = busy?.id === row.id ? busy.kind : acknowledged?.kind;
        const shownText = acknowledged?.kind === 'edit' ? acknowledged.text : text;
        const disabled = !queueMutable || busy !== null || editing !== null || !!acknowledged;
        const sendLabel = formatT(t, running ? 'queue.steer' : 'queue.sendNext');
        const isActive = focused && !isEditing && index === activeQueueIndex;
        const canSend = !disabled && (running || index === 0);
        const editTitle = formatT(t, attachments > 0 ? 'queue.attachmentEdit' : editing !== null ? 'queue.finishEdit' : 'queue.edit');
        const sendTitle = formatT(t, editing !== null ? 'queue.finishEdit' : running ? 'queue.steerHint' : index === 0 ? 'queue.sendHint' : 'queue.waiting', { n: index });
        return h('div', {
          key: 'q:' + String(row.id), 'data-chat-actions-queue-row': '', 'data-queue-id': String(row.id),
          'data-queue-active': isActive ? 'true' : undefined,
          'aria-busy': operation ? 'true' : 'false',
          style: {
            display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flexShrink: 0, padding: '7px 10px',
            borderRadius: '14px',
            background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.10))',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))',
            ...(isActive ? { outline: '1px solid var(--dsw-alias-label-primary, rgba(127,127,127,.55))', outlineOffset: '-1px' } : {})
          }
        }, isEditing ? editor() : h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: 0 } },
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
            h('button', { type: 'button', className: 'chat-actions-queue-text', 'data-chat-actions-queue-preview': '',
              'aria-expanded': full, title: formatT(t, full ? 'queue.collapseMessage' : 'queue.expandMessage'),
              onClick: () => setExpanded(value => value === row.id ? null : row.id)
            }, h('span', { className: full ? 'chat-actions-queue-full' : 'chat-actions-queue-clamp' }, shownText || formatT(t, 'queue.attachments', { n: attachments }))),
            blocks.length ? h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', marginTop: '3px', color: TOKEN_MUTED } },
              (full ? images : images.slice(0, MAX_QUEUE_THUMBS)).map((entry, i) => h(QueueThumb, { key: 'img:' + i, attachment: entry.attachment, loadImage, label: formatT(t, 'queue.image'), onOpen: setPreview })),
              !full && images.length > MAX_QUEUE_THUMBS ? textButton('+' + (images.length - MAX_QUEUE_THUMBS), () => setExpanded(row.id), { quiet: true }) : null,
              (full ? files : files.slice(0, MAX_QUEUE_THUMBS)).map((entry, i) => h('span', { key: 'file:' + i, className: 'chat-actions-queue-file', title: entry.attachment.name || formatT(t, 'queue.file') }, entry.attachment.name || formatT(t, 'queue.file'))),
              !full && files.length > MAX_QUEUE_THUMBS ? textButton('+' + (files.length - MAX_QUEUE_THUMBS), () => setExpanded(row.id), { quiet: true }) : null
            ) : null
          ),
          h('span', { className: 'chat-actions-queue-actions', style: { display: 'inline-flex', alignItems: 'center', flex: 'none', gap: '1px' } },
            control('edit', formatT(t, 'queue.edit'), () => beginEdit(row), {
              disabled: disabled || attachments > 0 || !text.trim(),
              title: editTitle + ' (E)',
              shortcut: !disabled && attachments === 0 && text.trim() ? 'E' : undefined
            }),
            control('remove', formatT(t, 'queue.remove'), () => removeRow(row), {
              disabled,
              title: formatT(t, 'queue.remove') + ' (Del)',
              shortcut: disabled ? undefined : 'Delete'
            }),
            control('send', sendLabel, () => sendRow(row), {
              disabled: disabled || (!running && index !== 0),
              title: sendTitle + (canSend ? ' (Enter)' : ''),
              shortcut: canSend ? 'Enter' : undefined
            })
          )
        ),
          operation ? h('div', { role: 'status', 'aria-live': 'polite', 'data-chat-actions-queue-status': '', style: { color: TOKEN_MUTED, fontSize: '11px' } }, formatT(t, operation === 'edit' ? 'queue.saving' : operation === 'remove' ? 'queue.removing' : running ? 'queue.steering' : 'queue.sending')) : null,
          errorView(row.id)
        );
      });
      for (const item of pending) rows.push(h('div', {
        key: 'p:' + String(item.requestId), 'data-chat-actions-queue-pending': '',
        style: {
          display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexShrink: 0, padding: '7px 10px',
          borderRadius: '14px', color: TOKEN_MUTED,
          background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.10))',
          border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))'
        }
      }, h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.text || formatT(t, 'queue.attachments', { n: (item.attachments || []).length })), h('span', { role: 'status' }, formatT(t, 'queue.admitting'))));
      // A queue claim can race editing. Preserve the unsaved draft even when the
      // last queue row disappears; never silently throw the user's changes away.
      const orphanEditor = orphaned ? h('div', {
        'data-chat-actions-queue-orphan': '',
        style: {
          padding: '7px 10px', borderRadius: '14px',
          background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.10))',
          border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.18))'
        }
      }, editor(), errorView(editing.id)) : null;
      // Default look is just the stacked rounded cards above the composer.
      // A one-line caption appears only when it carries the keyboard mode or
      // the paused-head rule; otherwise it would duplicate composer chrome.
      const contextHint = editing !== null
        ? null
        : focused && queue.length > 0
          ? formatT(t, 'queue.shortcuts')
          : !running && queue.length > 0
            ? formatT(t, 'queue.pausedHint')
            : null;
      return h(React.Fragment, null,
        h('div', {
          'data-chat-actions-queue': '',
          role: 'region',
          tabIndex: queue.length > 0 ? 0 : -1,
          'aria-label': formatT(t, 'queue.count', { n: rowCount }) + ' · ' + formatT(t, 'queue.shortcutHelp'),
          onKeyDown: onPanelKeyDown,
          // Shortcuts only belong to the strip itself. Focusing a child button
          // keeps that button's native Enter/Space behaviour, so the hint must
          // not claim a keyboard mode that is inactive.
          onFocus: event => { if (event.target === event.currentTarget) setFocused(true); },
          onBlur: event => { if (event.target === event.currentTarget) setFocused(false); },
          style: {
            boxSizing: 'border-box', minWidth: 0,
            width: 'calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px))',
            maxWidth: 'var(--dsh-composer-card-max-width, 100%)', marginInline: 'auto',
            display: 'flex', flexDirection: 'column', gap: '5px',
            marginBottom: '6px', font: FONT, color: TOKEN_TEXT
          }
        },
          h('style', null, QUEUE_CSS),
          contextHint ? h('span', {
            'data-chat-actions-queue-hint': '',
            title: formatT(t, focused && queue.length > 0 ? 'queue.shortcutHelp' : 'queue.pausedHint'),
            style: { color: TOKEN_MUTED, fontSize: '11px', lineHeight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          }, contextHint) : null,
          h('div', { 'data-chat-actions-queue-list': '', style: { display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: 'min(340px, 45vh)', overflowY: 'auto', overscrollBehavior: 'contain', minWidth: 0 } }, rows),
          orphanEditor
        ),
        preview === null ? null : h(QueueImagePreview, { image: preview, label: formatT(t, 'queue.image'), onClose: () => setPreview(null) })
      );
    }

    // ------------------------------------------------------------------
    // Sidebar ask panel (requirement 1, second destination)
    // ------------------------------------------------------------------
    // Protocol metadata mirrors side-chat/typert.js; the Host owns strict wire validation.
    // Small client schemas avoid bundling a second copy of Zod into this hand-written entry.
    function sideChatContribution() {
      const schema = (parse) => ({ parse, safeParse: (value) => {
        try { return { success: true, data: parse(value) }; }
        catch (error) { return { success: false, error }; }
      } });
      const text = (limit) => (value) => {
        if (typeof value !== 'string' || !value.length || value.length > limit) throw new Error('Invalid side-chat text');
      };
      const optional = (check) => (value) => { if (value !== undefined) check(value); };
      const object = (fields) => (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).some((key) => !(key in fields))) throw new Error('Invalid side-chat object');
        for (const [key, check] of Object.entries(fields)) check(value[key]);
        return value;
      };
      const id = text(512);
      const seq = (value) => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid context boundary'); };
      const model = object({ provider: id, model: id, reasoningEffort: optional(id) });
      const issue = object({ code: id, message: (value) => { if (typeof value !== 'string') throw new Error('Invalid error'); },
        recoverable: (value) => { if (typeof value !== 'boolean') throw new Error('Invalid error'); } });
      const literal = (expected) => (value) => { if (value !== expected) throw new Error('Invalid side-chat value'); };
      const result = (check) => schema((value) => value?.ok === true
        ? object({ ok: literal(true), value: check })(value)
        : object({ ok: literal(false), error: issue })(value));
      const string = (value) => { if (typeof value !== 'string') throw new Error('Invalid stream content'); };
      const event = schema((value) => {
        const shapes = {
          started: { type: literal('started'), requestId: id, modelSelection: model },
          content: { type: literal('content'), text: string, reasoning: string },
          finished: { type: literal('finished'), status: (status) => {
            if (status !== 'complete' && status !== 'stopped') throw new Error('Invalid completion');
          } },
          error: { type: literal('error'), error: issue }
        };
        if (!shapes[value?.type]) throw new Error('Invalid side-chat event');
        return object(shapes[value.type])(value);
      });
      const chat = schema(object({ chatId: id }));
      const invocation = (method, requestType, resultType, request, response, stream, cancellation) => ({
        id: 'dsh-chat-actions#chatActionsSideChat/' + method,
        service: 'chatActionsSideChat', namespace: 'chatActionsSideChat', method, implementation: method,
        invocation: { kind: 'direct' }, ...(stream ? { mode: 'stream' } : {}),
        ...(cancellation ? { cancellation: { parameter: 'signal' } } : {}),
        parameters: [{ name: 'request', wire: 'request', source: 'json', codec: {
          mode: 'strict', typeSymbol: 'dsh-chat-actions/remote#' + requestType, create: () => request
        } }],
        result: { mode: 'strict', typeSymbol: 'dsh-chat-actions/remote#' + resultType, create: () => response },
        sourceLocation: { file: 'side-chat/host.js', line: 1, column: 1 }
      });
      return { package: 'dsh-chat-actions', descriptors: [
        invocation('create', 'CreateSideChatRequest', 'CreateResult',
          schema(object({ parentSessionId: id, atSeq: seq, selectedText: optional(text(16384)), modelSelection: optional(model) })),
          result(object({ parentSessionId: id, chatId: id, boundarySeq: seq, modelSelection: model })), false, true),
        invocation('selectModel', 'SelectSideChatModelRequest', 'SelectModelResult',
          schema(object({ chatId: id, provider: id, model: id, reasoningEffort: optional(id) })),
          result(object({ selected: model })), false, true),
        invocation('stream', 'SendSideChatRequest', 'SideChatStreamEvent',
          schema(object({ chatId: id, requestId: id, text: text(65536) })), event, true, true),
        invocation('cancel', 'ChatRequest', 'CancelResult', chat, result(object({ cancelled: literal(true) }))),
        invocation('close', 'ChatRequest', 'CloseResult', chat, result(object({ closed: literal(true) })))
      ] };
    }

    // Adapted from dsh-side-chat's controller: admission, cancellation and close
    // are explicit so failed connections cannot silently resubmit an admitted turn.
    function createSideChatController(remoteFactory, publish) {
      let state = { messages: [], busy: false, stopping: false, selecting: false, hasChat: false, modelSelection: null, error: '' };
      let generation = 0;
      let remote, chatId, creating, active, pending, closing, parentSessionId;
      let modelOperation = 0;
      let modelAbort;
      const emit = (patch) => { state = { ...state, ...patch }; publish(state); };
      const updateReply = (requestId, patch) => emit({ messages: state.messages.map((message) =>
        message.id === requestId + ':assistant' ? { ...message, ...patch } : message) });
      const disposeStream = (stream) => {
        try { void Promise.resolve(stream?.dispose?.()).catch(() => {}); }
        catch (_error) { /* explicit close/cancel remains available */ }
      };
      const controller = {
        getSnapshot: () => state,
        async selectModel(selection) {
          if (closing || state.selecting || (state.busy && !chatId)) return false;
          const current = generation;
          const operation = ++modelOperation;
          const targetId = chatId;
          modelAbort?.abort();
          const abort = new AbortController();
          modelAbort = abort;
          emit({ selecting: true, error: '' });
          try {
            let selected = selection;
            if (targetId) {
              const endpoint = await remoteFactory();
              if (current !== generation || operation !== modelOperation) return false;
              remote = endpoint;
              const result = await endpoint.selectModel({ chatId: targetId, ...selection }, abort.signal);
              selected = result.selected;
            }
            if (current !== generation || operation !== modelOperation) return false;
            emit({ modelSelection: selected });
            return true;
          } catch (error) {
            if (current === generation && operation === modelOperation) emit({ error: String(error?.message || error) });
            return false;
          } finally {
            if (current === generation && operation === modelOperation) emit({ selecting: false });
          }
        },
        async send(context, text, onAdmitted) {
          if (state.busy || state.stopping || state.selecting || closing) return;
          const question = text.trim();
          if (!question) return;
          const current = generation;
          const abort = new AbortController();
          active = { abort, cancelled: false };
          const flight = active;
          const isCurrent = () => current === generation && active === flight;
          emit({ busy: true, error: '' });
          let admitted = false;
          const request = pending?.text === question ? pending : { requestId: newRequestId(), text: question };
          flight.requestId = request.requestId;
          pending = request;
          try {
            const endpoint = await remoteFactory();
            if (!isCurrent()) return;
            remote = endpoint;
            if (chatId && context?.parentSessionId !== parentSessionId) throw new Error('Close the previous Side Chat before changing parent conversations.');
            if (!chatId) {
              if (!Number.isSafeInteger(context?.atSeq)) throw new Error('Select a message from a completed turn.');
              creating = remote.create({ ...context, ...(state.modelSelection ? { modelSelection: state.modelSelection } : {}) }, abort.signal);
              flight.creating = creating;
              const created = await creating;
              if (!isCurrent()) {
                // Close a late create even if a carrier ignored our abort.
                if (flight.cancelled) void remote.close({ chatId: created.chatId }).catch(() => {});
                return;
              }
              chatId = created.chatId;
              parentSessionId = context.parentSessionId;
              creating = null;
              emit({ hasChat: true, modelSelection: created.modelSelection });
            }
            abort.signal.throwIfAborted();
            const stream = remote.stream({ chatId, ...request }, abort.signal);
            flight.stream = stream;
            let terminal = false;
            for await (const event of stream) {
              if (!isCurrent()) break;
              if (event.type === 'started') {
                if (admitted || event.requestId !== request.requestId) throw new Error('Invalid Side Chat admission.');
                admitted = true;
                pending = null;
                emit({ messages: [...state.messages,
                  { id: request.requestId + ':user', role: 'user', text: question, status: 'complete',
                    selectedText: state.messages.length ? undefined : context.selectedText },
                  { id: request.requestId + ':assistant', role: 'assistant', text: '', reasoning: '', status: 'streaming', modelSelection: event.modelSelection }
                ] });
                onAdmitted?.();
              } else if (event.type === 'content' && admitted) {
                updateReply(request.requestId, { text: event.text, reasoning: event.reasoning });
              } else if (event.type === 'finished' && admitted) {
                terminal = true;
                updateReply(request.requestId, { status: event.status });
                break;
              } else if (event.type === 'error') {
                terminal = true;
                throw new Error(event.error.message);
              } else throw new Error('Invalid Side Chat stream response.');
            }
            if (isCurrent() && !terminal && !flight.cancelled) throw new Error('The connection ended before the reply completed.');
          } catch (error) {
            if (isCurrent()) {
              if (admitted) updateReply(request.requestId, { status: flight.cancelled ? 'stopped' : 'error' });
              emit({ error: flight.cancelled ? '' : String(error?.message || error) });
            }
          } finally {
            disposeStream(flight.stream);
            if (isCurrent()) {
              if (flight.cancelled && admitted) updateReply(request.requestId, { status: 'stopped' });
              active = null;
              emit({ busy: false });
            }
          }
        },
        async stop() {
          const flight = active;
          if (!flight) return;
          const current = generation;
          flight.cancelled = true;
          active = null;
          if (creating === flight.creating) creating = null;
          pending = null;
          updateReply(flight.requestId, { status: 'stopped' });
          emit({ busy: false, stopping: true, error: '' });
          flight.abort.abort();
          disposeStream(flight.stream);
          try { if (remote && chatId) await remote.cancel({ chatId }); }
          catch (error) { if (current === generation) emit({ error: String(error?.message || error) }); }
          finally { if (current === generation) emit({ stopping: false }); }
        },
        close() {
          if (closing) return closing;
          ++generation;
          ++modelOperation;
          modelAbort?.abort();
          active?.abort.abort();
          disposeStream(active?.stream);
          const id = chatId;
          const pendingCreate = creating;
          closing = Promise.resolve().then(async () => {
            const late = pendingCreate ? await pendingCreate.catch(() => null) : null;
            const target = id || late?.chatId;
            try {
              if (remote && target) await remote.close({ chatId: target });
            } catch (error) {
              chatId = target;
              emit({ busy: false, stopping: false, selecting: false, error: String(error?.message || error) });
              throw error;
            }
            chatId = null; creating = null; active = null; pending = null; parentSessionId = null;
            emit({ messages: [], busy: false, stopping: false, selecting: false, hasChat: false, modelSelection: null, error: '' });
          }).finally(() => { closing = null; });
          return closing;
        }
      };
      return controller;
    }

    function AskPanel(props) {
      const { useTabInfo, sideChatRemote, insertDiscussion, contextFor, modelDirectory, t } = props;
      const params = useTabInfo?.()?.tab?.navigation?.params || {};
      const quoted = typeof params.text === 'string' ? params.text : '';
      const parentId = params.sessionId || props.sessionId;
      const quoteKey = params.selectionId || quoted;
      const [question, setQuestion] = useState('');
      const [state, setState] = useState({ messages: [], busy: false, stopping: false, selecting: false, hasChat: false, modelSelection: null, error: '' });
      const [notice, setNotice] = useState('');
      const [catalog, setCatalog] = useState({ groups: [], status: 'loading', error: null, failures: [] });
      const [catalogError, setCatalogError] = useState('');
      const owner = useRef({ alive: true, controller: null, context: null, parentId, quoteKey, discussionId: newRequestId() });
      const log = useRef(null);
      const followOutput = useRef(true);
      if (!owner.current.controller) owner.current.controller = createSideChatController(sideChatRemote, (value) => {
        if (owner.current.alive) setState(value);
      });
      const controller = owner.current.controller;
      const reloadModels = async () => {
        const directory = owner.current.directory;
        if (!directory) return;
        setCatalogError('');
        try { await directory.load(); }
        catch (error) {
          if (owner.current.alive && owner.current.directory === directory) setCatalogError(String(error?.message || error));
        }
      };
      useEffect(() => {
        owner.current.alive = true;
        return () => { owner.current.alive = false; void controller.close().catch(() => {}); };
      }, []);
      useEffect(() => {
        let directory;
        try { directory = modelDirectory?.(parentId); }
        catch (error) { setCatalogError(String(error?.message || error)); }
        owner.current.directory = directory;
        if (!directory?.store) {
          setCatalog({ groups: [], status: 'ready', error: null, failures: [] });
          setCatalogError(formatT(t, 'ask.modelsUnavailable'));
          return;
        }
        const update = () => { if (owner.current.alive) setCatalog(directory.store.getSnapshot()); };
        update();
        const unsubscribe = directory.store.subscribe(update);
        void reloadModels();
        return () => {
          unsubscribe?.();
          if (owner.current.directory === directory) owner.current.directory = null;
        };
      }, [modelDirectory, parentId]);
      useEffect(() => {
        const current = owner.current;
        if (current.parentId !== parentId) {
          current.parentId = parentId;
          current.context = null;
          current.discussionId = newRequestId();
          setQuestion('');
          setNotice('');
          void controller.close().catch((error) => setNotice(String(error?.message || error)));
        } else if (current.quoteKey !== quoteKey && controller.getSnapshot().messages.length) {
          setQuestion((value) => value + (value ? '\n\n' : '') + quoteFrame(quotePayloadOf(quoted)));
        }
        current.quoteKey = quoteKey;
        if (!controller.getSnapshot().messages.length) current.context = null;
      }, [parentId, quoteKey]);
      useEffect(() => {
        if (followOutput.current && log.current) log.current.scrollTop = log.current.scrollHeight;
      }, [state.messages]);
      const send = async () => {
        const draft = question;
        const asked = draft.trim() || (state.messages.length ? '' : formatT(t, 'ask.defaultQuestion'));
        if (!asked) return;
        setNotice('');
        if (!owner.current.context) {
          try { owner.current.context = contextFor(parentId, params.origin, quoted); }
          catch (error) { setNotice(String(error?.message || error)); return; }
        }
        followOutput.current = true;
        await controller.send(owner.current.context, asked, () => setQuestion((value) => value === draft ? '' : value));
      };
      const add = () => {
        const text = state.messages.filter((message) => message.text).map((message) =>
          (message.selectedText ? '[选中的内容]\n' + message.selectedText + '\n\n' : '')
          + (message.role === 'user' ? '用户：' : '助手：') + message.text).join('\n\n');
        setNotice(insertDiscussion(parentId, text, owner.current.discussionId) ? formatT(t, 'ask.added') : formatT(t, 'tools.quoteFailed'));
      };
      // Read the parent catalog only. directory.select() would change the main conversation.
      const choices = (catalog.groups || []).flatMap((group) => group.models.map((model) => ({
        group, model, key: JSON.stringify([group.id, model.id])
      })));
      const selection = state.modelSelection;
      const selectedKey = selection ? JSON.stringify([selection.provider, selection.model]) : '';
      const choice = choices.find((item) => item.key === selectedKey);
      const reasoning = choice?.model.reasoning;
      const locked = state.selecting || state.stopping || (state.busy && !state.hasChat);
      const modelIssue = catalogError || catalog.error || (catalog.failures || []).map((failure) => failure.name + ': ' + failure.message).join('; ');
      const controlStyle = { minWidth: 0, width: '100%', boxSizing: 'border-box', minHeight: '32px', padding: '4px 8px',
        border: TOKEN_BORDER, borderRadius: '7px', background: TOKEN_BG, color: TOKEN_TEXT, font: FONT };
      const buttonStyle = { font: FONT, minHeight: '32px', padding: '4px 10px', borderRadius: '7px',
        border: TOKEN_BORDER, background: TOKEN_HOVER, color: TOKEN_TEXT };
      return h('div', { 'data-chat-actions-ask': '', style: {
        display: 'flex', flexDirection: 'column', gap: '10px', height: '100%', minHeight: 0,
        minWidth: 0, overflow: 'hidden', boxSizing: 'border-box', padding: '12px', color: TOKEN_TEXT, font: FONT
      } },
        h('style', null, `
          [data-chat-actions-ask] button { cursor: pointer; }
          [data-chat-actions-ask] :is(button, select):disabled { opacity: .5; cursor: not-allowed; }
          [data-chat-actions-ask] :is(button, select):not(:disabled):hover { border-color: currentColor; }
          [data-chat-actions-ask] :is(button, select, textarea):focus-visible { outline: 2px solid var(--dsw-alias-label-primary, currentColor); outline-offset: 2px; }
          [data-chat-actions-ask] [data-side-chat-message], [data-chat-actions-ask] [data-side-chat-message] > * { min-width: 0; max-width: 100%; box-sizing: border-box; }
          [data-chat-actions-ask] [data-side-chat-message] :is(pre, table) { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; }
          [data-chat-actions-ask] [data-side-chat-message] pre { white-space: pre; }
          [data-chat-actions-ask] [data-side-chat-message] table { display: block; }
          [data-chat-actions-ask] [data-side-chat-message] :is(img, video) { max-width: 100%; height: auto; }
        `),
        h('div', { style: { color: TOKEN_MUTED, fontSize: '12px', flexShrink: 0 } }, formatT(t, 'ask.readOnly')),
        h('details', { open: !state.messages.length, style: { flexShrink: 0, maxHeight: '30%', overflow: 'auto' } },
          h('summary', { style: { cursor: 'pointer' } }, formatT(t, 'ask.quoteLabel')),
          h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '8px', border: TOKEN_BORDER, borderRadius: '8px' } }, quoted)),
        h('div', { ref: log, role: 'log', 'aria-label': formatT(t, 'ask.title'), 'aria-live': 'off',
          onScroll: (event) => {
            const element = event.currentTarget;
            followOutput.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 1;
          },
          style: { flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, minWidth: 0, overscrollBehavior: 'contain', overflowWrap: 'anywhere' } },
          state.messages.map((message) => h('article', { key: message.id, 'data-role': message.role, 'data-side-chat-message': '', style: { marginBottom: '16px' } },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: TOKEN_MUTED, marginBottom: '4px' } },
              formatT(t, message.role === 'user' ? 'ask.user' : 'ask.assistant'),
              message.modelSelection ? h('span', null, message.modelSelection.model) : null),
            message.selectedText ? h('details', null, h('summary', { style: { cursor: 'pointer', color: TOKEN_MUTED } }, formatT(t, 'ask.quoteLabel')),
              h('div', { style: { whiteSpace: 'pre-wrap' } }, message.selectedText)) : null,
            message.reasoning ? h('details', null, h('summary', { style: { cursor: 'pointer', color: TOKEN_MUTED } }, formatT(t, 'ask.reasoning')),
              h('div', { style: { whiteSpace: 'pre-wrap' } }, message.reasoning)) : null,
            message.role === 'assistant' ? h(MarkdownText, { text: message.text, streaming: message.status === 'streaming',
              labels: { code: { copyLabel: formatT(t, 'ask.copy'), copiedLabel: formatT(t, 'ask.copied') }, footnotes: formatT(t, 'ask.footnotes') } })
              : h('div', { style: { whiteSpace: 'pre-wrap' } }, message.text),
            message.status === 'stopped' ? h('div', { style: { color: TOKEN_MUTED } }, formatT(t, 'ask.stopped')) : null))),
        h('div', { 'data-side-chat-composer': '', style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0, flexShrink: 0, borderTop: TOKEN_BORDER, paddingTop: '10px' } },
          h('textarea', { value: question, name: 'chat-actions-side-question', autoComplete: 'off', rows: 3,
            'aria-label': formatT(t, 'ask.questionPlaceholder'), placeholder: formatT(t, 'ask.questionPlaceholder'),
            onChange: (event) => setQuestion(event.target.value),
            onKeyDown: (event) => {
              if (event.isComposing || event.nativeEvent?.isComposing) return;
              if (event.key === 'Escape' && state.busy) {
                event.preventDefault(); event.stopPropagation(); return controller.stop();
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault(); if (!state.busy && !state.stopping && !state.selecting) return send();
              }
            },
            style: { ...controlStyle, minHeight: '62px', maxHeight: '160px', padding: '8px', resize: 'vertical' }
          }),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: '8px', minWidth: 0 } },
            h('label', { style: { flex: '1 1 160px', minWidth: 0, color: TOKEN_MUTED } },
              h('span', { style: { display: 'block', marginBottom: '4px' } }, formatT(t, 'ask.model')),
              h('select', { name: 'chat-actions-side-model', value: selectedKey, disabled: locked || !choices.length, style: controlStyle,
                onChange: (event) => {
                  const next = choices.find((item) => item.key === event.target.value);
                  if (next) return controller.selectModel({ provider: next.group.id, model: next.model.id,
                    ...(next.model.reasoning?.defaultEffort ? { reasoningEffort: next.model.reasoning.defaultEffort } : {}) });
                }
              },
                h('option', { value: '', disabled: !!selection }, formatT(t, catalog.status === 'loading' && !choices.length ? 'ask.modelsLoading' : 'ask.inheritModel')),
                selection && !choice ? h('option', { value: selectedKey, disabled: true }, selection.model) : null,
                (catalog.groups || []).map((group) => h('optgroup', { key: group.id, label: group.name || group.id },
                  group.models.map((model) => h('option', { key: model.id, value: JSON.stringify([group.id, model.id]) }, model.name || model.id)))))),
            reasoning?.efforts?.length ? h('label', { style: { flex: '0 1 120px', minWidth: 0, color: TOKEN_MUTED } },
              h('span', { style: { display: 'block', marginBottom: '4px' } }, formatT(t, 'ask.effort')),
              h('select', { name: 'chat-actions-side-effort', value: selection.reasoningEffort ?? reasoning.defaultEffort ?? '', disabled: locked, style: controlStyle,
                onChange: (event) => controller.selectModel({ provider: selection.provider, model: selection.model,
                  ...(event.target.value ? { reasoningEffort: event.target.value } : {}) })
              },
                !reasoning.defaultEffort ? h('option', { value: '' }, formatT(t, 'ask.defaultEffort')) : null,
                reasoning.efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, effort.name || effort.id)))) : null),
          modelIssue || (!choices.length && catalog.status === 'ready') ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', color: TOKEN_MUTED } },
            h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, String(modelIssue || formatT(t, 'ask.modelsUnavailable'))),
            h('button', { type: 'button', onClick: reloadModels, style: buttonStyle }, formatT(t, 'ask.reloadModels'))) : null,
          h('div', { style: { color: TOKEN_MUTED, fontSize: '11px' } }, formatT(t, 'ask.nextModel')),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
            h('button', { type: 'button', disabled: state.stopping || (state.selecting && !state.busy), onClick: state.busy ? () => controller.stop() : send,
              title: formatT(t, state.busy ? 'ask.stopHint' : 'ask.send'), style: { ...buttonStyle, fontWeight: 600 },
              'aria-busy': state.stopping
            }, formatT(t, state.stopping ? 'ask.stopping' : state.busy ? 'ask.stop' : 'ask.send')),
            h('button', { type: 'button', disabled: state.busy || state.stopping || !state.messages.some((message) => message.role === 'assistant' && message.text),
              onClick: add, style: buttonStyle }, formatT(t, 'tools.addToComposer')),
            h('button', { type: 'button', disabled: state.busy || state.stopping || state.selecting, onClick: async () => {
              try { await controller.close(); owner.current.context = null; owner.current.discussionId = newRequestId(); setNotice(''); }
              catch (error) { setNotice(String(error?.message || error)); }
            }, style: buttonStyle }, formatT(t, 'ask.new'))),
          h('div', { role: 'status', 'aria-live': 'polite', style: { minHeight: '18px', overflowWrap: 'anywhere',
            color: state.error ? 'var(--dsw-alias-label-error, #d9534f)' : TOKEN_MUTED } },
            state.error || notice || (state.stopping ? formatT(t, 'ask.stopping') : state.selecting ? formatT(t, 'ask.modelChanging') : state.busy ? formatT(t, 'ask.generating') : ''))
        )
      );
    }

    // ------------------------------------------------------------------
    /** Successful model choices, independent of the slider's UI and package. */
    function createEffortMemory(storage) {
      const key = 'dsh-chat-actions.reasoning-efforts';
      let saved = new Map();
      try {
        const value = JSON.parse(storage?.getItem(key) ?? '{}');
        if (value && typeof value === 'object' && !Array.isArray(value))
          saved = new Map(Object.entries(value).filter(([, level]) => typeof level === 'string' && level));
      } catch (_error) { /* unavailable or corrupt browser storage */ }
      const attached = new Map();
      const versions = new Map();
      const identity = (selection) => JSON.stringify([selection.provider, selection.model]);
      const reasoningOf = (directory, selection) => directory.store.getSnapshot().groups
        ?.find(group => group.id === selection.provider)?.models
        ?.find(model => model.id === selection.model)?.reasoning;
      const supports = (reasoning, level) => typeof level === 'string'
        && Array.isArray(reasoning?.efforts) && reasoning.efforts.some(effort => effort.id === level);
      const remember = (selection, level) => {
        const id = identity(selection);
        if (saved.get(id) === level) return;
        saved.set(id, level);
        try { storage?.setItem(key, JSON.stringify(Object.fromEntries(saved))); }
        catch (_error) { /* keep this page's memory when persistence is blocked */ }
      };
      return {
        attach(directory) {
          if (!directory?.store?.getSnapshot || typeof directory.select !== 'function') return () => {};
          let owner = attached.get(directory);
          if (!owner) {
            const original = directory.select;
            owner = { count: 0, active: true, generation: 0, original, seed: true };
            const seed = () => {
              if (!owner.active || !owner.seed) return;
              const state = directory.store.getSnapshot();
              const current = state.current;
              if (state.status !== 'ready' || state.pending || !current
                || !supports(reasoningOf(directory, current), current.reasoningEffort)) return;
              if (!saved.has(identity(current))) remember(current, current.reasoningEffort);
              owner.seed = false;
            };
            owner.unsubscribe = directory.store.subscribe?.(seed);
            seed();
            const wrapped = async function (selection) {
              if (!owner.active || !selection || typeof selection.provider !== 'string' || typeof selection.model !== 'string')
                return original.call(this, selection);
              owner.seed = false;
              const before = directory.store.getSnapshot().current;
              const reasoning = reasoningOf(directory, selection);
              const switching = before?.provider !== selection.provider || before?.model !== selection.model;
              const retained = saved.get(identity(selection));
              // Native clicks omit effort; the command menu supplies the target's
              // default. Both restore memory. Explicit non-default choices win.
              const next = switching && supports(reasoning, retained)
                && (selection.reasoningEffort === undefined || selection.reasoningEffort === reasoning.defaultEffort)
                ? { ...selection, reasoningEffort: retained } : selection;
              const mine = ++owner.generation;
              const id = identity(next);
              const version = (versions.get(id) ?? 0) + 1;
              versions.set(id, version);
              const result = await original.call(this, next);
              if (owner.active && mine === owner.generation && version === versions.get(id)
                && result?.ok === true && supports(reasoningOf(directory, next), next.reasoningEffort))
                remember(next, next.reasoningEffort);
              return result;
            };
            owner.wrapped = wrapped;
            directory.select = wrapped;
            attached.set(directory, owner);
          }
          owner.count += 1;
          let released = false;
          return () => {
            if (released) return;
            released = true;
            if (--owner.count > 0) return;
            owner.active = false;
            owner.unsubscribe?.();
            if (directory.select === owner.wrapped) directory.select = owner.original;
            attached.delete(directory);
          };
        },
      };
    }

    // Plugin body
    // ------------------------------------------------------------------
    function apply(ctx) {
      let quoteCodecReady = false;
      const getService = (name) => {
        try {
          const service = ctx.get(name);
          return service === undefined || service === null ? undefined : service;
        } catch (_error) {
          return undefined;
        }
      };

      const sessions = () => getService('sessions');

      /** The UI conversation service resolves a durable attachment to a URL.
       *  Resolved lazily: queued-image thumbnails must work even when the
       *  service lands after this plugin. */
      const loadImageFor = (sessionId, attachment) => {
        const uiConversation = getService('uiConversation');
        if (!uiConversation || typeof uiConversation.imageUrl !== 'function') {
          return Promise.reject(new Error('uiConversation.imageUrl unavailable'));
        }
        return uiConversation.imageUrl(sessionId, attachment);
      };

      const bindingOf = (sessionId) => {
        const service = sessions();
        if (!service || typeof service.binding !== 'function') return undefined;
        try { return service.binding(sessionId); } catch (_error) { return undefined; }
      };

      const conversationOf = (sessionId) => {
        const service = sessions();
        if (!service || typeof service.scope !== 'function') return undefined;
        try {
          const scope = service.scope(sessionId);
          if (scope === undefined) return undefined;
          return scope.get('conversation');
        } catch (_error) {
          return undefined;
        }
      };

      const sessionOf = (sessionId) => {
        const binding = bindingOf(sessionId);
        return binding && binding.session ? binding.session : undefined;
      };

      /**
       * Deliver one prompt exactly the way the composer does: register a
       * submission, then `prompt(content, mode, signal, requestId)`.
       *
       * `beginSubmission` is not cosmetic — the composer always pairs it with
       * the prompt, and mode `queue` is what makes the host append the message
       * to `next-turn` and WAKE the driver, which is how a paused conversation
       * starts its next turn.
       */
      const sendAsPrompt = async (sessionId, text, mode, requestId) => {
        const session = sessionOf(sessionId);
        if (!session || typeof session.prompt !== 'function') {
          console.warn('[chat-actions] send: no session facade for', sessionId);
          throw new Error('session-not-attached');
        }
        const resolvedMode = mode || 'queue';
        let handle;
        if (typeof session.beginSubmission === 'function') {
          try {
            handle = session.beginSubmission({
              mode: resolvedMode,
              text,
              attachments: [],
              onRetire: () => {}
            });
          } catch (error) {
            console.warn('[chat-actions] beginSubmission failed (continuing):', error);
            handle = undefined;
          }
        }
        const id = (handle && handle.requestId) || requestId || newRequestId();
        try {
          const result = await session.prompt([{ type: 'text', text }], resolvedMode, undefined, id);
          if (!result || result.ok !== true) throw new Error(result?.error?.message || result?.error?.code || 'prompt-failed');
          return id;
        } catch (error) {
          try { if (handle && typeof handle.abandon === 'function') handle.abandon(); } catch (_error) { /* ignore */ }
          throw error;
        }
      };

      /**
       * Continue from the event before the edited message.
       *
       * The host log is append-only, so "edit and regenerate" has no in-place
       * form: the only losing move is a fork whose inherited prefix stops just
       * before that prompt. `atSeq` is inclusive, so `seq - 1` excludes it —
       * cutting later (before `turn/start`) would inherit the prompt's inbox
       * splice without its removal and leave a stale queued message.
       *
       * To keep the session list to one entry, the pre-edit branch is archived
       * after the edit lands (recoverable from the archive), and the child keeps
       * the original title instead of gaining a "(1)" suffix.
       */
      const replaceEditedMessage = async (sessionId, text, source) => {
        const atSeq = editCutSeq(bindingOf(sessionId), source && source.key);
        const service = sessions();
        if (!service || typeof service.fork !== 'function') throw new Error('edit-source-unavailable');
        const workspace = getService('uiWorkspace');
        if (!workspace || typeof workspace.openSession !== 'function') throw new Error('edit-fork-failed');
        const childId = await service.fork({ sessionId, atSeq });
        if (typeof childId !== 'string' || childId === '' || childId === sessionId) throw new Error('edit-fork-failed');
        // Retain the child so it has a binding to send into without first
        // switching the view: a failed send must leave the user where they were.
        const reference = typeof service.retain === 'function'
          ? service.retain(childId, { source: 'controllerOperation' })
          : undefined;
        try {
          const requestId = await sendAsPrompt(childId, text, 'queue');
          workspace.openSession(childId);
          if (typeof workspace.archiveSession === 'function') {
            try { await workspace.archiveSession(sessionId, { stopActivity: true }); }
            catch (error) { try { console.warn('[chat-actions] pre-edit branch not archived', error); } catch (_e) { /* ignore */ } }
          }
          return requestId;
        } finally {
          try { reference?.release(); } catch (_error) { /* ignore */ }
        }
      };

      /**
       * Resolve the Agent-scoped Context for a session. Hosts differ: newer
       * ones expose it as `binding(id).ctx`, older ones return it from
       * `scope(id)`. Try both (dsh-quote-followup does the same).
       */
      const scopeOf = (sessionId) => {
        const service = sessions();
        if (!service) return undefined;
        try {
          if (typeof service.binding === 'function') {
            const binding = service.binding(sessionId);
            if (binding && binding.ctx) return binding.ctx;
          }
        } catch (_error) { /* fall through */ }
        try {
          if (typeof service.scope === 'function') return service.scope(sessionId);
        } catch (_error) { /* fall through */ }
        return undefined;
      };

      /**
       * Insert a compact quote chip at the caret (or at the draft end).
       * The chip carries the excerpt plus the full text in its ref; the codec
       * below expands that ref into a Markdown blockquote when the message is
       * sent, so the composer stays small but the model still sees everything.
       */
      const insertQuote = (sessionId, text, span, origin) => {
        // Never create a chip that the submit path cannot serialize.
        if (!quoteCodecReady) return false;
        const scope = scopeOf(sessionId);
        if (scope === undefined) return false;
        let conversation;
        try {
          conversation = typeof scope.get === 'function' ? scope.get('conversation') : undefined;
        } catch (_error) { conversation = undefined; }
        if (!conversation) {
          try {
            const binding = bindingOf(sessionId);
            const bctx = binding && binding.ctx;
            conversation = bctx && typeof bctx.get === 'function' ? bctx.get('conversation') : undefined;
          } catch (_error) { conversation = undefined; }
        }
        if (!conversation || !conversation.input || typeof conversation.input.for !== 'function') return false;
        let input;
        try { input = conversation.input.for(scope); } catch (_error) { return false; }
        const state = input && input.state && typeof input.state.getSnapshot === 'function'
          ? input.state.getSnapshot()
          : undefined;
        if (!state || typeof state.draftRev !== 'number' || typeof input.insertReference !== 'function') return false;
        if (state.phase !== 'plain' && state.phase !== 'claimed') return false;
        // A live selection in the transcript makes the editor reject the
        // insertion as an edit to a non-plain composer; clear it first.
        try { if (window.getSelection) window.getSelection().removeAllRanges(); } catch (_error) { /* ignore */ }
        const payload = quotePayloadOf(text, origin);
        const reference = {
          source: QUOTE_SOURCE,
          ref: JSON.stringify(payload),
          label: quoteLabelOf(payload.text),
          appearance: 'session',
          clipboardText: quoteFrame(payload)
        };
        const attempt = (candidate) => {
          if (!candidate || typeof candidate.start !== 'number' || typeof candidate.end !== 'number') return false;
          // Do NOT require the caller's rev here: the caller captured the span
          // before this call and the editor may have re-projected in between.
          // The shell's own insertReference re-checks rev and returns false.
          if (typeof candidate.draftRev === 'number' && candidate.draftRev > state.draftRev) return false;
          try {
            const inserted = input.insertReference(reference, {
              start: candidate.start,
              end: candidate.end,
              draftRev: state.draftRev
            });
            if (inserted && typeof input.focus === 'function') input.focus();
            return inserted === true;
          } catch (error) {
            try { console.warn('[chat-actions] insertReference threw', error); } catch (_e) { /* ignore */ }
            return false;
          }
        };
        // Prefer the draft end (the pattern dsh-quote-followup uses): detect
        // offsets differ from clipboard lengths when the draft holds chips, so
        // subtract one extra unit per existing occurrence.
        const extra = (state.occurrences || []).reduce(
          (sum, occurrence) => sum + Math.max(0, (occurrence && occurrence.length ? occurrence.length : 1) - 1),
          0
        );
        const end = typeof state.draft === 'string' ? state.draft.length - extra : NaN;
        if (Number.isSafeInteger(end) && end >= 0 && attempt({ start: end, end, draftRev: state.draftRev })) return true;
        const viaSpan = attempt(span);
        if (!viaSpan) {
          try {
            console.warn('[chat-actions] quote chip rejected', {
              phase: state.phase,
              draftRev: state.draftRev,
              draftLen: typeof state.draft === 'string' ? state.draft.length : null,
              computedEnd: end,
              hasInsertReference: typeof input.insertReference === 'function',
              span: span || null
            });
          } catch (_e) { /* ignore */ }
        }
        return viaSpan;
      };

      const updateQuote = (sessionId, reference, text, revision, origin) => {
        try {
          const scope = scopeOf(sessionId);
          const shell = scope?.get('conversation')?.input?.for(scope);
          const state = shell?.state.getSnapshot();
          if (!state || state.draftRev !== revision || !['plain', 'claimed'].includes(state.phase)) return false;
          const draft = replaceQuote(shell.draftSnapshot, reference, text, origin);
          if (!draft) return false;
          shell.setDraft(draft);
          shell.focus();
          return true;
        } catch (_error) { return false; }
      };

      let remotePromise;
      let unmountRemote;
      let remoteDisposed = false;
      const sideChatRemote = () => {
        if (remoteDisposed) return Promise.reject(new Error('Side Chat is unloading.'));
        if (!remotePromise) remotePromise = (async () => {
          const transport = getService('remote');
          if (!transport?.$mount) throw new Error('Side Chat transport unavailable. Restart DSH after updating the plugin.');
          const dispose = await transport.$mount(sideChatContribution());
          if (remoteDisposed) { await dispose(); throw new Error('Side Chat is unloading.'); }
          unmountRemote = dispose;
          const rpc = getService('remote.chatActionsSideChat');
          if (!rpc) throw new Error('Side Chat service unavailable. Restart DSH after updating the plugin.');
          const unwrap = async (operation) => {
            const envelope = await operation;
            if (envelope?.ok !== true) throw new Error(envelope?.error?.message || 'Side Chat transport failed.');
            const result = envelope.value;
            if (result?.ok !== true) throw new Error(result?.error?.message || 'Side Chat request failed.');
            return result.value;
          };
          return {
            create: (request, signal) => unwrap(rpc.create(request, signal)),
            selectModel: (request, signal) => unwrap(rpc.selectModel(request, signal)),
            stream: (request, signal) => rpc.stream(request, signal),
            cancel: (request) => unwrap(rpc.cancel(request)),
            close: (request) => unwrap(rpc.close(request))
          };
        })().catch(async (error) => {
          await unmountRemote?.();
          unmountRemote = null;
          remotePromise = null;
          throw error;
        });
        return remotePromise;
      };
      ctx.effect(() => () => {
        remoteDisposed = true;
        void remotePromise?.then(() => unmountRemote?.()).catch(() => {});
      }, 'chat-actions: side-chat transport');

      const contextFor = (parentId, origin, selectedText) => {
        if (!parentId || !origin?.key || origin.sessionId !== parentId) {
          throw new Error(formatT(t, 'ask.contextUnavailable'));
        }
        const conversation = getService('uiConversation')?.binding(parentId);
        conversation?.activate('chat');
        const node = conversation?.target('chat')?.getSnapshot()?.nodes?.get(origin.key);
        const location = node?.location;
        const settled = location?.turn?.status === 'closed'
          && (location.kind === 'turn' || (location.kind === 'step' && location.step?.status === 'closed'));
        if (!node || node.visibility !== 'visible' || !settled || !Number.isSafeInteger(node.anchorSeq)) {
          throw new Error(formatT(t, 'ask.contextUnavailable'));
        }
        return { parentSessionId: parentId, atSeq: node.anchorSeq, selectedText };
      };
      const insertDiscussion = (parentId, text, discussionId) => {
        try {
          const conversation = conversationOf(parentId);
          const scope = scopeOf(parentId);
          const shell = scope && conversation?.input?.for(scope);
          const origin = { sessionId: parentId, sideChatId: discussionId };
          const reference = shell?.draftSnapshot?.references?.find((item) => {
            try { return item.source === QUOTE_SOURCE && JSON.parse(item.ref).origin?.sideChatId === discussionId; }
            catch (_error) { return false; }
          });
          return reference ? updateQuote(parentId, reference, text, shell.state.getSnapshot().draftRev, origin)
            : insertQuote(parentId, text, undefined, origin);
        } catch (_error) { return false; }
      };

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-actions: dictionaries');
      try { console.info('[chat-actions] loaded build', BUILD); } catch (_error) { /* ignore */ }
      const t = ctx.locale.bind(NS);
      const effortMemory = createEffortMemory(browserStorage);
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config', key: 'dsh-chat-actions', locale: NS,
        inject: () => ({ t }),
      }, props => h(ChatActionsSettings, { ...props, t })));
      ctx.inject(['modelDirectories'], (scope) => {
        const directories = scope.modelDirectories;
        scope.slots.inject('conversation.input.right', () => scope.slots.register({
          name: 'conversation.input.right', id: 'chat-actions-effort-memory',
          inject: (sessionId) => {
            let directory;
            try { directory = directories.directoryFor(sessionId); } catch (_error) { /* unavailable session */ }
            return { directory, memory: effortMemory };
          },
        }, EffortMemorySeat));
      });

      // Own the codec for the service's lifetime, not just its startup state.
      // Cordis re-enters this injection when the service arrives or is replaced;
      // the stable source name also restores serialization for existing chips.
      ctx.inject(['inputTriggers'], (scope) => {
        scope.effect(() => {
          const inputTriggers = scope.inputTriggers;
          if (!inputTriggers || typeof inputTriggers.registerSource !== 'function') return () => {};
          try {
            const unregister = inputTriggers.registerSource({
              trigger: '@',
              name: QUOTE_SOURCE,
              order: 1000,
              candidates: () => Promise.resolve([]),
              onPick: () => undefined,
              codec: {
                clipboardText: quoteProject,
                serialize: (ref) => Promise.resolve(quoteProject(ref))
              }
            });
            quoteCodecReady = true;
            return () => {
              quoteCodecReady = false;
              unregister();
            };
          } catch (error) {
            quoteCodecReady = false;
            console.warn('[chat-actions] quote codec registration failed; quote insertion disabled', error);
            return () => {};
          }
        }, 'chat-actions: quote codec');
      });

      // ---- sentinel bookkeeping ------------------------------------------
      // A "send now" wakes the Host with one throwaway prompt so the oldest
      // queued message (attachments included) is claimed natively. The
      // sentinel row must disappear again; this registry lives for the whole
      // plugin lifetime because the paused bar unmounts as soon as the agent
      // starts running.
      const sentinelIds = new Set();          // rpcIds hidden from the bar
      const sentinelSession = new Map();      // rpcId -> sessionId
      const sentinelStarted = new Map();      // rpcId -> startedAt (ms)
      const wakeFlights = new Map();          // sessionId -> in-flight Promise
      const wakeRequested = new Map();        // acknowledged wake awaiting native claim
      const sentinelSubscriptions = new Map();
      const removingSentinels = new Set();
      const WAKE_TTL_MS = 90_000;

      const inboxSnapshotOf = (sessionId) => {
        try {
          const session = sessionOf(sessionId);
          const face = session && session.projections && session.projections.faceOf('inbox');
          return face ? face.getSnapshot() : undefined;
        } catch (_error) {
          return undefined;
        }
      };

      const forgetSentinel = (rpcId) => {
        const sessionId = sentinelSession.get(rpcId);
        sentinelIds.delete(rpcId);
        sentinelSession.delete(rpcId);
        sentinelStarted.delete(rpcId);
        if (![...sentinelSession.values()].includes(sessionId)) {
          sentinelSubscriptions.get(sessionId)?.();
          sentinelSubscriptions.delete(sessionId);
        }
      };

      const sweepSentinels = () => {
        const now = Date.now();
        for (const [sessionId, wake] of wakeRequested) {
          const rows = inboxSnapshotOf(sessionId)?.['next-turn'] || [];
          if (now - wake.started > WAKE_TTL_MS || sessionOf(sessionId)?.getSnapshot().running === true
            || !rows.some((row) => row.id === wake.itemId)) wakeRequested.delete(sessionId);
        }
        if (sentinelSession.size === 0) return;
        for (const [rpcId, sessionId] of [...sentinelSession]) {
          const started = sentinelStarted.get(rpcId) || now;
          if (now - started > WAKE_TTL_MS) {
            forgetSentinel(rpcId);
            continue;
          }
          const inbox = inboxSnapshotOf(sessionId);
          const rows = (inbox && inbox['next-turn']) || [];
          const row = rows.find((candidate) => {
            const source = candidate && candidate.source;
            return source && source.kind === 'user' && source.rpcId === rpcId;
          });
          // Absence can mean a delayed projection. Retain its identity until TTL.
          if (!row || removingSentinels.has(rpcId)) continue;
          const conversation = conversationOf(sessionId);
          if (!conversation || typeof conversation.updateQueue !== 'function') continue;
          removingSentinels.add(rpcId);
          Promise.resolve()
            .then(() => conversation.updateQueue(row.id, { kind: 'remove' }))
            .then(() => forgetSentinel(rpcId), () => { /* retry on the next tick */ })
            .finally(() => removingSentinels.delete(rpcId));
        }
      };

      ctx.effect(() => {
        const timer = window.setInterval(sweepSentinels, 800);
        return () => {
          window.clearInterval(timer);
          for (const off of sentinelSubscriptions.values()) off();
          sentinelSubscriptions.clear();
          sentinelIds.clear();
          sentinelSession.clear();
          sentinelStarted.clear();
          wakeRequested.clear();
        };
      }, 'chat-actions: sentinel sweeper');

      // Use the native row while running. Paused hosts need a wake prompt; its
      // exact rpcId is registered BEFORE sending, with no pending transcript echo.
      const wakeSession = (sessionId, itemId) => {
        const existing = wakeFlights.get(sessionId);
        if (existing) return existing.itemId === itemId ? existing.promise : Promise.reject(new Error('queue-operation-in-progress'));
        const flight = Promise.resolve().then(async () => {
          const session = sessionOf(sessionId);
          if (!session?.prompt) throw new Error('session-not-attached');
          const rows = inboxSnapshotOf(sessionId)?.['next-turn'] || [];
          if (!rows.some((row) => row.id === itemId)) throw new Error('queue-item-not-found');
          if (session.getSnapshot().running === true) {
            const result = await session.updateQueue(itemId, { kind: 'steer' });
            if (result?.ok !== true) throw new Error(result?.error?.message || result?.error?.code || 'queue-steer-failed');
            return;
          }
          // A paused wake can only claim the FIFO head; never pretend a selected
          // later row was sent if the running state changed before this RPC.
          if (rows[0]?.id !== itemId) throw new Error('queue-head-required-while-paused');
          if (wakeRequested.has(sessionId)) throw new Error(formatT(t, 'queue.waking'));
          wakeRequested.set(sessionId, { itemId, started: Date.now() });
          const rpcId = newRequestId();
          sentinelIds.add(rpcId);
          sentinelSession.set(rpcId, sessionId);
          sentinelStarted.set(rpcId, Date.now());
          const face = session.projections?.faceOf('inbox');
          if (!sentinelSubscriptions.has(sessionId) && typeof face?.subscribe === 'function') {
            sentinelSubscriptions.set(sessionId, face.subscribe(sweepSentinels));
          }
          // Transport failure is ambiguous: keep this identity for late cleanup.
          const result = await session.prompt([{ type: 'text', text: SENTINEL_TEXT }], 'queue', undefined, rpcId);
          if (result?.ok !== true) {
            forgetSentinel(rpcId);
            wakeRequested.delete(sessionId);
            throw new Error(result?.error?.message || result?.error?.code || 'queue-wake-failed');
          }
          sweepSentinels();
        }).finally(() => wakeFlights.delete(sessionId));
        wakeFlights.set(sessionId, { itemId, promise: flight });
        return flight;
      };

      // ---- requirements 1 + 3: floating selection toolbar / message editor ----
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: TOOLS_ID,
        order: 30,
        locale: NS,
        inject: (sessionId) => ({
          sessionId,
          openAsk: (text, targetSessionId, origin) => {
            const sidebar = getService('sidebarRight');
            if (!sidebar || typeof sidebar.openTab !== 'function') return false;
            try {
              sidebar.openTab(ASK_KIND, {
                params: {
                  text,
                  origin,
                  selectionId: newRequestId(),
                  sessionId: typeof targetSessionId === 'string' && targetSessionId !== '' ? targetSessionId : sessionId
                }
              });
              return true;
            } catch (_error) {
              return false;
            }
          },
          sendPrompt: (text, source) => replaceEditedMessage(sessionId, text, source),
          insertQuote: (text, span, origin) => insertQuote(sessionId, text, span, origin),
          updateQuote: (reference, text, revision, origin) => updateQuote(sessionId, reference, text, revision, origin)
        })
      }, ChatTools));

      // ---- requirement 2: paused queue bar -------------------------------
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        // Same cell id as the shipped queue dock: reusing it REPLACES that cell,
        // so the page shows exactly one queue strip.
        id: 'queue',
        order: 20,
        locale: NS,
        inject: (sessionId) => {
          const conversation = conversationOf(sessionId);
          const binding = bindingOf(sessionId);
          const shell = (() => {
            try {
              if (conversation && conversation.input && typeof conversation.input.for === 'function') {
                const scope = sessions().scope(sessionId);
                return scope === undefined ? undefined : conversation.input.for(scope);
              }
            } catch (_error) { /* no shell */ }
            return undefined;
          })();
          return {
            updateQueue: async (itemId, action) => {
              const session = binding?.session;
              if (typeof session?.updateQueue === 'function') {
                const result = await session.updateQueue(itemId, action);
                if (result?.ok !== true) throw new Error(result?.error?.message || result?.error?.code || 'queue-update-failed');
                return;
              }
              if (typeof conversation?.updateQueue !== 'function') {
                return Promise.reject(new Error('conversation service unavailable'));
              }
              return conversation.updateQueue(itemId, action);
            },
            sentinelIds,
            // Queued-image thumbnails: the host resolves the durable attachment
            // to a URL, so the row previews exactly what will be sent.
            loadImage: (attachment) => loadImageFor(sessionId, attachment),
            // Wake the driver so the Host claims the oldest queued message
            // natively (attachments included); the sweeper removes the sentinel.
            wakeQueue: (itemId) => wakeSession(sessionId, itemId),
            notify: (level, text) => {
              try {
                if (shell && typeof shell.notify === 'function') shell.notify(level, text);
                else if (binding && binding.session && typeof binding.session.notify === 'function') binding.session.notify(level, text);
              } catch (_error) { /* ignore notices */ }
            }
          };
        }
      }, PausedQueueBar));

      // ---- requirement 1: sidebar ask tab -------------------------------
      ctx.inject(['sidebarRightTabs'], (scope) => {
        scope.effect(() => scope.sidebarRightTabs.register({
          id: ASK_ID,
          kind: ASK_KIND,
          priority: 'extension',
          title: () => t('ask.title'),
          keepMounted: true
        }), 'chat-actions: ask tab type');
      });

      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: ASK_ID,
        locale: NS,
        inject: (sessionId) => ({
          sideChatRemote,
          contextFor,
          modelDirectory: (parentId) => getService('modelDirectories')?.directoryFor(parentId || sessionId),
          insertDiscussion,
          sessionId
        })
      }, AskPanel));
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      createEffortMemory,
      // Pure action contract used by the toolbar itself and regression tests.
      quoteActions: { toolsApiOf, addSelectedQuote, isEditableMessageKind, replaceQuote, quoteOffsets, locateQuote, rangeAt, quoteOrigin },
      sideChatActions: { createController: createSideChatController, contribution: sideChatContribution }
    };
  }
});
