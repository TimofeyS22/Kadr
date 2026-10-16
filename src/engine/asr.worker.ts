/// <reference lib="webworker" />
// Speech recognition worker: Whisper via transformers.js (ONNX Runtime WASM). Audio never leaves the device;
// only the model files are downloaded once (and cached by the browser).
import { AutoModel, Tensor, env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export type AsrModel = 'tiny' | 'base' | 'small';
export type AsrRequest =
  | { type: 'load'; model: AsrModel }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string | null }
  | { type: 'detect'; id: number; audio: Float32Array; candidates: string[] }
  | { type: 'vad'; id: number; audio: Float32Array };
export type AsrResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; words: { t0: number; t1: number; text: string }[] }
  | { type: 'vad'; id: number; probs: Float32Array }
  | { type: 'language'; id: number; code: string; p: number }
  | { type: 'error'; id?: number; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX Runtime WASM (~27 MB): in development it is served from public/ort (scripts/copy-ort.mjs); production
// builds emit it as a hashed asset on our own origin. Hosting must allow files > 25 MB (not Cloudflare Pages).
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
if (onnx.wasm) {
  if (import.meta.env.DEV) onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;
  if (!self.crossOriginIsolated) onnx.wasm.numThreads = 1;
}

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let loadedModel: AsrModel | null = null;
const post = (m: AsrResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function load(model: AsrModel): Promise<AutomaticSpeechRecognitionPipeline> {
  if (asr && loadedModel === model) return asr;
  loadedModel = model;
  const files = new Map<string, { loaded: number; total: number }>();
  asr = pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0, total = 0;
      for (const f of files.values()) { loaded += f.loaded; total += f.total; }
      post({ type: 'download', loaded, total });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; loadedModel = null; });
  return asr;
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
    if (msg.type === 'vad') {
      const probs = await speechProbabilities(msg.audio);
      post({ type: 'vad', id: msg.id, probs }, [probs.buffer]);
      return;
    }
    const run = await (asr ?? load('tiny'));
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
    post({ type: 'error', id: msg.type !== 'load' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
