// The door to a stored file's bytes (docs/19 §10): a lease that dies is replaced, a file that is gone or broken says so.
import { beforeEach, describe, expect, it } from 'vitest';
import type { ChunkedMedia, StoredMedia } from './chunks';
import { MediaMissing, MediaReadError, RENEWALS_PER_MINUTE, isStorageError, leasedReader, resetRenewals, type LeaseEvent } from './reader';

const BYTES = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
/** WebKit's own words for a Blob whose backing is gone (S-1-13, on the iPhone). */
const gone = () => new DOMException('The object can not be found here.', 'NotFoundError');

/** A lease of the test file that reads `alive` times, then dies. */
function lease(alive = Infinity, bytes = BYTES): ChunkedMedia & { reads: number } {
  const l = {
    size: bytes.length, type: 'video/mp4', reads: 0,
    async read(start: number, end: number) {
      if (l.reads++ >= alive) throw gone();
      return bytes.slice(start, end);
    },
  };
  return l;
}

/** A storage that hands out the given leases in turn, and counts how often it was asked. */
function storage(...leases: (StoredMedia | undefined)[]) {
  const s = { opened: 0, open: async () => leases[Math.min(s.opened++, leases.length - 1)] };
  return s;
}

const pauses: number[] = [];
const events: LeaseEvent[] = [];
const deps = { sleep: async (ms: number) => { pauses.push(ms); }, report: (e: LeaseEvent) => events.push(e) };

beforeEach(() => { resetRenewals(); pauses.length = 0; events.length = 0; });

describe('a stored file read through the door', () => {
  it('a lease that dies is replaced, and the read gives the same bytes without a word (S-1-13)', async () => {
    const s = storage(lease());
    const r = leasedReader('a', lease(1), s.open, deps);
    expect(await r.read(0, 10)).toEqual(BYTES.slice(0, 10));
    expect(await r.read(500, 900)).toEqual(BYTES.slice(500, 900));
    expect(await r.read(990, 1000)).toEqual(BYTES.slice(990, 1000));
    expect(s.opened).toBe(1);
    expect(pauses).toEqual([50]);
    expect(events).toEqual([{ assetId: 'a', healed: true, attempts: 1, error: 'NotFoundError' }]);
  });

  it('reads that fail together take one new lease between them', async () => {
    const s = storage(lease());
    const r = leasedReader('a', lease(0), s.open, deps);
    const got = await Promise.all([r.read(0, 100), r.read(100, 200), r.read(900, 1000)]);
    expect(got).toEqual([BYTES.slice(0, 100), BYTES.slice(100, 200), BYTES.slice(900, 1000)]);
    expect(s.opened).toBe(1);
  });

  it('a file whose new leases die too is a read error of the storage, not of the decoder', async () => {
    const s = storage(lease(0), lease(0), lease(0));
    const r = leasedReader('a', lease(0), s.open, deps);
    const e = await r.read(0, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MediaReadError);
    expect(isStorageError(e)).toBe(true);
    expect((e as MediaReadError).cause).toBeInstanceOf(DOMException);
    expect(s.opened).toBe(2);
    expect(pauses).toEqual([50, 250]);
    expect(events.at(-1)).toMatchObject({ healed: false, error: 'NotFoundError' });
  });

  it('a record that is gone is said to be missing at once, without more tries', async () => {
    const s = storage(undefined);
    const e = await leasedReader('a', lease(0), s.open, deps).read(0, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MediaMissing);
    expect(s.opened).toBe(1);
  });

  it('a new lease of another size is refused: bytes that are not the file\'s never reach a decoder', async () => {
    const other = lease(Infinity, BYTES.slice(0, 999));
    const e = await leasedReader('a', lease(0), storage(other).open, deps).read(0, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(MediaReadError);
    expect(other.reads).toBe(0);
  });

  it('an error that a new lease cannot cure goes up as it is, with no new lease', async () => {
    const s = storage(lease());
    const broken: ChunkedMedia = { size: 1000, type: 'video/mp4', read: async () => { throw new RangeError('Bytes 0 to 2000 are outside a stored file of 1000'); } };
    await expect(leasedReader('a', broken, s.open, deps).read(0, 10)).rejects.toThrow(RangeError);
    expect(s.opened).toBe(0);
  });

  it('a storage that fails to answer once is asked again', async () => {
    let calls = 0;
    const open = async () => { if (calls++ === 0) throw new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'); return lease(); };
    expect(await leasedReader('a', lease(0), open, deps).read(0, 10)).toEqual(BYTES.slice(0, 10));
    expect(calls).toBe(2);
  });

  it('a file that keeps dying is not opened in a loop (docs/19 С14)', async () => {
    let opened = 0;
    const open = async () => { opened++; return lease(1); }; // every lease reads once, then dies
    const r = leasedReader('a', lease(0), open, { ...deps, now: () => 1000 });
    for (let i = 0; i < RENEWALS_PER_MINUTE; i++) await r.read(0, 10);
    expect(opened).toBe(RENEWALS_PER_MINUTE);
    await expect(r.read(0, 10)).rejects.toBeInstanceOf(MediaReadError);
    expect(opened).toBe(RENEWALS_PER_MINUTE);
    // A minute later the file may try again.
    const later = leasedReader('a', lease(0), open, { ...deps, now: () => 61_001 });
    expect(await later.read(0, 10)).toEqual(BYTES.slice(0, 10));
  });

  it('reads that fail together count once against the fuse, and a tripped fuse does not stick past its minute', async () => {
    let opened = 0, clock = 1000;
    const open = async () => { opened++; return lease(3); }; // every lease reads three times, then dies
    const r = leasedReader('a', lease(0), open, { ...deps, now: () => clock });
    for (let i = 0; i < RENEWALS_PER_MINUTE; i++) await Promise.all([r.read(0, 10), r.read(10, 20), r.read(20, 30)]);
    expect(opened, 'one new lease for three reads each time').toBe(RENEWALS_PER_MINUTE);
    await expect(Promise.all([r.read(0, 10), r.read(10, 20), r.read(20, 30)])).rejects.toBeInstanceOf(MediaReadError);
    clock += 61_000;
    expect(await r.read(0, 10)).toEqual(BYTES.slice(0, 10));
  });

  it('a Blob lease is read in slices, and a dead Blob is replaced too', async () => {
    class DeadBlob extends Blob {
      override slice(): Blob { return { arrayBuffer: () => Promise.reject(gone()) } as unknown as Blob; }
    }
    const r = leasedReader('a', new DeadBlob([BYTES], { type: 'video/mp4' }), storage(new Blob([BYTES], { type: 'video/mp4' })).open, deps);
    expect(r.size).toBe(1000);
    expect(r.type).toBe('video/mp4');
    expect(await r.read(10, 20)).toEqual(BYTES.slice(10, 20));
  });
});
