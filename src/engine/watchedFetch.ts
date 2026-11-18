// A download that fails when the server goes quiet, never because it is slow (SW-L-3). On the iPhone 15, in a fresh
// Safari cache, the vision runtime (11.8 MB, 3.5 MB gzipped on the wire) took ~35 s from the page and over a minute
// from the worker; Kadr waited 60 s in all and said «the server did not answer» while it was answering. Here a
// download lives as long as bytes come, says how far it is, and the words say what really happened.

/** No byte for this long, and the server is taken as gone (as for the speech model, modelFiles.ts). */
export const QUIET_MS = 20_000;
/** How often the progress is reported at most. */
const REPORT_MS = 250;

export const NOT_ANSWERING = 'The on-device model did not load: the server did not answer. Try again in a minute, or on another network.';
export const CONNECTION_BROKE = 'The on-device model did not finish downloading: the connection broke. Try again, or on another network.';
export const SITE_ERROR = 'The on-device model did not load: the site answered with an error. Try again in a minute.';
export const OFFLINE = 'No internet. This tool downloads its model once; after that it works offline.';

/** How far a download is: its share (0..1), and the megabytes over the network when the server says how many. */
export interface Got { share: number; mb?: { done: number; total: number } }

/**
 * The file at `url` as a Blob of `type`. `size` is the file's own size: a server that compresses it on the way says
 * only the compressed length, while the body comes uncompressed, so the share is counted against `size` and the
 * megabytes on the wire follow from it. `fresh`: past the browser's HTTP cache, for a try after a failed one —
 * Chromium held a second request for the same file behind the first, gone quiet but kept open by the service worker,
 * exactly as long as Kadr waits (20 s), so the try after «did not answer» did not answer either.
 */
export async function watchedBlob(url: string, size: number, type: string, onProgress: (g: Got) => void, opts: { quietMs?: number; fresh?: boolean } = {}): Promise<Blob> {
  const quietMs = opts.quietMs ?? QUIET_MS;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet = false;
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => { quiet = true; ctrl.abort(); }, quietMs); };
  try {
    watch();
    const res = await fetch(url, { signal: ctrl.signal, ...(opts.fresh ? { cache: 'no-store' as const } : {}) });
    if (!res.ok || !res.body) throw new Error(SITE_ERROR);
    const wire = Number(res.headers.get('content-length')) || 0;
    const compressed = !!res.headers.get('content-encoding') && res.headers.get('content-encoding') !== 'identity';
    const chunks: Uint8Array[] = [];
    let got = 0, said = 0;
    const tell = (share: number) => onProgress({ share, ...(wire ? { mb: { done: (share * wire) / 1e6, total: wire / 1e6 } } : {}) });
    const reader = res.body.getReader();
    for (;;) {
      watch();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      const now = Date.now();
      if (now - said >= REPORT_MS) { said = now; tell(Math.min(0.99, got / (compressed ? size : wire || size))); }
    }
    tell(1);
    return new Blob(chunks as BlobPart[], { type });
  } catch (e) {
    if ((e as Error).message === SITE_ERROR) throw e;
    if (!navigator.onLine) throw new Error(OFFLINE);
    if (quiet) throw new Error(NOT_ANSWERING, { cause: e });
    throw new Error(CONNECTION_BROKE, { cause: e });
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // a body left unread lets go of its connection
  }
}
