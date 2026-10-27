/// <reference lib="webworker" />
// Diagnostics (`?diag`, docs/12 stage 0): can this device reserve a WebAssembly memory of this size? One worker per
// try, ended right after, so a big reservation that succeeds is let go and never crowds the speech engine.
self.onmessage = (e: MessageEvent<{ mb: number; shared: boolean }>) => {
  const { mb, shared } = e.data;
  try {
    new WebAssembly.Memory({ initial: 256, maximum: mb * 16, shared });
    postMessage({ ok: true });
  } catch (err) {
    postMessage({ ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
