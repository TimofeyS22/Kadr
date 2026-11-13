// The one door to a stored file's bytes (docs/19, ADR-М1 and ADR-М2): a handle is mortal, an id is not.
// The record under the asset's id is what the file is. The Blob the browser hands out for it is only a lease, and a
// lease can die while the record is fine: on an iPhone a camera take's Blob, already held by the preview, stopped
// reading ("NotFoundError: The object can not be found here.") once the take's pieces were deleted, while a fresh read
// of the same record worked (S-1-13). A reader that meets a dead lease takes a new one and reads again, without a word.
import type { ChunkedMedia, StoredMedia } from './chunks';

/** A stored file read through the door. It holds the asset's id; its lease is replaced whenever it dies. */
export interface MediaReader extends ChunkedMedia {
  readonly assetId: string;
}

/** Words for a person, with their placeholders (as `MediaError`, so `errorMessage` translates them). */
abstract class StoredMediaError extends Error {
  /** The layer the error belongs to (docs/19 ADR-М3): storage, never the decoder. */
  readonly layer = 'storage';
  constructor(message: string, readonly vars?: Record<string, string | number>, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** The file's record is gone: deleted in another tab, or evicted by the system. Nothing to heal. */
export class MediaMissing extends StoredMediaError {
  constructor(options?: { cause?: unknown }) { super('Media file is missing from this device', undefined, options); this.name = 'MediaMissing'; }
}

/** Reading the stored bytes failed, and a new lease did not help. */
export class MediaReadError extends StoredMediaError {
  constructor(readonly why: string, options?: { cause?: unknown }) {
    super('This file could not be read from the storage of this device. Reload the page; if that does not help, add the file again.', undefined, options);
    this.name = 'MediaReadError';
  }
}

/** Errors of the storage layer: the pool must not take them for a decoder that stopped. */
export const isStorageError = (e: unknown): e is MediaMissing | MediaReadError => e instanceof StoredMediaError;

/**
 * A read refused because the lease died, not because of the bytes or the range: WebKit says NotFoundError of a Blob
 * whose backing is gone (S-1-13), Chromium NotReadableError; a lost IndexedDB connection is InvalidStateError,
 * UnknownError or "Connection to Indexed Database server lost".
 */
export function leaseDied(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return ['NotFoundError', 'NotReadableError', 'InvalidStateError', 'UnknownError'].includes(e.name) || /connection|lost/i.test(e.message);
}

/** Pauses before each new lease. Two leases, then the error: a file that is really broken is not hidden. */
export const RENEW_PAUSES_MS = [50, 250];
/** New leases one file may take in a minute (docs/19 С14): past this a dead read is an error at once, not a loop. */
export const RENEWALS_PER_MINUTE = 6;

/** What the door tells whoever counts (docs/19 H5): no content, only what happened. */
export interface LeaseEvent { assetId: string; healed: boolean; attempts: number; error: string }

export interface LeaseDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  report?: (e: LeaseEvent) => void;
}

const renewals = new Map<string, number[]>();
/** May the file take one more lease now? Each one taken counts. */
function allowRenewal(assetId: string, now: number): boolean {
  const recent = (renewals.get(assetId) ?? []).filter((at) => now - at < 60_000);
  const ok = recent.length < RENEWALS_PER_MINUTE;
  if (ok) recent.push(now);
  renewals.set(assetId, recent);
  return ok;
}
/** For tests: the fuse starts over. */
export function resetRenewals(): void { renewals.clear(); }

const readFrom = async (m: StoredMedia, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> =>
  m instanceof Blob ? new Uint8Array(await m.slice(start, end).arrayBuffer()) : m.read(start, end);

const nameOf = (e: unknown): string => (e instanceof Error ? e.name : typeof e);

/**
 * A reader of the stored file `assetId`, starting from the lease `first`. `open` reads the record again in a new
 * transaction. A new lease must be the same size: bytes that are not the file's never reach a decoder.
 */
export function leasedReader(assetId: string, first: StoredMedia, open: () => Promise<StoredMedia | undefined>, deps: LeaseDeps = {}): MediaReader {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  let lease = first;
  let renewing: Promise<StoredMedia> | null = null;

  /** A lease for the one that died; reads that failed together share it. */
  const renew = (dead: StoredMedia): Promise<StoredMedia> => {
    if (lease !== dead) return Promise.resolve(lease);
    return (renewing ??= (async () => {
      try {
        const fresh = await open();
        if (!fresh) throw new MediaMissing();
        if (fresh.size !== first.size) throw new MediaReadError(`the stored file is ${fresh.size} bytes now, not ${first.size}`);
        lease = fresh;
        return fresh;
      } finally {
        renewing = null;
      }
    })());
  };

  return {
    assetId,
    size: first.size,
    type: first.type,
    async read(start, end) {
      let used = lease;
      let firstError: unknown;
      for (let attempt = 0; ; attempt++) {
        try {
          const bytes = await readFrom(used, start, end);
          if (attempt > 0) deps.report?.({ assetId, healed: true, attempts: attempt, error: nameOf(firstError) });
          return bytes;
        } catch (e) {
          if (isStorageError(e)) throw e;
          if (!leaseDied(e)) throw e; // a range outside the file or a missing chunk is not cured by a new lease
          firstError ??= e;
          const spent = attempt >= RENEW_PAUSES_MS.length;
          if (spent || !allowRenewal(assetId, now())) {
            deps.report?.({ assetId, healed: false, attempts: attempt, error: nameOf(firstError) });
            throw new MediaReadError(spent ? 'new leases did not read either' : 'too many new leases in a minute', { cause: firstError });
          }
          await sleep(RENEW_PAUSES_MS[attempt]);
          try {
            used = await renew(used);
          } catch (r) {
            if (isStorageError(r)) { deps.report?.({ assetId, healed: false, attempts: attempt + 1, error: nameOf(firstError) }); throw r; }
            if (!leaseDied(r)) throw r;
            // The storage itself failed to answer: the next turn tries again with the same dead lease.
          }
        }
      }
    },
  };
}
