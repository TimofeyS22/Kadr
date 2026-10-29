/// <reference lib="webworker" />
// Speech recognition worker: Whisper via transformers.js (ONNX Runtime WASM); for Russian, GigaAM v3 (v1.4) and, on
// phones, FastConformer (v1.4.18). Audio never leaves the device; only the model files are downloaded once (and kept).
import { AutoModel, Tensor, env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { NEMO_FRAME_S, nemoFeatures } from '../core/fastconformer';
import { ctcDecode, gigaamFeatures, parseCtcVocab, type CtcVocab } from '../core/gigaam';
import { alignScript, type ScriptCaptions } from '../core/script';
import type { CaptionWord } from '../core/types';
import { ensureFile, isLarge, isModelFileName, keptFile, legacySmall, mirrored, modelHosts, modelKey, probeAnswer, setModelHosts, smallFile } from './modelFiles';
import { capSharedMemory, type HeapInfo } from './wasmMemory';

/**
 * Whisper sizes; 'ru': GigaAM v3, Russian only, the most accurate on Russian speech (docs/10); 'ru-fast':
 * FastConformer, Russian only, 131 MB, for phones (docs/12 §6.3).
 */
export type AsrModel = 'tiny' | 'base' | 'small' | 'ru' | 'ru-fast';
type WhisperModel = Exclude<AsrModel, 'ru' | 'ru-fast'>;
type CtcModel = Extract<AsrModel, 'ru' | 'ru-fast'>;
export type AsrRequest =
  | { type: 'load'; id: number; model: AsrModel }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null; model: AsrModel }
  | { type: 'detect'; id: number; audio: Float32Array; candidates: string[] }
  | { type: 'align'; id: number; script: string; words: CaptionWord[]; speech: [number, number][] }
  | { type: 'vad'; id: number; audio: Float32Array }
  | { type: 'heap'; id: number };
export type AsrResponse =
  | { type: 'download'; id: number; loaded: number; total: number }
  | { type: 'ready'; id: number }
  | { type: 'result'; id: number; words: { t0: number; t1: number; text: string }[]; confidence?: number; chars?: number }
  | { type: 'vad'; id: number; probs: Float32Array }
  | { type: 'language'; id: number; code: string; p: number }
  | { type: 'aligned'; id: number; result: ScriptCaptions | null }
  | ({ type: 'heap'; id: number } & HeapInfo)
  | { type: 'error'; id: number; message: string; heap: HeapInfo };

env.allowLocalModels = false;
// Where model files come from (modelFiles.ts, docs/12 stage 5): Kadr's own site first, then Hugging Face — or, in a
// build with VITE_MODEL_HOST=/hf/, a relay on the build's own origin (vite.config.ts; the iOS Simulator behind this
// Mac's VPN cannot resolve huggingface.co). The dev server has no copy of the models.
setModelHosts({
  own: import.meta.env.DEV ? null : new URL(`${import.meta.env.BASE_URL}models/`, self.location.origin).href,
  ranges: import.meta.env.VITE_MODEL_HOST ? new URL(import.meta.env.VITE_MODEL_HOST as string, self.location.href).href : 'https://huggingface.co/',
});
env.remoteHost = modelHosts().own ?? modelHosts().ranges;
// Large files come part by part, checked and resumable; small ones (configs, tokenizers) whole and checked, then
// kept in the Cache API as before.
const small = caches.open('transformers-cache').catch(() => null);
const largeKey = (req: string) => { const key = modelKey(req); return key && isLarge(key) ? key : null; };
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  match: async (req: string) => {
    const url = String(req), key = modelKey(url);
    if (key && isLarge(key)) return keptFile(key);
    const cache = await small;
    const hit = await cache?.match(url);
    if (hit || !key || !cache) return hit;
    const old = await legacySmall(cache, key); // kept under its Hugging Face address by Kadr ≤ 1.4.17
    if (old) await cache.put(url, old.clone()).catch(() => undefined);
    return old;
  },
  put: async (req: string, res: Response) => { if (!largeKey(String(req))) await (await small)?.put(String(req), res); },
};
const plainFetch = env.fetch;
env.fetch = async (input: string | URL, init?: RequestInit) => {
  const key = modelKey(String(input));
  if (!key) return unlisted(String(input), init);
  // transformers.js asks for one byte (Range: bytes=0-0) to learn that a file exists and its size: known already.
  if (new Headers(init?.headers).get('range') === 'bytes=0-0') return probeAnswer(key)!;
  if (!isLarge(key)) return smallFile(key);
  await ensureFile(key, (loaded, total) => fileProgress?.(key, loaded, total));
  const kept = await keptFile(key);
  if (kept) return kept;
  console.warn('model parts were not kept (storage); the file comes whole', key);
  return plainFetch(modelHosts().ranges + key, init); // a storage that does not keep must not stop captions
};

/**
 * A file models.json does not list (an optional one transformers.js looks for). Kadr's site answers for the
 * repositories it mirrors (a 404 there means the file does not exist); the rest goes to Hugging Face. A phone that
 * changes networks mid-request ("network changed") gets two more tries.
 */
async function unlisted(url: string, init?: RequestInit): Promise<Response> {
  const { own, ranges } = modelHosts();
  const target = own && url.startsWith(own) && !mirrored(url.slice(own.length)) ? ranges + url.slice(own.length) : url;
  for (let attempt = 1; ; attempt++) {
    try { return await plainFetch(target, init); } catch (e) {
      if (attempt === 3 || !(e instanceof TypeError)) throw e;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}
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

/** Whisper revisions the checksums in models.json were made from (scripts/model-manifest.mjs). */
const WHISPER_REV: Record<WhisperModel, string> = {
  tiny: '517244293732ee2d58139af5814231b7e6830a0d',
  base: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
  small: '65caa70f294b46e1c33ff820aae6b16d048ab818',
};

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModel: WhisperModel | null = null;
const post = (m: AsrResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Progress of a large file coming part by part (env.fetch above), for the model being loaded. */
let fileProgress: ((file: string, loaded: number, total: number) => void) | null = null;

/** Reports the download of a model's files as one total, as the answer to load request `id`. */
function downloadProgress(id: number) {
  const files = new Map<string, { loaded: number; total: number }>();
  const report = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: 'download', id, loaded, total });
  };
  fileProgress = (file, loaded, total) => report({ status: 'progress', file, loaded, total });
  // transformers.js reads a large file again from its kept parts: counted once, under the part loader's name.
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => { if (!p.file || !isModelFileName(p.file)) report(p); };
}

function load(model: AsrModel, id = 0): Promise<unknown> {
  if (model === 'ru' || model === 'ru-fast') return loadCtc(model, id);
  if (asr && loadedModel === model) return asr;
  releaseCtc(); // one big model in memory at a time: phones have little of it
  const prev = asr;
  loadedModel = model;
  asr = pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
    device: 'wasm',
    dtype: 'q8',
    revision: WHISPER_REV[model], // pinned: the files must match their checksums in models.json
    progress_callback: downloadProgress(id),
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; loadedModel = null; });
  void prev?.then((x) => x.dispose(), () => undefined);
  return asr;
}

// Russian CTC models, int8 ONNX exports by istupakov, pinned; punctuated text. One big model in memory at a time.
// GigaAM v3 end-to-end (Sber, MIT): 225 MB, the most accurate. FastConformer Hybrid Large RU P&C (NVIDIA, CC BY 4.0):
// 131 MB, for phones, whose memory GigaAM's ~480 MB heap does not fit (docs/12 §6.3).
const CTC: Record<CtcModel, { repo: string; rev: string; file: string; vocab: string }> = {
  ru: { repo: 'istupakov/gigaam-v3-onnx', rev: '322c3b29492673eb7d0b434bfa9dfb8653e34d02', file: 'v3_e2e_ctc.int8', vocab: 'v3_e2e_ctc_vocab.txt' },
  'ru-fast': { repo: 'istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx', rev: 'fb6753736c56de3259d78a26a488548c84b9dccb', file: 'model.int8', vocab: 'vocab.txt' },
};
type Ctc = ((inputs: Record<string, Tensor>) => Promise<Record<string, Tensor>>) & { dispose(): Promise<unknown> };
let ctc: { model: CtcModel; ready: Promise<{ run: Ctc; vocab: CtcVocab }> } | null = null;

/** A small file from a model repo, kept in the Cache API so captions work offline after the first time. */
async function cachedText(key: string): Promise<string> {
  const cache = await caches.open('kadr-models').catch(() => null);
  const at = `https://huggingface.co/${key}`; // the name it has been kept under since v1.4, whatever host it came from
  const hit = await cache?.match(at);
  if (hit) return hit.text();
  const res = await smallFile(key);
  await cache?.put(at, res.clone()).catch(() => undefined);
  return res.text();
}

function loadCtc(model: CtcModel, id = 0): Promise<{ run: Ctc; vocab: CtcVocab }> {
  if (ctc?.model === model) return ctc.ready;
  releaseCtc();
  const prev = asr;
  asr = null; loadedModel = null;
  void prev?.then((x) => x.dispose(), () => undefined);
  const m = CTC[model];
  const ready = Promise.all([
    AutoModel.from_pretrained(m.repo, {
      config: { model_type: 'custom' } as never, model_file_name: m.file, subfolder: '', dtype: 'fp32', device: 'wasm',
      revision: m.rev, progress_callback: downloadProgress(id),
    }) as unknown as Promise<Ctc>,
    cachedText(`${m.repo}/resolve/${m.rev}/${m.vocab}`),
  ]).then(([run, text]) => ({ run, vocab: parseCtcVocab(text) }));
  const entry = { model, ready };
  ctc = entry;
  ready.catch(() => { if (ctc === entry) ctc = null; });
  return ready;
}

function releaseCtc(): void {
  void ctc?.ready.then((g) => g.run.dispose(), () => undefined);
  ctc = null;
}

/** A Russian CTC model on ≤ 30 s of 16 kHz audio: timed words, and how sure it was (low on speech in other languages). */
async function ctcTranscribe(model: CtcModel, audio: Float32Array): Promise<{ words: CaptionWord[]; confidence: number; chars: number }> {
  const { run, vocab } = await loadCtc(model);
  const none = { words: [], confidence: 0, chars: 0 };
  if (model === 'ru') {
    const { data, frames } = gigaamFeatures(audio);
    if (!frames) return none;
    const { log_probs: lp } = await run({
      features: new Tensor('float32', data, [1, 64, frames]),
      feature_lengths: new Tensor('int64', BigInt64Array.from([BigInt(frames)]), [1]),
    });
    const [, steps, classes] = lp.dims;
    const r = ctcDecode(lp.data as Float32Array, steps, classes, vocab);
    lp.dispose();
    return r;
  }
  const { data, frames, length } = nemoFeatures(audio);
  if (length < 2) return none;
  const { logprobs: lp } = await run({
    audio_signal: new Tensor('float32', data, [1, 80, frames]),
    length: new Tensor('int64', BigInt64Array.from([BigInt(length)]), [1]),
  });
  const [, steps, classes] = lp.dims;
  // Only the encoder's valid frames: (length - 1) / 8 + 1 (onnx-asr); the rest is padding.
  const r = ctcDecode(lp.data as Float32Array, Math.min(steps, Math.floor((length - 1) / 8) + 1), classes, vocab, NEMO_FRAME_S);
  lp.dispose();
  return r;
}

interface WordChunk { text: string; timestamp: [number, number | null] }

// Silero VAD v5 (≈2 MB): speech probability per 512-sample frame at 16 kHz, with 64 samples of context.
type Vad = (inputs: Record<string, Tensor>) => Promise<{ output: Tensor; stateN: Tensor }>;
let vad: Promise<Vad> | null = null;
const loadVad = () => (vad ??= AutoModel.from_pretrained('onnx-community/silero-vad', {
  config: { model_type: 'custom' } as never, dtype: 'fp32', device: 'wasm',
  revision: 'e71cae966052b992a7eca6b17738916ce0eca4ec', // pinned: the file must match its checksum in models.json
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
      await load(msg.model, msg.id);
      post({ type: 'ready', id: msg.id });
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
    if (msg.type === 'transcribe' && (msg.model === 'ru' || msg.model === 'ru-fast')) {
      post({ type: 'result', id: msg.id, ...(await ctcTranscribe(msg.model, msg.audio)) });
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
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err), heap: heapInfo() });
  }
};
