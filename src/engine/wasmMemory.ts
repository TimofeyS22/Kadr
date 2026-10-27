// ONNX Runtime Web creates its heap as a shared WebAssembly memory with a 4 GB maximum, whatever the thread count.
// A shared memory cannot move when it grows, so the browser reserves its whole maximum up front, and iOS Safari
// cannot reserve 4 GB: "RangeError: Out of memory", then "no available backend found" — speech never started on
// iPhone (docs/12 §1.2). The module accepts a smaller maximum (an import may promise less than it asks for).

/** Heap maximums to try, largest first: as much room as the device lets us reserve, never 4 GB. */
export const HEAP_CAPS_MB = [1024, 768, 512, 384];

const PAGES_PER_MB = 16; // 64 KiB pages

export interface HeapInfo {
  /** The maximum the capped heap got, MB; null until one was made. */
  capMb: number | null;
  /** Its current size, MB. */
  mb: number | null;
  /** Maximums the browser refused to reserve before that. */
  refused: number[];
}

/**
 * Replaces `wasm.Memory` so a shared memory asking for more than `caps[0]` gets the largest of `caps` the browser
 * will reserve. Other memories are untouched. Returns what the capped heap got, for diagnostics. Idempotent.
 */
export function capSharedMemory(wasm: { Memory: typeof WebAssembly.Memory } = WebAssembly, caps = HEAP_CAPS_MB): () => HeapInfo {
  const Native = wasm.Memory as typeof WebAssembly.Memory & { heapInfo?: () => HeapInfo };
  if (Native.heapInfo) return Native.heapInfo;
  let heap: WebAssembly.Memory | null = null;
  let capMb: number | null = null;
  const refused: number[] = [];
  function Capped(d: WebAssembly.MemoryDescriptor): WebAssembly.Memory {
    if (!d.shared || (d.maximum ?? Infinity) <= caps[0] * PAGES_PER_MB) return new Native(d);
    for (const mb of caps) {
      if (mb * PAGES_PER_MB < d.initial) break;
      try {
        heap = new Native({ ...d, maximum: mb * PAGES_PER_MB });
        capMb = mb;
        return heap;
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        refused.push(mb);
      }
    }
    return new Native(d); // nothing smaller fits either: the original request fails with the browser's own error
  }
  const heapInfo = (): HeapInfo => ({ capMb, mb: heap ? heap.buffer.byteLength / 2 ** 20 : null, refused: [...refused] });
  Capped.prototype = Native.prototype; // `instanceof WebAssembly.Memory` still holds
  Capped.heapInfo = heapInfo;
  Object.defineProperty(wasm, 'Memory', { value: Capped, writable: true, configurable: true });
  return heapInfo;
}
