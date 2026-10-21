import type { Output } from 'mediabunny';

/**
 * Ends an output after an error. A cancel lets the encoders finish what they hold, then the file is thrown away:
 * closed mid-encode, WebKit's AAC encoder fails inside and the page gets an uncaught "encoding failed" (QA §3.5).
 */
export async function abandon(output: Output, signal: AbortSignal, sources: { close(): void }[]): Promise<void> {
  try {
    if (!signal.aborted) throw new Error('not a cancel');
    for (const s of sources) s.close();
    await output.finalize();
  } catch {
    await output.cancel().catch(() => undefined);
  }
}
