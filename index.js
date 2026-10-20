/**
 * Host half of dsh-chat-actions.
 *
 * Owns the read-only side-chat model transport and optional client hot reload.
 *
 * `clientModules` is injected OPTIONALLY: hosts without that service (older
 * builds) simply skip live client updates.
 */
const PACKAGE = 'dsh-chat-actions';

export function apply(ctx) {
  ctx.plugin(ChatActionsSideChat);
  ctx.inject(['clientModules'], (scope) => {
    const clientModules = scope.clientModules;
    if (!clientModules || typeof clientModules.rebuilt !== 'function') return;

    scope.effect(() => {
      let previous = '';
      let stopped = false;
      let lastEvent = null;

      const off = typeof clientModules.onRebuilt === 'function'
        ? clientModules.onRebuilt((id, rev) => {
          if (id === PACKAGE) lastEvent = { revision: rev, at: new Date().toISOString() };
        })
        : undefined;

      const publish = () => {
        if (stopped) return;
        try {
          const file = statSync(clientUrl);
          const signature = `${file.mtimeMs}:${file.ctimeMs}:${file.size}`;
          if (signature === previous) return;
          clientModules.rebuilt(PACKAGE);
          const bytes = readFileSync(clientUrl);
          const source = bytes.toString('utf8');
          writeFileSync(statusUrl, JSON.stringify({
            plugin: PACKAGE,
            hostPid: process.pid,
            publishedAt: new Date().toISOString(),
            build: /const BUILD = '([^']+)'/.exec(source)?.[1] ?? null,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: bytes.length,
            signature,
            rebuiltEvent: lastEvent,
            browserAcknowledged: false,
          }, null, 2) + '\n', 'utf8');
          previous = signature;
        } catch (error) {
          if (error?.code !== 'ENOENT') ctx.logger?.warn?.('[chat-actions] client hot update failed', error);
        }
      };

      publish();
      const timer = setInterval(publish, 500);
      timer.unref?.();
      return () => {
        stopped = true;
        clearInterval(timer);
        off?.();
      };
    }, 'chat-actions: publish changed client artifact');
  });
}

import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ChatActionsSideChat from './side-chat/host.js';

const clientUrl = new URL('./client.js', import.meta.url);
const statusUrl = new URL('./hot-reload-status.json', import.meta.url);
