// SW-S-3: a part of a model goes on from the byte it reached. On 2026-11-23 Kadr's site gave this Mac 170 KB/s:
// part 1 (16 MiB) lost its connection after 35 s and began again from nothing, on another host.
import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const PART = 64 * 1024, SIZE = 3 * PART - 1000, KEY = 'test/repo/resolve/rev/model.bin';
  const data = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) data[i] = (i * 31 + (i >> 8)) & 255;
  const parts = [0, 1, 2].map((i) => createHash('sha256').update(data.subarray(i * PART, Math.min(SIZE, (i + 1) * PART))).digest('hex'));
  return { PART, SIZE, KEY, data, manifest: { part: PART, mirror: ['test/repo/'], small: {}, files: { [KEY]: { size: SIZE, sha256: createHash('sha256').update(data).digest('hex'), parts } } } };
});
vi.mock('./models.json', () => ({ default: fake.manifest }));

import { DOWNLOAD_STOPPED, ensureFile, keptFile, setModelHosts } from './modelFiles';
import { resetStores } from './modelStore';

const OWN = 'https://example.test/Kadr/models/', HF = 'https://hf.test/';

/**
 * Both hosts, as fetch sees them. `cut`: a connection is lost after this many bytes of a body, every time (0: never).
 * `ranges`: the site honours Range on its part files (GitHub Pages does). Counts every byte sent.
 */
function hosts({ cut, ranges = true, cutsLeft = Infinity }: { cut: number; ranges?: boolean; cutsLeft?: number }) {
  const sent = { bytes: 0, requests: [] as string[] };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    sent.requests.push(`${url.startsWith(OWN) ? 'own' : 'hf'} ${range ?? 'whole'}`);
    let from: number, to: number, status = 206;
    const own = /\.parts\/(\d+)$/.exec(url);
    if (own) {
      const i = Number(own[1]), a = i * fake.PART, b = Math.min(fake.SIZE, a + fake.PART) - 1;
      const m = ranges ? /^bytes=(\d+)-$/.exec(range ?? '') : null;
      from = a + (m ? Number(m[1]) : 0); to = b; status = m ? 206 : 200;
    } else {
      const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')!;
      from = Number(m[1]); to = Number(m[2]);
    }
    const whole = fake.data.subarray(from, to + 1);
    const lose = cut > 0 && whole.byteLength > cut && cutsLeft-- > 0;
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (lose && at >= cut) { ctrl.error(new TypeError('Load failed')); return; }
        if (at >= whole.byteLength) { ctrl.close(); return; }
        const n = Math.min(8192, whole.byteLength - at, lose ? cut - at : Infinity);
        ctrl.enqueue(whole.slice(at, at + n));
        at += n; sent.bytes += n;
      },
    });
    return new Response(body, { status });
  });
  return sent;
}

/** Runs the download to its end with the pauses between tries skipped. */
async function download(): Promise<{ error?: Error }> {
  let settled = false, error: Error | undefined;
  const done = ensureFile(fake.KEY, () => undefined).then(() => undefined, (e: Error) => { error = e; }).finally(() => { settled = true; });
  while (!settled) await vi.advanceTimersByTimeAsync(1000);
  await done;
  return { error };
}
const kept = async () => new Uint8Array(await (await keptFile(fake.KEY))!.arrayBuffer());

describe('a part goes on from the byte it reached (SW-S-3)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetStores(); });

  it('a server that loses the connection every 20 KB: the model is downloaded, and no more than 1.2 of its size came over the network', async () => {
    vi.useFakeTimers();
    setModelHosts({ own: OWN, ranges: HF });
    const sent = hosts({ cut: 20 * 1024 });
    const { error } = await download();
    expect(error?.message).toBeUndefined();
    expect(await kept()).toEqual(fake.data);
    expect(sent.bytes).toBeLessThanOrEqual(fake.SIZE * 1.2);
    expect(sent.requests.some((r) => /^own bytes=\d+-$/.test(r)), 'the site was asked to go on from a byte').toBe(true);
    expect(sent.requests.filter((r) => r.startsWith('hf'))).toEqual([]); // bytes were coming: the slower host has no turn
  });

  it('a site that answers a "go on from" with the whole part: the part begins again, honestly, and the model is whole', async () => {
    vi.useFakeTimers();
    setModelHosts({ own: OWN, ranges: HF });
    const sent = hosts({ cut: 20 * 1024, ranges: false, cutsLeft: 1 });
    const { error } = await download();
    expect(error?.message).toBeUndefined();
    expect(await kept()).toEqual(fake.data); // nothing of the first try is glued in front of a whole part
    expect(sent.bytes).toBe(fake.SIZE + 20 * 1024);
  });

  it('a host that gives nothing at all still stops the download after its tries', async () => {
    vi.useFakeTimers();
    setModelHosts({ own: OWN, ranges: HF });
    vi.stubGlobal('fetch', async () => { throw new TypeError('Load failed'); });
    expect((await download()).error?.message).toContain(DOWNLOAD_STOPPED);
  });
});
