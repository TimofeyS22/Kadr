// No wait in Kadr is endless (docs/12 G2, stage 2): a browser API that never answers — a capability query, a
// recorder that never says it stopped, a decoder in a worker that hangs — gets a time limit and a way out.

/** `p`, or what `fallback` gives (or throws) once `ms` pass without an answer. */
export function within<T>(p: Promise<T>, ms: number, fallback: () => T | Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => { try { resolve(fallback()); } catch (e) { reject(e); } }, ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * Reads a response body chunk by chunk. A body that sends nothing for `stallMs` (the connection hung, the phone
 * slept) fails with `stalled()` instead of waiting forever; Cancel works throughout.
 */
export async function readBody(
  res: Response, onChunk: (chunk: Uint8Array<ArrayBuffer>) => void | Promise<void>, stallMs: number, stalled: () => Error, signal?: AbortSignal,
): Promise<void> {
  if (!res.body) throw stalled();
  const reader = res.body.getReader();
  const abort = () => void reader.cancel().catch(() => undefined);
  const cancelled = () => new DOMException('Cancelled', 'AbortError');
  signal?.addEventListener('abort', abort);
  let finished = false;
  try {
    for (;;) {
      if (signal?.aborted) throw cancelled();
      const { done, value } = await within(reader.read(), stallMs, () => { throw stalled(); });
      if (signal?.aborted) throw cancelled(); // a cancelled reader reads as done: that is not the end of the file
      if (done) { finished = true; return; }
      await onChunk(value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!finished) abort(); // stalled, cancelled or failed: the connection is let go
  }
}
