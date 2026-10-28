// Speech model files, downloaded part by part (docs/12 stage 5). A model is up to 249 MB, and a phone loses the
// connection, sleeps, or moves between networks while it downloads: in one piece, any of that started it over,
// and a connection that hung waited forever. Here a file comes in 16 MiB parts (HTTP Range), each checked against
// the sha256 in models.json (scripts/model-manifest.mjs) and kept in the Cache API as soon as it is whole. A part
// that sends nothing for STALL_MS is asked for again; the parts already kept are never downloaded twice. The
// finished file is put together from its parts when the model loads, so it is stored once, not twice.
import manifest from './models.json';

export interface ModelFile { size: number; sha256: string; parts: string[] }

const PART: number = manifest.part;
const FILES = manifest.files as Record<string, ModelFile>;
export const PARTS_CACHE = 'kadr-model-parts';
/** Where transformers.js kept whole files before v1.4.17: moved into parts once, then deleted. */
const LEGACY = 'transformers-cache';
/** A part that sends nothing for this long has hung. */
export const STALL_MS = 20_000;
/** Tries per part (a stall or a broken part counts), with a growing pause between them. */
const TRIES = 4;
const PAUSE_MS = [1000, 3000, 9000];

/** Recognized by the page: the download stopped after every try and goes on from the kept parts next time (captions.ts). */
export const DOWNLOAD_STOPPED = 'model download stopped';

/** The file for a model URL on any host (the key is the path after the host), or null for small files. */
export function modelFile(url: string): [key: string, file: ModelFile] | null {
  for (const key of Object.keys(FILES)) if (url.endsWith(`/${key}`)) return [key, FILES[key]];
  return null;
}

/** A file name as transformers.js reports its progress ('onnx/encoder_model_quantized.onnx') is a large file's. */
export const isModelFileName = (name: string): boolean => Object.keys(FILES).some((k) => k.endsWith(`/${name.replace(/^\/+/, '')}`));

const partKey = (key: string, i: number) => new URL(`/__kadr-model-parts/${key}/${i}`, self.location.origin).href;
const partRange = (f: ModelFile, i: number): [number, number] => [i * PART, Math.min(f.size, (i + 1) * PART) - 1];
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});

async function checked(bytes: Uint8Array<ArrayBuffer>, f: ModelFile, i: number): Promise<boolean> {
  const [a, b] = partRange(f, i);
  return bytes.byteLength === b - a + 1 && hex(await crypto.subtle.digest('SHA-256', bytes)) === f.parts[i];
}

/** Which parts of the file are kept, by size (each was checked before it was kept). */
async function keptParts(cache: Cache, key: string, f: ModelFile): Promise<boolean[]> {
  return Promise.all(f.parts.map(async (_, i) => {
    const hit = await cache.match(partKey(key, i));
    const [a, b] = partRange(f, i);
    return !!hit && Number(hit.headers.get('content-length')) === b - a + 1;
  }));
}

async function keep(cache: Cache, key: string, i: number, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  await cache.put(partKey(key, i), new Response(bytes, { headers: { 'content-length': String(bytes.byteLength), 'content-type': 'application/octet-stream' } }));
}

/** A whole file transformers.js kept before: its parts are checked and moved over, the old copy goes. */
async function migrate(cache: Cache, url: string, key: string, f: ModelFile, have: boolean[]): Promise<void> {
  const old = await caches.open(LEGACY).catch(() => null);
  if (!old) return;
  // Whisper was asked for by "main" before its revision was pinned: the same bytes, if the parts' checksums say so.
  for (const at of [url, url.replace(/\/resolve\/[^/]+\//, '/resolve/main/')]) {
    const res = await old.match(at);
    if (!res) continue;
    const blob = await res.blob();
    if (blob.size === f.size) {
      for (let i = 0; i < f.parts.length; i++) {
        if (have[i]) continue;
        const [a, b] = partRange(f, i);
        const bytes = new Uint8Array(await blob.slice(a, b + 1).arrayBuffer());
        if (await checked(bytes, f, i)) { await keep(cache, key, i, bytes); have[i] = true; }
      }
    }
    await old.delete(at);
  }
}

/** One part, read with a stall guard; the bytes, or an error saying why not. */
async function fetchPart(url: string, f: ModelFile, i: number, onBytes: (n: number) => void, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const [a, b] = partRange(f, i);
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctrl.abort(); }, STALL_MS); };
  try {
    watch();
    const res = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal: ctrl.signal });
    const whole = res.status === 200 && a === 0 && b === f.size - 1; // a one-part file may come without a range
    if (res.status === 200 && !whole) { void res.body?.cancel(); throw new NoRanges(); }
    if (res.status !== 206 && !whole) throw new Error(`HTTP ${res.status} for part ${i + 1} of ${f.parts.length}`);
    if (!res.body) throw new Error('empty response');
    const out = new Uint8Array(b - a + 1);
    let at = 0;
    const reader = res.body.getReader();
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.byteLength > out.byteLength) throw new Error(`part ${i + 1} is longer than expected`);
      out.set(value, at);
      at += value.byteLength;
      onBytes(value.byteLength);
    }
    if (at !== out.byteLength) throw new Error(`part ${i + 1} ended early`);
    return out;
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw stalled ? new Error(`no data for ${STALL_MS / 1000} s`) : e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * The answer to a part was the whole file: the Range header did not get through. FACT (2026-10-28): WebKit drops
 * it on a cross-origin request from a page a service worker controls — every iPhone with Kadr installed.
 */
class NoRanges extends Error {}

/**
 * The whole file in one response, cut into parts as it comes: each missing part is checked and kept as soon as it
 * is whole, bytes of parts already kept are passed over. Slower to resume than ranges (it starts from the top),
 * but the download still never waits forever and never keeps a broken part.
 */
async function streamWhole(url: string, f: ModelFile, have: boolean[], onPart: (i: number, bytes: Uint8Array<ArrayBuffer>) => Promise<void>, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void> {
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctrl.abort(); }, STALL_MS); };
  try {
    watch();
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status !== 200 || !res.body) throw new Error(`HTTP ${res.status} for the whole file`);
    const reader = res.body.getReader();
    let i = 0, at = 0; // part, bytes of it so far
    let part: Uint8Array<ArrayBuffer> | null = have[0] ? null : new Uint8Array(partRange(f, 0)[1] + 1);
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      if (done) break;
      for (let off = 0; off < value.byteLength;) {
        if (i >= f.parts.length) throw new Error('the file is longer than expected');
        const [a, b] = partRange(f, i);
        const take = Math.min(b - a + 1 - at, value.byteLength - off);
        if (part) { part.set(value.subarray(off, off + take), at); onBytes(take); }
        off += take;
        at += take;
        if (at === b - a + 1) {
          if (part) await onPart(i, part);
          i++;
          at = 0;
          part = i < f.parts.length && !have[i] ? new Uint8Array(partRange(f, i)[1] - partRange(f, i)[0] + 1) : null;
        }
      }
    }
    if (i !== f.parts.length) throw new Error(`the file ended early, in part ${i + 1}`);
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw stalled ? new Error(`no data for ${STALL_MS / 1000} s`) : e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * Makes sure the whole file is kept, downloading only the parts it does not have yet. `onProgress` gets the bytes
 * kept so far and the file size. Throws DOWNLOAD_STOPPED when a part stopped coming after every try.
 */
export async function ensureFile(url: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const found = modelFile(url);
  if (!found) return;
  const [key, f] = found;
  const cache = await caches.open(PARTS_CACHE);
  const have = await keptParts(cache, key, f);
  if (have.some((x) => !x)) await migrate(cache, url, key, f, have);
  const size = (i: number) => { const [a, b] = partRange(f, i); return b - a + 1; };
  let loaded = have.reduce((s, x, i) => s + (x ? size(i) : 0), 0);
  onProgress(loaded, f.size);
  let ranges = true;
  const keepPart = async (i: number, bytes: Uint8Array<ArrayBuffer>) => {
    if (!(await checked(bytes, f, i))) throw new Error(`part ${i + 1} of ${key} does not match its checksum`);
    await keep(cache, key, i, bytes);
    have[i] = true;
    loaded += bytes.byteLength;
  };
  for (let attempt = 1; have.some((x) => !x); attempt++) {
    const before = loaded;
    let got = 0;
    const onBytes = (n: number) => { got += n; onProgress(loaded + got, f.size); };
    try {
      if (!ranges) {
        await streamWhole(url, f, have, async (i, bytes) => { got = 0; await keepPart(i, bytes); }, onBytes, signal);
        continue;
      }
      const i = have.indexOf(false);
      await keepPart(i, await fetchPart(url, f, i, onBytes, signal));
      attempt = 0; // a part was kept: the next one gets its own tries
    } catch (e) {
      if (e instanceof NoRanges) { ranges = false; attempt--; console.warn('model host ignores ranges: the file comes whole', url); continue; }
      if ((e as Error).name === 'AbortError' || (e as Error).name === 'QuotaExceededError') throw e;
      if (loaded > before) attempt = 1; // the whole stream kept something before it broke
      // The connection is gone, hung, or sends broken data: the kept parts wait for the next try.
      if (attempt >= TRIES) throw new Error(`${DOWNLOAD_STOPPED}: ${(e as Error).message}`);
      console.warn(`model ${key}, try ${attempt}:`, e);
      onProgress(loaded, f.size);
      await sleep(PAUSE_MS[attempt - 1], signal);
    }
  }
}

/** The whole kept file, put together from its parts, or undefined while a part is missing. */
export async function keptFile(url: string): Promise<Response | undefined> {
  const found = modelFile(url);
  if (!found) return undefined;
  const [key, f] = found;
  const cache = await caches.open(PARTS_CACHE);
  const blobs: Blob[] = [];
  for (let i = 0; i < f.parts.length; i++) {
    const hit = await cache.match(partKey(key, i));
    if (!hit) return undefined;
    blobs.push(await hit.blob());
  }
  const blob = new Blob(blobs);
  if (blob.size !== f.size) return undefined;
  return new Response(blob, { headers: { 'content-length': String(f.size), 'content-type': 'application/octet-stream' } });
}
