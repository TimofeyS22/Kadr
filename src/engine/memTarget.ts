// An output file kept in memory without reserving address space (docs/12 §1.3 item 14). mediabunny's BufferTarget
// grows one resizable ArrayBuffer with a 4 GiB maxByteLength, and WebKit reserves the whole 4 GiB at once, from the
// one pool every ArrayBuffer and WebAssembly memory of the process shares — the speech worker's heap included.
// Measured in WebKit on a Mac: ten such buffers on the main thread leave a worker 5 of its 14 memories of 4 GiB.
// The reservation goes only when the main thread collects garbage, which the speech worker cannot make happen, and
// iOS has a fraction of a Mac's pool. Here the file is the chunks mediabunny writes, put together once at the end.
import { StreamTarget, type StreamTargetChunk } from 'mediabunny';

type Part = { data: Uint8Array<ArrayBuffer>; position: number };

export class MemoryTarget extends StreamTarget {
  private readonly parts: Part[];

  constructor() {
    const parts: Part[] = [];
    super(new WritableStream<StreamTargetChunk>({
      // A chunk is a fresh array (or a part of one mediabunny lets go): kept as it is, not copied.
      write: (c) => { parts.push({ data: c.data as Uint8Array<ArrayBuffer>, position: c.position }); },
    }));
    this.parts = parts;
  }

  /** The finished file. The chunks are let go: call it once, after `output.finalize()`. */
  blob(type = ''): Blob {
    let end = 0;
    let appended = true; // written front to back without going back: the chunks are the file as they are
    for (const p of this.parts) {
      if (p.position !== end) appended = false;
      end = Math.max(end, p.position + p.data.byteLength);
    }
    if (!end) throw new Error('The output has no data');
    const blob = new Blob(appended ? this.parts.map((p) => p.data) : [this.assemble(end)], { type });
    this.parts.length = 0;
    return blob;
  }

  /** The finished file as one buffer (decodeAudioData takes nothing else). The chunks are let go. */
  buffer(): ArrayBuffer {
    const end = this.parts.reduce((e, p) => Math.max(e, p.position + p.data.byteLength), 0);
    if (!end) throw new Error('The output has no data');
    const out = this.assemble(end);
    this.parts.length = 0;
    return out.buffer;
  }

  /** Later writes over earlier ones, in the order they came (the muxer patches sizes in place). */
  private assemble(end: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(end);
    for (const p of this.parts) out.set(p.data, p.position);
    return out;
  }
}
