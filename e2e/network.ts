// A network the test can take away (audit V-184). The page reaches the build through a proxy on its own port, and
// `off()` drops every connection to it, as a phone does when the signal goes. Playwright's WebKit cannot reload a page
// under `context.setOffline` ("WebKit encountered an internal error"), so the offline tests used to run on Chromium
// only, and the iPhone's engine never showed that Kadr opens without a network. Through this proxy the reload goes to
// the service worker on both engines; `setOffline` can follow it for what the page itself asks of the network.
// The proxy's port is an origin of its own: its service worker and storage start empty, apart from other tests.
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface SwitchableNetwork {
  /** The build's address through the proxy. */
  url: string;
  /** No more answers: open connections are dropped and new ones are cut off at once. */
  off(): void;
  /** Answers again. */
  on(): void;
  close(): Promise<void>;
}

/** `base`: a build served over plain HTTP at the root of its host (a local `vite preview`, as the tests run it). */
export function switchableNetwork(base: string): Promise<SwitchableNetwork> {
  const target = new URL(base);
  if (target.protocol !== 'http:' || target.pathname !== '/') throw new Error(`a switchable network needs a local build at the root, not ${base}`);
  const sockets = new Set<Socket>();
  let online = true;
  const server = http.createServer((req, res) => {
    if (!online) { req.socket.destroy(); return; }
    const up = http.request(
      { host: target.hostname, port: target.port, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
      (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
    );
    up.on('error', () => res.destroy());
    req.pipe(up);
  });
  server.on('connection', (s) => {
    if (!online) { s.destroy(); return; }
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise((ready) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as AddressInfo;
    ready({
      url: `http://localhost:${port}/`,
      off() { online = false; for (const s of sockets) s.destroy(); },
      on() { online = true; },
      close: () => new Promise<void>((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
    });
  }));
}
