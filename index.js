import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PACKAGE = 'dsh-chat-actions';
export const inject = ['clientModules'];

/** Publish only this plugin's changed client artifact through the host HMR API. */
export function apply(ctx) {
  ctx.effect(() => {
    const client = new URL('./client.js', import.meta.url);
    const status = new URL('./hot-reload-status.json', import.meta.url);
    let previous = '';
    let stopped = false;
    let lastEvent;
    const off = ctx.clientModules.onRebuilt?.((id, rev) => {
      if (id === PACKAGE) lastEvent = { revision: rev, at: new Date().toISOString() };
    });
    const publish = () => {
      if (stopped) return;
      try {
        const file = statSync(client);
        const signature = `${file.mtimeMs}:${file.ctimeMs}:${file.size}`;
        if (signature === previous) return;
        // This snapshots new bytes and broadcasts the new revision to the
        // existing page's /plugins/events receiver. No page reload is needed.
        ctx.clientModules.rebuilt(PACKAGE);
        const bytes = readFileSync(client);
        const source = bytes.toString('utf8');
        const baseline = ctx.clientModules.artifactBaseline?.(PACKAGE);
        writeFileSync(status, JSON.stringify({
          plugin: PACKAGE,
          hostPid: process.pid,
          publishedAt: new Date().toISOString(),
          build: /const BUILD = '([^']+)'/.exec(source)?.[1] ?? null,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: bytes.length,
          signature,
          baseline: baseline ? {
            mtimeMs: baseline.mtimeMs,
            ctimeMs: baseline.ctimeMs,
            size: baseline.size,
          } : null,
          rebuiltEvent: lastEvent ?? null,
          // Host publication is verifiable here; browser rendering is not.
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
}
