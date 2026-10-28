/// <reference lib="webworker" />
// Diagnostics (`?diag`, docs/12 stages 0–1): what WebAssembly memory and big ArrayBuffers this device lets one
// process reserve. One worker per try, ended right after, so a reservation that succeeds is let go and never crowds
// the speech engine.
//
// The pool (docs/12 §1.3 item 14): on iOS every ArrayBuffer and WebAssembly memory of the process shares one region
// of address space (16 GiB), and both a 4 GiB memory and a resizable ArrayBuffer with a 4 GiB maxByteLength (each
// live mediabunny BufferTarget holds one) reserve all of it up front. If that region is what runs out, the speech
// heap fails while such buffers are alive, though it fits on its own.

const GIB4 = 2 ** 32;
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
const held: unknown[] = []; // kept alive until the worker ends

/** A shared WebAssembly memory with this maximum, as ONNX Runtime asks for (16 MB to start). */
const heap = (mb: number) => new WebAssembly.Memory({ initial: 256, maximum: mb * 16, shared: true });
/** One 4 GiB reservation of the kind. */
const big = (kind: 'shared' | 'resizable') => (kind === 'shared'
  ? new WebAssembly.Memory({ initial: 1, maximum: 65536, shared: true })
  : new (ArrayBuffer as new (n: number, o: { maxByteLength: number }) => ArrayBuffer)(2 ** 16, { maxByteLength: GIB4 }));

export type DiagAsk =
  | { mb: number; shared: boolean } // one memory of this maximum
  | { op: 'count'; kind: 'shared' | 'resizable'; max: number } // 4 GiB reservations kept one after another
  | { op: 'hold'; kind: 'resizable'; n: number } // keep n, answer, stay alive until ended
  | { op: 'heap'; mb: number; hold: number }; // keep `hold` resizable 4 GiB buffers, then the speech heap

self.onmessage = (e: MessageEvent<DiagAsk>) => {
  const ask = e.data;
  if (!('op' in ask)) {
    try {
      new WebAssembly.Memory({ initial: 256, maximum: ask.mb * 16, shared: ask.shared });
      postMessage({ ok: true });
    } catch (err) {
      postMessage({ ok: false, error: errText(err) });
    }
    return;
  }
  const n = ask.op === 'count' ? ask.max : ask.op === 'hold' ? ask.n : ask.hold;
  const kind = ask.op === 'count' ? ask.kind : 'resizable';
  if (kind === 'resizable' && !('resize' in ArrayBuffer.prototype)) return postMessage({ ok: false, count: 0, error: 'resizable ArrayBuffer not supported' });
  let count = 0;
  try {
    for (; count < n; count++) held.push(big(kind));
  } catch (err) {
    return postMessage({ ok: ask.op === 'count', count, error: errText(err) });
  }
  if (ask.op !== 'heap') return postMessage({ ok: true, count });
  try {
    held.push(heap(ask.mb));
    postMessage({ ok: true, count });
  } catch (err) {
    postMessage({ ok: false, count, error: errText(err) });
  }
};
