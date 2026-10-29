// Speech model files: where they come from, and how they come (docs/12 stage 5).
//
// Where: Kadr's own site first (scripts/mirror-models.mjs puts them there, next to the app the phone has already
// loaded), then Hugging Face. Measured from this Mac on 2026-10-29: the site 9–18 MB/s, Hugging Face 0.25–7 MB/s,
// with stalls of more than 20 s.
//
// How: a large file (up to 237 MB) comes in 16 MiB parts — from the site as files <path>.parts/<i>, from Hugging
// Face as HTTP ranges. Each part is checked against the sha256 in models.json (scripts/model-manifest.mjs) and
// kept in the Cache API as soon as it is whole, so a broken connection costs one part and never starts the model
// over. A part that sends nothing for STALL_MS, fails or comes broken is asked for again, from the other host.
// Small files (configs, vocabularies) come whole and are checked the same way. The finished file is put together
// from its parts when the model loads, so it is stored once, not twice.
import manifest from './models.json';

export interface ModelFile { size: number; sha256: string; parts: string[] }
interface SmallFile { size: number; sha256: string }

const PART: number = manifest.part;
const FILES = manifest.files as Record<string, ModelFile>;
const SMALL = manifest.small as Record<string, SmallFile>;
const MIRROR: string[] = manifest.mirror;
export const PARTS_CACHE = 'kadr-model-parts';
/** Where transformers.js kept whole files before v1.4.17: moved into parts once, then deleted. */
const LEGACY = 'transformers-cache';
const HF = 'https://huggingface.co/';
/** A part that sends nothing for this long has hung. */
export const STALL_MS = 20_000;
/** Failures in a row (a stall, a broken part, a lost connection) before a download stops for now. */
const TRIES = 4;
const PAUSE_MS = [1000, 3000, 9000];

/** Recognized by the page: the download stopped after every try and goes on from the kept parts next time (captions.ts). */
export const DOWNLOAD_STOPPED = 'model download stopped';

/**
 * `own`: Kadr's site, serving the repositories models.json mirrors (null where it has none, the dev server).
 * `ranges`: a host serving every file, answering byte ranges: Hugging Face, or the dev proxy (VITE_MODEL_HOST).
 */
export interface ModelHosts { own: string | null; ranges: string }
let hosts: ModelHosts = { own: null, ranges: HF };
export const setModelHosts = (h: ModelHosts) => { hosts = h; };
export const modelHosts = () => hosts;

/** Kadr's site has this file (its repository is mirrored). */
export const mirrored = (key: string) => MIRROR.some((prefix) => key.startsWith(prefix));

/**
 * A URL on Kadr's site of a file models.json does not list, in a repository the site mirrors: the site has exactly
 * the listed files, so this one is not there, and asking would only put a 404 in the console (transformers.js 4.3.0
 * looks for onnx/<name>.onnx whatever subfolder it is given) — or, offline, wait for a network that is not there.
 */
export function absentOnSite(url: string): boolean {
  if (!hosts.own || !url.startsWith(hosts.own)) return false;
  const key = url.slice(hosts.own.length).split(/[?#]/)[0];
  return mirrored(key) && !(key in FILES || key in SMALL);
}

/** The models.json key (`<repo>/resolve/<rev>/<path>`) of a model URL on any host, or null for files not listed. */
export function modelKey(url: string): string | null {
  const path = url.split(/[?#]/)[0];
  for (const host of [hosts.own, hosts.ranges, HF]) if (host && path.startsWith(host)) return known(path.slice(host.length));
  for (const key of [...Object.keys(FILES), ...Object.keys(SMALL)]) if (path.endsWith(`/${key}`)) return key;
  return null;
}
const known = (key: string) => (key in FILES || key in SMALL ? key : null);
export const isLarge = (key: string) => key in FILES;

/** A file name as transformers.js reports its progress ('onnx/encoder_model_quantized.onnx') is a large file's. */
export const isModelFileName = (name: string): boolean => Object.keys(FILES).some((k) => k.endsWith(`/${name.replace(/^\/+/, '')}`));

/** The hosts to try for a file, in order. */
const sources = (key: string): ('own' | 'ranges')[] => (hosts.own && mirrored(key) ? ['own', 'ranges'] : ['ranges']);
const url = (source: 'own' | 'ranges', key: string) => (source === 'own' ? hosts.own! : hosts.ranges) + key;

const partKey = (key: string, i: number) => new URL(`/__kadr-model-parts/${key}/${i}`, self.location.origin).href;
const partRange = (f: ModelFile, i: number): [number, number] => [i * PART, Math.min(f.size, (i + 1) * PART) - 1];
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (b: Uint8Array<ArrayBuffer>) => hex(await crypto.subtle.digest('SHA-256', b));
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
});
const cancelled = () => new DOMException('Cancelled', 'AbortError');

async function checked(bytes: Uint8Array<ArrayBuffer>, f: ModelFile, i: number): Promise<boolean> {
  const [a, b] = partRange(f, i);
  return bytes.byteLength === b - a + 1 && (await sha256(bytes)) === f.parts[i];
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

/**
 * A whole file transformers.js kept before (Kadr ≤ 1.4.16, from Hugging Face): its parts are checked and moved
 * over, the old copy goes. Whisper was asked for by "main" before its revision was pinned: the same bytes, if the
 * parts' checksums say so.
 */
async function migrate(cache: Cache, key: string, f: ModelFile, have: boolean[]): Promise<void> {
  const old = await caches.open(LEGACY).catch(() => null);
  if (!old) return;
  const main = key.replace(/\/resolve\/[^/]+\//, '/resolve/main/');
  for (const at of new Set([HF + key, HF + main, hosts.ranges + key, hosts.ranges + main])) {
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

/**
 * A response body read with a stall guard: `onChunk` gets each piece; no piece for STALL_MS aborts it. The
 * request is made inside, so the guard also covers a server that never answers.
 */
async function guarded(target: string, init: RequestInit, onResponse: (res: Response) => void, onChunk: (b: Uint8Array) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  signal?.addEventListener('abort', cancel);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled = false;
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctrl.abort(); }, STALL_MS); };
  try {
    watch();
    // Not the browser's HTTP cache as well: the Cache API keeps the checked copy (twice the writes on a phone otherwise).
    const res = await fetch(target, { ...init, cache: 'no-store', signal: ctrl.signal });
    onResponse(res);
    if (!res.body) throw new Error('empty response');
    const reader = res.body.getReader();
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      if (done) return;
      await onChunk(value);
    }
  } catch (e) {
    if (signal?.aborted) throw cancelled();
    throw stalled ? new Error(`no data for ${STALL_MS / 1000} s`) : e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    ctrl.abort(); // a body left unread (an error status, a wrong answer) lets go of its connection
  }
}

/**
 * The answer to a range was the whole file: the Range header did not get through. FACT (2026-10-28): WebKit drops
 * it on a cross-origin request a service worker passes on (v1.4.17's worker fetches model hosts itself).
 */
class NoRanges extends Error {}

/** One part: from Kadr's site as its own file, from a ranges host as a byte range. */
async function fetchPart(source: 'own' | 'ranges', key: string, f: ModelFile, i: number, onBytes: (n: number) => void, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const [a, b] = partRange(f, i);
  const out = new Uint8Array(b - a + 1);
  let at = 0;
  const own = source === 'own';
  await guarded(own ? `${url('own', key)}.parts/${i}` : url('ranges', key), own ? {} : { headers: { Range: `bytes=${a}-${b}` } }, (res) => {
    const whole = res.status === 200 && (own || (a === 0 && b === f.size - 1)); // a one-part file may come without a range
    if (res.status === 200 && !whole) { void res.body?.cancel(); throw new NoRanges(); }
    if (res.status !== 206 && !whole) throw new Error(`HTTP ${res.status} for part ${i + 1} of ${f.parts.length} from ${source === 'own' ? 'the site' : 'the model host'}`);
  }, (value) => {
    if (at + value.byteLength > out.byteLength) throw new Error(`part ${i + 1} is longer than expected`);
    out.set(value, at);
    at += value.byteLength;
    onBytes(value.byteLength);
  }, signal);
  if (at !== out.byteLength) throw new Error(`part ${i + 1} ended early`);
  return out;
}

/**
 * The whole file in one response from a host that ignores ranges, cut into parts as it comes: each missing part is
 * checked and kept as soon as it is whole, bytes of parts already kept are passed over. Slower to resume than parts
 * (it starts from the top), but it never waits forever and never keeps a broken part.
 */
async function streamWhole(key: string, f: ModelFile, have: boolean[], onPart: (i: number, bytes: Uint8Array<ArrayBuffer>) => Promise<void>, onBytes: (n: number) => void, signal?: AbortSignal): Promise<void> {
  let i = 0, at = 0; // part, bytes of it so far
  const size = (j: number) => partRange(f, j)[1] - partRange(f, j)[0] + 1;
  let part: Uint8Array<ArrayBuffer> | null = have[0] ? null : new Uint8Array(size(0));
  await guarded(url('ranges', key), {}, (res) => {
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for the whole file`);
  }, async (value) => {
    for (let off = 0; off < value.byteLength;) {
      if (i >= f.parts.length) throw new Error('the file is longer than expected');
      const take = Math.min(size(i) - at, value.byteLength - off);
      if (part) { part.set(value.subarray(off, off + take), at); onBytes(take); }
      off += take;
      at += take;
      if (at === size(i)) {
        if (part) await onPart(i, part);
        i++;
        at = 0;
        part = i < f.parts.length && !have[i] ? new Uint8Array(size(i)) : null;
      }
    }
  }, signal);
  if (i !== f.parts.length) throw new Error(`the file ended early, in part ${i + 1}`);
}

/** Failures that trying again cannot fix: they stop the download at once. */
const final = (e: unknown) => (e as Error).name === 'AbortError' || (e as Error).name === 'QuotaExceededError';

/**
 * Makes sure the whole file is kept, downloading only the parts it does not have yet, from the first host that
 * works. `onProgress` gets the bytes kept so far and the file size. Throws DOWNLOAD_STOPPED after TRIES failures
 * in a row, whatever the host.
 */
export async function ensureFile(key: string, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const f = FILES[key];
  if (!f) return;
  const cache = await caches.open(PARTS_CACHE);
  const have = await keptParts(cache, key, f);
  if (have.some((x) => !x)) await migrate(cache, key, f, have);
  const size = (i: number) => { const [a, b] = partRange(f, i); return b - a + 1; };
  let loaded = have.reduce((s, x, i) => s + (x ? size(i) : 0), 0);
  onProgress(loaded, f.size);
  const order = sources(key);
  let at = 0; // the host in use: the next one takes over when it fails
  let ranges = true; // the ranges host honours Range (else its whole file is cut into parts)
  let ownMissing = false; // the site answered with an error status: its copy is not there, the fallback keeps the file
  const keepPart = async (i: number, bytes: Uint8Array<ArrayBuffer>) => {
    if (!(await checked(bytes, f, i))) throw new Error(`part ${i + 1} of ${key} does not match its checksum`);
    await keep(cache, key, i, bytes);
    have[i] = true;
    loaded += bytes.byteLength;
  };
  for (let failures = 0; have.some((x) => !x);) {
    const source = order[at];
    const before = loaded;
    let got = 0;
    const onBytes = (n: number) => { got += n; onProgress(loaded + got, f.size); };
    try {
      if (source === 'ranges' && !ranges) {
        await streamWhole(key, f, have, async (i, bytes) => { got = 0; await keepPart(i, bytes); }, onBytes, signal);
      } else {
        const i = have.indexOf(false);
        await keepPart(i, await fetchPart(source, key, f, i, onBytes, signal));
      }
      failures = 0; // a part was kept: the next one gets its own tries
      // A blip on the way to the site does not send the rest of the file (up to 200 MB) to the slower host.
      if (order[at] !== 'own' && order[0] === 'own' && !ownMissing) at = 0;
    } catch (e) {
      if (e instanceof NoRanges) { ranges = false; console.warn('the model host ignores ranges: the file comes whole', key); continue; }
      if (final(e)) throw e;
      if (source === 'own' && /^HTTP 4\d\d/.test((e as Error).message)) ownMissing = true;
      if (loaded > before) failures = 0; // the whole stream kept something before it broke
      // The connection is gone, hung, or sends broken data: the kept parts wait, the other host gets a turn.
      if (++failures >= TRIES) throw new Error(`${DOWNLOAD_STOPPED}: ${(e as Error).message}`);
      console.warn(`model ${key} from ${source}, try ${failures}:`, e);
      at = (at + 1) % order.length;
      if (ownMissing && order[at] === 'own') at = (at + 1) % order.length; // no turn for a copy that is not there
      onProgress(loaded, f.size);
      await sleep(PAUSE_MS[failures - 1], signal);
    }
  }
}

/**
 * The whole kept file, read part after part as it is consumed, or undefined while a part is missing. Not one Blob
 * of the parts' Blobs: WebKit fails to read such a Blob of a model's size ("Too much data buffered while waiting for
 * the previous multipart part", FACT 2026-10-29), and a buffer of the whole file would hold the model in memory twice.
 */
export async function keptFile(key: string): Promise<Response | undefined> {
  const f = FILES[key];
  if (!f) return undefined;
  const cache = await caches.open(PARTS_CACHE);
  for (let i = 0; i < f.parts.length; i++) if (!(await cache.match(partKey(key, i)))) return undefined;
  let i = 0;
  // highWaterMark 0: nothing is read before it is asked for (transformers.js makes Responses it only looks at).
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i === f.parts.length) { ctrl.close(); return; }
      const hit = await cache.match(partKey(key, i));
      const bytes = hit && new Uint8Array(await hit.arrayBuffer());
      if (!bytes || bytes.byteLength !== partRange(f, i)[1] - partRange(f, i)[0] + 1) { ctrl.error(new Error(`part ${i + 1} of ${key} is gone from the cache`)); return; }
      i++;
      ctrl.enqueue(bytes);
    },
  }, { highWaterMark: 0 });
  return new Response(body, { headers: { 'content-length': String(f.size), 'content-type': 'application/octet-stream' } });
}

/**
 * A small listed file (config, vocabulary, the 2 MB speech detector), checked against models.json, from the first
 * host that gives the right bytes; three tries each.
 */
export async function smallFile(key: string, signal?: AbortSignal): Promise<Response> {
  const f = SMALL[key];
  if (!f) throw new Error(`${key} is not a listed model file`);
  const order = sources(key);
  let last: unknown = null;
  for (let attempt = 0; attempt < order.length * 3; attempt++) {
    const source = order[attempt % order.length];
    const chunks: Uint8Array[] = [];
    try {
      await guarded(url(source, key), {}, (res) => { if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`); }, (b) => { chunks.push(b); }, signal);
      const bytes = new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
      if (bytes.byteLength !== f.size || (await sha256(bytes)) !== f.sha256) throw new Error(`${key} does not match its checksum`);
      return new Response(bytes, { headers: { 'content-length': String(f.size), 'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    } catch (e) {
      if (final(e)) throw e;
      last = e;
      console.warn(`model file ${key} from ${source}:`, e);
      const round = Math.floor(attempt / order.length);
      if (attempt % order.length === order.length - 1 && round < 2) await sleep(PAUSE_MS[round], signal);
    }
  }
  throw new Error(`${DOWNLOAD_STOPPED}: ${(last as Error)?.message ?? key}`);
}

/**
 * A small listed file kept by Kadr ≤ 1.4.17 in transformers.js's cache under its Hugging Face address (the speech
 * detector under "main", before its revision was pinned): the same file, if its checksum says so. Without this, a
 * phone that made captions before would need the network again after the update, offline captions included.
 */
export async function legacySmall(cache: Cache, key: string): Promise<Response | undefined> {
  const f = SMALL[key];
  if (!f) return undefined;
  const main = key.replace(/\/resolve\/[^/]+\//, '/resolve/main/');
  for (const at of new Set([HF + key, HF + main, hosts.ranges + key, hosts.ranges + main])) {
    const hit = await cache.match(at);
    if (!hit) continue;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (bytes.byteLength === f.size && (await sha256(bytes)) === f.sha256) {
      return new Response(bytes, { headers: { 'content-length': String(f.size), 'content-type': key.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    }
  }
  return undefined;
}

/**
 * transformers.js asks for one byte (Range: bytes=0-0) to learn that a file exists and its size: for a listed file
 * that is known already, and answered here without the network.
 */
export function probeAnswer(key: string): Response | null {
  const size = FILES[key]?.size ?? SMALL[key]?.size;
  if (size === undefined) return null;
  return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': `bytes 0-0/${size}`, 'content-length': '1', 'content-type': 'application/octet-stream' } });
}
