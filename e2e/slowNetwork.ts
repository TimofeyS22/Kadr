// A slow network for chosen files (SW-L-3). The page reaches the build through a proxy on its own port; a file that
// matches a rule comes at the rule's pace, then stops sending (quiet) or drops the connection (broken), as a phone's
// network does. Everything else passes at once. Playwright cannot slow WebKit's requests (no CDP) nor reach a dedicated
// worker's on both engines, so the pace is set where every request goes: the server. The port is an origin of its own,
// so its service worker and storage start empty, as in a fresh Safari.
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface SlowRule {
  match: RegExp;
  /** Bytes a second sent of a matching file. */
  bytesPerSecond: number;
  /** After this many bytes nothing more comes, and the connection stays open. */
  quietAfter?: number;
  /** After this many bytes the connection is dropped. */
  breakAfter?: number;
  /** Only the first this many matching requests are slowed (a try after a failure gets the file at once). */
  times?: number;
}

export interface SlowNetwork {
  /** The build's address through the proxy. */
  url: string;
  /** What each slowed request got: its path, the bytes sent, the seconds it took, and when it ended (ms since 1970). */
  sent: { path: string; bytes: number; seconds: number; at: number; how: 'whole' | 'quiet' | 'broken' | 'closed' }[];
  close(): Promise<void>;
}

const TICK_MS = 100;

/** `base`: a build served over plain HTTP at the root of its host (a local `vite preview`, as the tests run it). */
export function slowNetwork(base: string, rules: SlowRule[]): Promise<SlowNetwork> {
  const target = new URL(base);
  if (target.protocol !== 'http:' || target.pathname !== '/') throw new Error(`a slow network needs a local build at the root, not ${base}`);
  const sockets = new Set<Socket>();
  const sent: SlowNetwork['sent'] = [];
  const used = new Map<SlowRule, number>();
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '/', target).pathname;
    let rule = req.method === 'GET' ? rules.find((r) => r.match.test(path)) : undefined;
    if (rule) {
      used.set(rule, (used.get(rule) ?? 0) + 1);
      if (used.get(rule)! > (rule.times ?? Infinity)) rule = undefined;
    }
    const up = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host, 'accept-encoding': 'identity' } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        if (!rule) { r.pipe(res); return; }
        const t0 = Date.now();
        const note = { path, bytes: 0, seconds: 0, at: 0, how: 'closed' as SlowNetwork['sent'][number]['how'] };
        sent.push(note);
        const queue: Buffer[] = [];
        let queued = 0, ended = false;
        r.on('data', (b: Buffer) => { queue.push(b); queued += b.length; if (queued > 4 << 20) r.pause(); });
        r.on('end', () => { ended = true; });
        const done = (how: typeof note.how) => { clearInterval(tick); note.how = how; note.at = Date.now(); note.seconds = (note.at - t0) / 1000; };
        const tick = setInterval(() => {
          let budget = Math.round((rule.bytesPerSecond * TICK_MS) / 1000);
          const cap = Math.min(rule.quietAfter ?? Infinity, rule.breakAfter ?? Infinity);
          while (budget > 0 && queue.length && note.bytes < cap) {
            const n = Math.min(budget, queue[0].length, cap - note.bytes);
            res.write(queue[0].subarray(0, n));
            queue[0] = queue[0].subarray(n);
            if (!queue[0].length) queue.shift();
            queued -= n; budget -= n; note.bytes += n;
          }
          if (queued < 1 << 20) r.resume();
          if (rule.quietAfter !== undefined && note.bytes >= rule.quietAfter) { done('quiet'); return; } // the connection stays open
          if (rule.breakAfter !== undefined && note.bytes >= rule.breakAfter) { done('broken'); req.socket.destroy(); return; }
          if (ended && !queue.length) { done('whole'); res.end(); }
        }, TICK_MS);
        res.on('close', () => { if (note.how === 'closed') done('closed'); });
      },
    );
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((ready) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    ready({
      url: `http://localhost:${port}/`,
      sent,
      close: () => new Promise<void>((closed) => { for (const s of sockets) s.destroy(); server.close(() => closed()); }),
    });
  }));
}
