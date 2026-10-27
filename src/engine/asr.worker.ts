/// <reference lib="webworker" />
// Speech recognition worker: Whisper via transformers.js (ONNX Runtime WASM), and GigaAM v3 for Russian (v1.4).
// Audio never leaves the device; only the model files are downloaded once (and cached by the browser).
import { AutoModel, Tensor, env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { ctcDecode, gigaamFeatures, parseCtcVocab, type CtcVocab } from '../core/gigaam';
import { alignScript, type ScriptCaptions } from '../core/script';
import type { CaptionWord } from '../core/types';
import { capSharedMemory, type HeapInfo } from './wasmMemory';

/** Whisper sizes, and 'ru': GigaAM v3, Russian only, far more accurate on Russian speech (docs/10). */
export type AsrModel = 'tiny' | 'base' | 'small' | 'ru';
export type AsrRequest =
  | { type: 'load'; model: AsrModel }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null; model: AsrModel }
  | { type: 'detect'; id: number; audio: Float32Array; candidates: string[] }
  | { type: 'align'; id: number; script: string; words: CaptionWord[]; speech: [number, number][] }
  | { type: 'vad'; id: number; audio: Float32Array }
  | { type: 'heap'; id: number };
export type AsrResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; words: { t0: number; t1: number; text: string }[]; confidence?: number; chars?: number }
  | { type: 'vad'; id: number; probs: Float32Array }
  | { type: 'language'; id: number; code: string; p: number }
  | { type: 'aligned'; id: number; result: ScriptCaptions | null }
  | ({ type: 'heap'; id: number } & HeapInfo)
  | { type: 'error'; id?: number; message: string; heap: HeapInfo };

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX Runtime's heap below 4 GB, or iOS cannot reserve it and speech never starts (docs/12 §1.2).
const heapInfo = capSharedMemory();
// ONNX Runtime WASM, the plain CPU build (~14 MB), from our own origin. transformers.js would take the asyncify build
// (for WebGPU, which we don't use) from a CDN; in WebKit that build peaks several times higher (onnxruntime#33516).
// In development the files are served from public/ort (scripts/copy-assets.mjs --dev).
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string | { mjs: string; wasm: string }; numThreads?: number } };
if (onnx.wasm) {
  const at = (file: string) => new URL(import.meta.env.DEV ? `/ort/${file}` : file, self.location.href).href;
  onnx.wasm.wasmPaths = { mjs: at(import.meta.env.DEV ? 'ort-wasm-simd-threaded.mjs' : ortMjs), wasm: at(import.meta.env.DEV ? 'ort-wasm-simd-threaded.wasm' : ortWasm) };
  if (!self.crossOriginIsolated) onnx.wasm.numThreads = 1;
}

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModel: Exclude<AsrModel, 'ru'> | null = null;
const post = (m: AsrResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Reports the download of a model's files as one total. */
function downloadProgress() {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: 'download', loaded, total });
  };
}

function load(model: AsrModel): Promise<unknown> {
  if (model === 'ru') return loadGigaam();
  if (asr && loadedModel === model) return asr;
  releaseGigaam(); // one big model in memory at a time: phones have little of it
  const prev = asr;
  loadedModel = model;
  asr = pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: downloadProgress(),
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; loadedModel = null; });
  void prev?.then((x) => x.dispose(), () => undefined);
  return asr;
}

// GigaAM v3 end-to-end CTC (Sber, MIT; int8 ONNX export by istupakov, pinned): 225 MB, punctuated text.
const GIGAAM_REPO = 'istupakov/gigaam-v3-onnx';
const GIGAAM_REV = '322c3b29492673eb7d0b434bfa9dfb8653e34d02';
type Ctc = ((inputs: Record<string, Tensor>) => Promise<{ log_probs: Tensor }>) & { dispose(): Promise<unknown> };
let giga: Promise<{ run: Ctc; vocab: CtcVocab }> | null = null;

/** A small file from the model repo, kept in the Cache API so captions work offline after the first time. */
async function cachedText(url: string): Promise<string> {
  const cache = await caches.open('kadr-models').catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.text();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await cache?.put(url, res.clone()).catch(() => undefined);
  return res.text();
}

function loadGigaam(): Promise<{ run: Ctc; vocab: CtcVocab }> {
  if (giga) return giga;
  const prev = asr;
  asr = null; loadedModel = null; // one big model in memory at a time
  void prev?.then((x) => x.dispose(), () => undefined);
  giga = Promise.all([
    AutoModel.from_pretrained(GIGAAM_REPO, {
      config: { model_type: 'custom' } as never, model_file_name: 'v3_e2e_ctc.int8', subfolder: '', dtype: 'fp32', device: 'wasm',
      revision: GIGAAM_REV, progress_callback: downloadProgress(),
    }) as unknown as Promise<Ctc>,
    cachedText(`https://huggingface.co/${GIGAAM_REPO}/resolve/${GIGAAM_REV}/v3_e2e_ctc_vocab.txt`),
  ]).then(([run, text]) => ({ run, vocab: parseCtcVocab(text) }));
  giga.catch(() => { giga = null; });
  return giga;
}

function releaseGigaam(): void {
  void giga?.then((g) => g.run.dispose(), () => undefined);
  giga = null;
}

/** GigaAM on ≤ 30 s of 16 kHz audio: timed words, and how sure it was (low on speech in other languages). */
async function gigaamTranscribe(audio: Float32Array): Promise<{ words: CaptionWord[]; confidence: number; chars: number }> {
  const { run, vocab } = await loadGigaam();
  const { data, frames } = gigaamFeatures(audio);
  if (!frames) return { words: [], confidence: 0, chars: 0 };
  const { log_probs: lp } = await run({
    features: new Tensor('float32', data, [1, 64, frames]),
    feature_lengths: new Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
  });
  const [, steps, classes] = lp.dims;
  const r = ctcDecode(lp.data as Float32Array, steps, classes, vocab);
  lp.dispose();
  return r;
}

interface WordChunk { text: string; timestamp: [number, number | null] }

// Silero VAD v5 (≈2 MB): speech probability per 512-sample frame at 16 kHz, with 64 samples of context.
type Vad = (inputs: Record<string, Tensor>) => Promise<{ output: Tensor; stateN: Tensor }>;
let vad: Promise<Vad> | null = null;
const loadVad = () => (vad ??= AutoModel.from_pretrained('onnx-community/silero-vad', {
  config: { model_type: 'custom' } as never, dtype: 'fp32', device: 'wasm',
}) as unknown as Promise<Vad>);

async function speechProbabilities(audio: Float32Array): Promise<Float32Array> {
  const model = await loadVad();
  const N = 512, CTX = 64;
  const sr = new Tensor('int64', BigInt64Array.from([16000n]), []);
  let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  const probs = new Float32Array(Math.floor(audio.length / N));
  const buf = new Float32Array(CTX + N);
  for (let i = 0; i < probs.length; i++) {
    buf.copyWithin(0, N, N + CTX); // previous chunk's tail becomes the context
    buf.set(audio.subarray(i * N, i * N + N), CTX);
    const out = await model({ input: new Tensor('float32', buf.slice(), [1, CTX + N]), sr, state });
    state = out.stateN;
    probs[i] = (out.output.data as Float32Array)[0];
  }
  return probs;
}

/**
 * Whisper's own language detection, which transformers.js lacks (without a language it silently assumes English and
 * so translates other speech): one decoder step after <|startoftranscript|>. Returns the most likely of `candidates`
 * (ISO codes) and its probability among all languages.
 */
async function detectLanguage(run: AutomaticSpeechRecognitionPipeline, audio: Float32Array, candidates: string[]): Promise<{ code: string; p: number }> {
  const { input_features } = (await run.processor(audio)) as { input_features: Tensor };
  const cfg = run.model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  const forward = run.model as unknown as (x: Record<string, Tensor>) => Promise<{ logits: Tensor }>;
  const { logits } = await forward({
    input_features,
    decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(cfg.decoder_start_token_id)]), [1, 1]),
  });
  const l = logits.data as Float32Array;
  const all = Object.entries(cfg.lang_to_id).map(([tok, id]) => ({ code: tok.slice(2, -2), x: l[id] }));
  const max = Math.max(...all.map((a) => a.x));
  const sum = all.reduce((s, a) => s + Math.exp(a.x - max), 0);
  const best = all.filter((a) => candidates.includes(a.code)).sort((a, b) => b.x - a.x)[0];
  return best ? { code: best.code, p: Math.exp(best.x - max) / sum } : { code: 'en', p: 0 };
}

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model);
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'heap') {
      post({ type: 'heap', id: msg.id, ...heapInfo() });
      return;
    }
    if (msg.type === 'align') { // pure CPU work, off the main thread so a long talk never freezes the UI
      post({ type: 'aligned', id: msg.id, result: alignScript(msg.script, msg.words, msg.speech) });
      return;
    }
    if (msg.type === 'vad') {
      const probs = await speechProbabilities(msg.audio);
      post({ type: 'vad', id: msg.id, probs }, [probs.buffer]);
      return;
    }
    if (msg.type === 'transcribe' && msg.model === 'ru') {
      post({ type: 'result', id: msg.id, ...(await gigaamTranscribe(msg.audio)) });
      return;
    }
    const run = await (asr ?? (load('tiny') as Promise<AutomaticSpeechRecognitionPipeline>));
    if (msg.type === 'detect') {
      post({ type: 'language', id: msg.id, ...(await detectLanguage(run, msg.audio, msg.candidates)) });
      return;
    }
    const out = await run(msg.audio, {
      return_timestamps: 'word',
      ...(msg.language ? { language: msg.language, task: 'transcribe' } : {}),
    });
    const chunks = ((Array.isArray(out) ? out[0] : out) as { chunks?: WordChunk[] }).chunks ?? [];
    const words = chunks
      .map((c) => ({ t0: c.timestamp[0], t1: c.timestamp[1] ?? c.timestamp[0] + 0.3, text: c.text.trim() }))
      .filter((w) => w.text);
    post({ type: 'result', id: msg.id, words });
  } catch (err) {
    post({ type: 'error', id: msg.type !== 'load' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err), heap: heapInfo() });
  }
};
