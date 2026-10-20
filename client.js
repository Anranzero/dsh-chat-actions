window.__ModuleLoader__.load({
  id: 'dsh-chat-actions',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useMemo } = React;

    const NS = 'chatActions';
    /** Build marker: bumped on every behaviour change so the running page can
     *  prove which bundle it actually loaded (see console + toolbar tooltip). */
    const BUILD = 'v9-isolated-sidebar-queue-recovery';
    const ASK_KIND = 'chat-actions-ask';
    const ASK_ID = 'dsh-chat-actions/ask';
    const TOOLS_ID = 'chat-actions-tools';
    const SENTINEL_TEXT = '·';
    const QUOTE_SOURCE = 'chat-actions-quote';
    const QUOTE_LABEL_CHARS = 60;
    /** How many queued images a row shows before the rest collapse into a count. */
    const MAX_QUEUE_THUMBS = 3;

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

    function quotePayloadOf(text) {
      const raw = String(text || '');
      // Only the label is shortened. Never silently truncate model-facing text.
      return { text: raw, truncated: false };
    }

    function quoteLabelOf(text) {
      const flat = String(text || '').replace(/\s+/g, ' ').trim();
      return flat.length > QUOTE_LABEL_CHARS ? flat.slice(0, QUOTE_LABEL_CHARS) + '…' : flat;
    }

    /** Replace one native reference without flattening other chips or commands. */
    function replaceQuote(draft, reference, text) {
      const refs = draft.references || [];
      const index = refs.findIndex((item) => item.source === QUOTE_SOURCE
        && item.ref === reference.ref && item.offset === reference.offset && item.length === reference.length);
      if (index < 0) return undefined;
      const current = refs[index];
      const payload = text === null ? null : quotePayloadOf(text);
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
        const inserted = api.insertQuote(target.text, span);
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
      'tools.addToComposer': '添加到对话',
      'tools.quoteFailed': '引用未添加，点击重试',
      'tools.askSidebar': '在侧边栏提问',
      'tools.editMessage': '编辑消息',
      'tools.editResend': '编辑后重发',
      'tools.editTitle': '编辑消息',
      'tools.send': '发送',
      'tools.cancel': '取消',
      'quote.label': '引用 {n}',
      'quote.edit': '编辑引用',
      'quote.remove': '删除引用',
      'quote.changed': '草稿已变化，请重新编辑引用',
      'editor.placeholder': '修改后作为新消息发送…',
      'editor.empty': '内容不能为空',
      'editor.sendFailed': '发送失败：{message}',
      'editor.sent': '已发送',
      'editor.textOnly': '仅重发文字；原消息的附件不会随之发送',
      'ask.title': '选区提问',
      'ask.quoteLabel': '选中的对话内容',
      'ask.questionPlaceholder': '针对选中内容提问，回车发送…',
      'ask.send': '发送问题',
      'ask.sent': '已发送到独立侧边会话',
      'ask.defaultQuestion': '请解释以上内容',
      'ask.failed': '发送失败：{message}',
      'ask.empty': '没有拿到选中的内容，请重新选择后再试',
      'queue.paused': '对话已暂停',
      'queue.count': '{n} 条排队消息',
      'queue.send': '发送',
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
      'queue.claimed': '已开始发送'
    };
    const en = {
      'tools.addToComposer': 'Add to chat',
      'tools.quoteFailed': 'Quote not added — retry',
      'tools.askSidebar': 'Ask in sidebar',
      'tools.editMessage': 'Edit message',
      'tools.editResend': 'Edit & resend',
      'tools.editTitle': 'Edit message',
      'tools.send': 'Send',
      'tools.cancel': 'Cancel',
      'quote.label': 'Quote {n}',
      'quote.edit': 'Edit quote',
      'quote.remove': 'Remove quote',
      'quote.changed': 'Draft changed. Please reopen the quote editor.',
      'editor.placeholder': 'Edit, then send as a new message…',
      'editor.empty': 'Content cannot be empty',
      'editor.sendFailed': 'Send failed: {message}',
      'editor.sent': 'Sent',
      'editor.textOnly': 'Resends text only; original attachments are not included',
      'ask.title': 'Ask about selection',
      'ask.quoteLabel': 'Selected conversation content',
      'ask.questionPlaceholder': 'Ask about the selection, Enter to send…',
      'ask.send': 'Send question',
      'ask.sent': 'Sent to the independent side chat',
      'ask.defaultQuestion': 'Please explain the content above',
      'ask.failed': 'Send failed: {message}',
      'ask.empty': 'No selection content was provided. Select the text again and retry.',
      'queue.paused': 'Conversation paused',
      'queue.count': '{n} queued messages',
      'queue.send': 'Send',
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
      'queue.claimed': 'Started sending'
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

    function attachmentCountOf(content) {
      if (!Array.isArray(content)) return 0;
      let count = 0;
      for (const block of content) {
        if (block && (block.type === 'image' || block.type === 'file')) count += 1;
      }
      return count;
    }

    /** Attachment blocks of one queued message, in order. An image carries the
     *  durable attachment the host resolves to a URL; a file only its name. */
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
    function QuoteDraft({ input, updateQuote, t }) {
      const [editing, setEditing] = useState(null);
      const [error, setError] = useState('');
      const quotes = ((input && input.occurrences) || []).filter((item) => item.source === QUOTE_SOURCE);
      const change = (reference, text, rev) => {
        if (typeof updateQuote !== 'function' || !updateQuote(reference, text, rev)) {
          setError(formatT(t, 'quote.changed'));
          return;
        }
        setEditing(null);
        setError('');
      };
      if (quotes.length === 0) return null;
      const button = (label, onClick, disabled) => h('button', {
        key: label, type: 'button', onClick, disabled, title: label, 'aria-label': label,
        style: { border: 'none', borderRadius: '5px', padding: '3px 6px', background: TOKEN_HOVER, color: TOKEN_TEXT, font: FONT, cursor: 'pointer' }
      }, label);
      return h('div', {
        'data-chat-actions-quotes': '',
        style: { maxHeight: '210px', overflowY: 'auto', marginBottom: '6px', color: TOKEN_TEXT, font: FONT }
      }, quotes.map((reference, index) => {
        let text = '';
        try { text = JSON.parse(reference.ref).text; } catch (_error) { /* invalid chip can still be removed */ }
        const active = editing && editing.reference.ref === reference.ref && editing.reference.offset === reference.offset;
        return h('div', {
          key: String(reference.offset) + ':' + index,
          style: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px', marginTop: '4px', border: TOKEN_BORDER, borderRadius: '8px', background: TOKEN_BG }
        },
          h('span', { style: { color: TOKEN_MUTED, flex: 'none' } }, formatT(t, 'quote.label', { n: index + 1 })),
          h('div', { style: { flex: '1 1 auto', minWidth: 0 } }, active
            ? h('textarea', {
              value: editing.text, autoFocus: true, 'aria-label': formatT(t, 'quote.edit'), rows: 4,
              name: 'chat-actions-quote', autoComplete: 'off',
              onChange: (event) => setEditing({ ...editing, text: event.target.value }),
              onKeyDown: (event) => { if (event.key === 'Escape') setEditing(null); },
              style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', background: 'transparent', color: TOKEN_TEXT, border: TOKEN_BORDER, borderRadius: '5px', font: FONT }
            })
            : h('div', { title: text, style: { maxHeight: '64px', overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, text)),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', flex: '0 1 auto', maxWidth: '45%' } }, active
            ? [button(formatT(t, 'queue.save'), () => change(editing.reference, editing.text, editing.rev), editing.text.trim() === ''),
              button(formatT(t, 'tools.cancel'), () => setEditing(null))]
            : [button(formatT(t, 'quote.edit'), () => { setError(''); setEditing({ reference, text, rev: input.draftRev }); }),
              button(formatT(t, 'quote.remove'), () => change(reference, null, input.draftRev))])
        );
      }), error ? h('div', { role: 'status', style: { color: 'var(--dsw-alias-label-error, #d9534f)' } }, error) : null);
    }

    function ChatTools(props) {
      const { useInput } = props;
      const input = typeof useInput === 'function' ? useInput((state) => state) : undefined;
      const ref = useRef({});
      const anchor = useRef(null);
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
          if (ref.current.openAsk(target.text, ref.current.sessionId)) hideBar();
          else askButton.textContent = formatT(t, 'tools.quoteFailed');
        });
        // Selection tools apply to either role, but editing belongs ONLY to a
        // sent human message and is exposed separately next to its copy action.
        addButton.title = formatT(t, 'tools.addToComposer') + '  [' + BUILD + ']';
        bar.append(addButton, askButton);
        document.body.appendChild(bar);

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
        const sendButton = makeButton(formatT(t, 'tools.send'), async () => {
          if (sending) return;
          const value = textarea.value;
          if (value.trim() === '') { editorStatus.textContent = formatT(t, 'editor.empty'); return; }
          sending = true;
          sendButton.disabled = true;
          cancelButton.disabled = true;
          editorStatus.textContent = '';
          try {
            await ref.current.sendPrompt(value);
            editorStatus.textContent = formatT(t, 'editor.sent');
            closeEditor();
          } catch (error) {
            const message = error && error.message ? String(error.message) : String(error);
            editorStatus.textContent = formatT(t, 'editor.sendFailed', { message });
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
        };
        const openEditor = (text, rect, row) => {
          if (sending) return;
          if (!row || !isEditableMessageKind(row.getAttribute('data-chat-flow-kind'))) return;
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
            if (!owns(element) || !owns(selection.anchorNode) || !owns(selection.focusNode)) { hideBar(); return false; }
            if (element.closest('[data-slot="conversation.chat.flow"]') === null) return false;
            const rect = range.getBoundingClientRect();
            stateRef.current.toolbar = { kind: 'selection', text, rect, range: range.cloneRange() };
            placeAbove(bar, rect);
            return true;
          } catch (_error) {
            return false;
          }
        };

        const onClick = (event) => {
          const element = event.target;
          if (!element || typeof element.closest !== 'function') return;
          if (bar.contains(element) || element.closest('[data-chat-actions-pencil]') || editor.contains(element)) return;
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
          removePencil();
          editor.remove();
        };
      }, [props.sessionId]);

      return h('div', { ref: anchor }, h(QuoteDraft, { input, updateQuote: props.updateQuote, t: props.t }));
    }

    // ------------------------------------------------------------------
    // Paused queue bar (requirement 2).
    // Sending wakes the driver with a one-shot sentinel prompt so the Host
    // claims the oldest queued message natively — attachments included —
    // then removes the sentinel again. The shipped queue dock is hidden
    // while this bar is mounted.
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

    function PausedQueueBar(props) {
      const { useSession, useProjection, useInput, inputActions, updateQueue, wakeQueue, sentinelIds, notify, loadImage, t } = props;
      const inbox = typeof useProjection === 'function' ? useProjection('inbox') : undefined;
      const pendingSubmissions = useSession((state) => state.pendingSubmissions) || [];
      const running = useSession((state) => state.running) === true;
      const subagent = useSession((state) => (state.subagent === undefined ? null : state.subagent));
      const input = typeof useInput === 'function' ? useInput((state) => state) : undefined;

      const queueMutable = subagent === null || (subagent && subagent.address && subagent.address.mode === 'continuable');
      const sentinels = useRef(new Set());

      const queue = useMemo(() => {
        const rows = (inbox && inbox['next-turn']) || [];
        const inChat = new Set();
        for (const item of pendingSubmissions) {
          if (item.placement === 'transcript') inChat.add(item.requestId);
        }
        const visible = [];
        for (const row of rows) {
          const source = row && row.source;
          const rpcId = source && source.kind === 'user' ? source.rpcId : undefined;
          if (rpcId && sentinelIds && sentinelIds.has(rpcId)) continue;
          if (rpcId && inChat.has(rpcId)) continue;
          visible.push(row);
        }
        return visible;
      }, [inbox, pendingSubmissions]);

      const pending = useMemo(() => {
        const admitted = new Set();
        for (const row of queue) {
          const source = row && row.source;
          if (source && source.kind === 'user' && source.rpcId) admitted.add(source.rpcId);
        }
        return pendingSubmissions.filter((item) => item.placement === 'queued' && !admitted.has(item.requestId));
      }, [pendingSubmissions, queue]);

      const queueRef = useRef(queue);
      queueRef.current = queue;

      const [editing, setEditing] = useState(null);
      const [busy, setBusy] = useState(null);
      const busyRef = useRef(false);
      const [preview, setPreview] = useState(null);
      const [collapsed, setCollapsed] = useState(false);
      const rowCount = queue.length + pending.length;

      useEffect(() => {
        if (editing !== null && !queue.some((row) => row.id === editing.id)) setEditing(null);
      }, [editing, queue]);

      // This component OWNS the queue cell (the shipped dock is replaced, not
      // duplicated): the strip must stay visible in every state, so it only
      // yields when there is nothing queued at all.
      if (rowCount === 0) return null;

      const notifyError = (text) => {
        try { if (typeof notify === 'function') notify('error', text); } catch (_error) { /* ignore */ }
      };

      const sendNext = async () => {
        const first = queue[0];
        if (!first || !queueMutable || busyRef.current) return;
        busyRef.current = true;
        setBusy(first.id);
        try {
          await wakeQueue(first.id);
        } catch (error) {
          // Surface the reason instead of one opaque sentence: this path is the
          // only way a paused queue can move, so a silent failure is fatal.
          const detail = error && error.message ? String(error.message) : '';
          notifyError(formatT(t, 'queue.sendFailed') + (detail ? ' · ' + detail : ''));
        } finally {
          busyRef.current = false;
          setBusy(null);
        }
      };

      const saveEdit = async () => {
        if (editing === null || editing.text.trim() === '' || !queueMutable || busyRef.current) return;
        const row = queue.find((item) => item.id === editing.id);
        if (!row || attachmentCountOf(row.content) > 0) return;
        busyRef.current = true;
        setBusy(editing.id);
        try {
          await updateQueue(editing.id, { kind: 'edit', content: [{ type: 'text', text: editing.text }] });
          setEditing(null);
        } catch (_error) {
          notifyError(formatT(t, 'queue.editFailed'));
        } finally {
          busyRef.current = false;
          setBusy((current) => (current === editing.id ? null : current));
        }
      };

      const removeRow = async (row) => {
        if (!queueMutable || busyRef.current) return;
        busyRef.current = true;
        setBusy(row.id);
        try {
          await updateQueue(row.id, { kind: 'remove' });
        } catch (_error) {
          notifyError(formatT(t, 'queue.removeFailed'));
        } finally {
          busyRef.current = false;
          setBusy((current) => (current === row.id ? null : current));
        }
      };

      const smallButton = (labelText, onClick, options) => h('button', {
        type: 'button',
        onClick,
        disabled: options && options.disabled ? true : undefined,
        title: options && options.title ? options.title : labelText,
        'aria-label': options && options.title ? options.title : labelText,
        style: {
          font: FONT,
          height: '20px',
          padding: '0 7px',
          borderRadius: '6px',
          border: 'none',
          cursor: options && options.disabled ? 'default' : 'pointer',
          background: options && options.quiet ? 'transparent' : TOKEN_HOVER,
          color: options && options.quiet ? TOKEN_MUTED : TOKEN_TEXT,
          opacity: options && options.disabled ? 0.4 : 1,
          flex: 'none'
        }
      }, labelText);

      const rows = [];
      queue.forEach((row, index) => {
        const text = textOf(row.content);
        const attachments = attachmentCountOf(row.content);
        const blocks = attachmentsOf(row.content);
        const images = [];
        const files = [];
        for (const entry of blocks) {
          if (entry.type === 'image') images.push(entry);
          else files.push(entry);
        }
        const shownImages = images.slice(0, MAX_QUEUE_THUMBS);
        const isEditing = editing !== null && editing.id === row.id;
        const isFirst = index === 0;
        rows.push(h('div', {
          key: 'q:' + String(row.id),
          'data-chat-actions-queue-row': '',
          style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, height: '22px' }
        },
          isEditing ? null : shownImages.map((entry, imageIndex) => h(QueueThumb, {
            key: 'thumb:' + String(row.id) + ':' + imageIndex,
            attachment: entry.attachment,
            loadImage,
            label: formatT(t, 'queue.image'),
            onOpen: setPreview
          })),
          isEditing
            ? h('textarea', {
              value: editing.text,
              autoFocus: true,
              rows: 2,
              name: 'chat-actions-queued-message', autoComplete: 'off',
              disabled: busy !== null,
              'aria-label': formatT(t, 'queue.edit'),
              onChange: (event) => setEditing({ id: row.id, text: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); saveEdit(); }
                else if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
              },
              style: {
                flex: '1 1 auto', minWidth: 0, minHeight: '40px', padding: '3px 6px', resize: 'vertical',
                borderRadius: '6px', border: TOKEN_BORDER, background: 'var(--dsw-alias-bg-base, transparent)',
                color: TOKEN_TEXT, font: FONT
              }
            })
            : h('span', {
              title: text,
              style: {
                flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', font: FONT
              }
            },
              text === '' ? formatT(t, 'queue.attachments', { n: attachments }) : text,
              // Images already show as thumbnails; only files still need a count.
              files.length > 0
                ? h('span', { style: { opacity: 0.6, marginLeft: '6px' } }, '📎' + files.length)
                : (attachments > 0 && shownImages.length === 0
                  ? h('span', { style: { opacity: 0.6, marginLeft: '6px' } }, '📎' + attachments)
                  : null)
            ),
          isEditing
            ? h('span', { style: { display: 'inline-flex', gap: '4px' } },
              smallButton(formatT(t, 'queue.save'), saveEdit, { disabled: busy !== null || editing.text.trim() === '' }),
              smallButton(formatT(t, 'queue.cancel'), () => setEditing(null), { quiet: true, disabled: busy !== null })
            )
            : h('span', { style: { display: 'inline-flex', gap: '4px' } },
              smallButton(formatT(t, 'queue.edit'), () => setEditing({ id: row.id, text: text }), {
                quiet: true, disabled: !queueMutable || busy !== null || attachments > 0 || text.trim() === '',
                title: attachments > 0 ? formatT(t, 'queue.attachmentEdit') : formatT(t, 'queue.edit')
              }),
              smallButton('🗑', () => removeRow(row), {
                quiet: true, disabled: !queueMutable || busy !== null, title: formatT(t, 'queue.remove')
              }),
              smallButton('↑', () => sendNext(), {
                disabled: !queueMutable || !isFirst || busy !== null,
                title: isFirst ? formatT(t, 'queue.sendHint') : formatT(t, 'queue.waiting', { n: index })
              })
            )
        ));
      });
      for (const item of pending) {
        rows.push(h('div', {
          key: 'p:' + String(item.requestId),
          style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, height: '22px', opacity: 0.65 }
        },
          h('span', {
            style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: FONT }
          }, item.text === ''
            ? formatT(t, 'queue.attachments', { n: (item.attachments || []).length })
            : item.text),
          h('span', { style: { font: FONT } }, formatT(t, 'queue.sending'))
        ));
      }

      return h(React.Fragment, null,
        h('div', {
          'data-chat-actions-queue': '',
          style: {
            boxSizing: 'border-box', minWidth: 0,
            width: 'calc(100% - var(--dsh-composer-side-clearance, 0px) - var(--dsh-composer-side-clearance, 0px))',
            maxWidth: 'var(--dsh-composer-card-max-width, 100%)', marginInline: 'auto',
            display: 'flex', flexDirection: 'column', gap: '2px', padding: '5px 8px',
            marginBottom: '6px', borderRadius: 'var(--dsw-radius-md, 8px)',
            background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))',
            border: '0.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.2))',
            font: FONT, color: TOKEN_TEXT
          }
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
            rowCount > 1
              ? h('button', {
                type: 'button',
                onClick: () => setCollapsed((value) => !value),
                'aria-expanded': collapsed ? 'false' : 'true',
                title: formatT(t, 'queue.count', { n: rowCount }),
                style: {
                  font: FONT, height: '20px', width: '20px', flex: 'none',
                  border: 'none', borderRadius: '6px', cursor: 'pointer',
                  background: 'transparent', color: TOKEN_MUTED
                }
              }, collapsed ? '▸' : '▾')
              : null,
            h('span', {
              style: {
                flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', font: FONT, opacity: 0.75
              }
            }, formatT(t, 'queue.count', { n: rowCount }) + ' · '
              + formatT(t, running ? 'queue.sending' : 'queue.paused')),
            smallButton(formatT(t, 'queue.send') + ' ↓', () => sendNext(), {
              // Always clickable while paused: this is the only path that moves
              // a paused queue. While a turn runs the host claims it by itself.
              disabled: !queueMutable || busy !== null || running || queue.length === 0,
              title: formatT(t, 'queue.sendHint')
            })
          ),
          collapsed && rowCount > 1
            ? null
            : h('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '132px', overflowY: 'auto' }
            }, rows)
        ),
        preview === null ? null : h(QueueImagePreview, {
          image: preview,
          label: formatT(t, 'queue.image'),
          onClose: () => setPreview(null)
        })
      );
    }

    // ------------------------------------------------------------------
    // Sidebar ask panel (requirement 1, second destination)
    // ------------------------------------------------------------------
    function AskPanel(props) {
      const { useTabInfo, createSideSession, sendToSession, insertSideQuote, SessionProvider, renderFactorySlot, t, sessionId: standardSessionId } = props;
      const info = typeof useTabInfo === 'function' ? useTabInfo() : undefined;
      const params = info && info.tab && info.tab.navigation && info.tab.navigation.params
        ? info.tab.navigation.params
        : {};
      const quoted = typeof params.text === 'string' ? params.text : '';
      const quoteKey = typeof params.selectionId === 'string' ? params.selectionId : quoted;
      const sessionId = typeof params.sessionId === 'string' && params.sessionId !== ''
        ? params.sessionId
        : standardSessionId;

      const [question, setQuestion] = useState('');
      const [sending, setSending] = useState(false);
      const [status, setStatus] = useState(null);
      const [thread, setThread] = useState(null);
      const owner = useRef({ alive: true, reference: null, busy: false });
      const lastQuote = useRef('');

      useEffect(() => {
        owner.current.alive = true;
        return () => {
          owner.current.alive = false;
          owner.current.reference?.release();
          owner.current.reference = null;
        };
      }, []);

      const addToSide = () => {
        if (!thread || !insertSideQuote(thread.sessionId, quoted)) {
          setStatus({ kind: 'error', text: formatT(t, 'tools.quoteFailed') });
          return false;
        }
        lastQuote.current = quoteKey;
        setStatus(null);
        return true;
      };
      useEffect(() => {
        if (thread && quoted.trim() !== '' && quoteKey !== lastQuote.current) addToSide();
      }, [thread, quoted, quoteKey]);

      const send = async () => {
        if (owner.current.busy) return;
        if (quoted.trim() === '') {
          setStatus({ kind: 'error', text: formatT(t, 'ask.empty') });
          return;
        }
        const asked = question.trim() === '' ? formatT(t, 'ask.defaultQuestion') : question.trim();
        const payload = asked + '\n\n' + quoteFrame(quotePayloadOf(quoted));
        owner.current.busy = true;
        setSending(true);
        setStatus(null);
        try {
          if (typeof SessionProvider !== 'function' || typeof renderFactorySlot !== 'function') throw new Error('conversation-renderer-unavailable');
          let reference = owner.current.reference;
          if (!reference) {
            reference = await createSideSession(sessionId);
            if (!owner.current.alive) { reference.release(); return; }
            owner.current.reference = reference;
          }
          await sendToSession(reference.sessionId, payload);
          if (!owner.current.alive) return;
          lastQuote.current = quoteKey;
          setQuestion('');
          setThread(reference);
          setStatus(null);
        } catch (error) {
          const message = error && error.message ? String(error.message) : String(error);
          if (owner.current.alive) setStatus({ kind: 'error', text: formatT(t, 'ask.failed', { message }) });
        } finally {
          owner.current.busy = false;
          if (owner.current.alive) setSending(false);
        }
      };

      if (thread) return h('div', {
        'data-chat-actions-ask': '',
        style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, minWidth: 0 }
      },
        status ? h('div', { role: 'status', style: { padding: '8px', color: TOKEN_TEXT, font: FONT } },
          status.text,
          h('button', { type: 'button', onClick: addToSide }, formatT(t, 'tools.addToComposer'))
        ) : null,
        h(SessionProvider, { session: thread }, renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'ready', hero: false }))
      );

      return h('div', {
        'data-chat-actions-ask': '',
        style: {
          display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px',
          boxSizing: 'border-box', color: TOKEN_TEXT, font: FONT
        }
      },
        h('div', { style: { fontWeight: 500, fontSize: '13px' } }, formatT(t, 'ask.title')),
        h('div', {
          title: quoted,
          style: {
            maxHeight: '35vh', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            padding: '8px', borderRadius: 'var(--dsw-radius-md, 8px)',
            background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.08))',
            border: TOKEN_BORDER, font: FONT
          }
        }, quoted),
        h('textarea', {
          value: question,
          name: 'chat-actions-side-question', autoComplete: 'off',
          'aria-label': formatT(t, 'ask.questionPlaceholder'),
          onChange: (event) => setQuestion(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !event.shiftKey && !(event.nativeEvent && event.nativeEvent.isComposing)) {
              event.preventDefault();
              send();
            }
          },
          placeholder: formatT(t, 'ask.questionPlaceholder'),
          rows: 3,
          style: {
            boxSizing: 'border-box', width: '100%', minHeight: '62px', padding: '6px 8px',
            borderRadius: 'var(--dsw-radius-md, 8px)', border: TOKEN_BORDER,
            background: 'var(--dsw-alias-bg-base, transparent)', color: TOKEN_TEXT,
            font: FONT, resize: 'vertical'
          }
        }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', font: FONT } },
          h('button', {
            type: 'button',
            disabled: sending,
            onClick: send,
            style: {
              font: FONT, height: '24px', padding: '0 10px', borderRadius: '7px',
              border: 'none', cursor: 'pointer', background: TOKEN_HOVER, color: TOKEN_TEXT
            }
          }, formatT(t, sending ? 'queue.sending' : 'ask.send')),
          status
            ? h('span', {
              role: 'status',
              style: {
                opacity: 0.8,
                color: status.kind === 'error' ? 'var(--dsw-alias-label-error, #d9534f)' : 'inherit'
              }
            }, status.text)
            : null
        )
      );
    }

    // ------------------------------------------------------------------
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
       *  Resolved lazily: the queued-image thumbnails must work even when the
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
      const insertQuote = (sessionId, text, span) => {
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
        const payload = quotePayloadOf(text);
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

      const updateQuote = (sessionId, reference, text, revision) => {
        try {
          const scope = scopeOf(sessionId);
          const shell = scope?.get('conversation')?.input?.for(scope);
          const state = shell?.state.getSnapshot();
          if (!state || state.draftRev !== revision || !['plain', 'claimed'].includes(state.phase)) return false;
          const draft = replaceQuote(shell.draftSnapshot, reference, text);
          if (!draft) return false;
          shell.setDraft(draft);
          shell.focus();
          return true;
        } catch (_error) { return false; }
      };

      // Retain a separate binding, like dsh-prompt-history; never select it in the main UI.
      const createSideSession = async (parentId) => {
        const service = sessions();
        if (!service?.create || !service?.retain) throw new Error('sessions-unavailable');
        const parent = service.list?.getSnapshot()?.byId?.[parentId];
        const id = await service.create(parent?.cwd ? { cwd: parent.cwd } : {});
        if (id === parentId) throw new Error('side-session-not-isolated');
        const reference = service.retain(id, { source: 'dsh-chat-actions.side-chat' });
        try { await reference.ready; return reference; }
        catch (error) { reference.release(); throw error; }
      };

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'chat-actions: dictionaries');
      try { console.info('[chat-actions] loaded build', BUILD); } catch (_error) { /* ignore */ }
      const t = ctx.locale.bind(NS);

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
        if (wakeFlights.has(sessionId)) return wakeFlights.get(sessionId);
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
        wakeFlights.set(sessionId, flight);
        return flight;
      };

      // ---- requirements 1 + 3: floating selection toolbar / message editor ----
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: TOOLS_ID,
        order: 30,
        locale: NS,
        inject: (sessionId) => ({
          openAsk: (text, targetSessionId) => {
            const sidebar = getService('sidebarRight');
            if (!sidebar || typeof sidebar.openTab !== 'function') return false;
            try {
              sidebar.openTab(ASK_KIND, {
                params: {
                  text,
                  selectionId: newRequestId(),
                  sessionId: typeof targetSessionId === 'string' && targetSessionId !== '' ? targetSessionId : sessionId
                }
              });
              return true;
            } catch (_error) {
              return false;
            }
          },
          sendPrompt: (text) => sendAsPrompt(sessionId, text, 'queue'),
          insertQuote: (text, span) => insertQuote(sessionId, text, span),
          updateQuote: (reference, text, revision) => updateQuote(sessionId, reference, text, revision)
        })
      }, ChatTools));

      // ---- requirement 2: paused queue bar -------------------------------
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        // Same cell id as the shipped queue dock: reusing it REPLACES that cell,
        // so the page shows exactly one queue strip with the thumbnails and the
        // send-while-paused behaviour, instead of two stacked lists.
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
        children: { 'conversation.session': { kind: 'single', scope: 'session' } },
        inject: (sessionId) => ({
          createSideSession: (parentId) => createSideSession(parentId || sessionId),
          insertSideQuote: (targetId, text) => insertQuote(targetId, text),
          sendToSession: (targetSessionId, text) => sendAsPrompt(
            targetSessionId,
            text,
            'queue'
          )
        })
      }, AskPanel));
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      // Pure action contract used by the toolbar itself and regression tests.
      quoteActions: { toolsApiOf, addSelectedQuote, isEditableMessageKind, replaceQuote }
    };
  }
});
