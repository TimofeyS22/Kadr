// Diagnostics screen (`?diag`, docs/12 stage 0): what this phone can do for Kadr — WebAssembly memory, the speech
// engine and models, codecs, the video encoder — as a text report the owner copies and sends. Nothing leaves the
// device on its own. Not linked from the app; it loads only with `?diag` in the address.
import { useEffect, useRef, useState } from 'react';
import { ASR_MODELS, checkSpeechEngine, checkSpeechModel, type AsrModel, type SpeechCheck } from '../engine/captions';
import { t } from '../lib/i18n';

type Rows = [string, string][];
const SR = 16000;

const yes = (b: boolean) => (b ? 'yes' : 'no');
const mb = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const timeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

async function device(): Promise<Rows> {
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean; gpu?: { requestAdapter(): Promise<unknown> } };
  const rows: Rows = [
    ['kadr', __APP_VERSION__],
    ['userAgent', navigator.userAgent],
    ['installed (home screen)', yes(matchMedia('(display-mode: standalone)').matches || nav.standalone === true)],
    ['cores', String(navigator.hardwareConcurrency ?? '?')],
    ['deviceMemory', nav.deviceMemory ? `${nav.deviceMemory} GB` : 'not reported'],
    ['screen', `${screen.width}×${screen.height} @${devicePixelRatio}x`],
    ['crossOriginIsolated', yes(self.crossOriginIsolated)],
    ['SharedArrayBuffer', yes(typeof SharedArrayBuffer !== 'undefined')],
  ];
  const adapter = nav.gpu ? await timeout(nav.gpu.requestAdapter().then((a) => !!a, () => false), 3000, false) : false;
  rows.push(['WebGPU', nav.gpu ? `api yes, adapter ${yes(adapter)}` : 'no']);
  try {
    const est = await navigator.storage.estimate();
    rows.push(['storage', `${mb(est.usage ?? 0)} used of ${mb(est.quota ?? 0)}`], ['storage persisted', yes(await navigator.storage.persisted())]);
  } catch (e) {
    rows.push(['storage', errText(e)]);
  }
  return rows;
}

async function codecs(): Promise<Rows> {
  const v = { width: 1920, height: 1080 };
  const tries: [string, () => Promise<{ supported?: boolean }>][] = [
    ['decode H.264 1080p', () => VideoDecoder.isConfigSupported({ codec: 'avc1.640028', codedWidth: v.width, codedHeight: v.height })],
    ['decode HEVC 10-bit', () => VideoDecoder.isConfigSupported({ codec: 'hvc1.2.4.L153.B0', codedWidth: v.width, codedHeight: v.height })],
    ['encode H.264 1080p', () => VideoEncoder.isConfigSupported({ codec: 'avc1.640028', ...v, bitrate: 8e6, framerate: 30 })],
    ['decode AAC', () => AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })],
    ['encode AAC', () => AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })],
    ['encode Opus', () => AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })],
  ];
  const rows: Rows = [];
  for (const [label, run] of tries) {
    try { rows.push([label, yes(!!(await run()).supported)]); } catch (e) { rows.push([label, errText(e)]); }
  }
  return rows;
}

/** Each size in a worker of its own (see diag.worker.ts). */
async function memory(): Promise<Rows> {
  const rows: Rows = [];
  for (const [size, shared] of [[4096, true], [2048, true], [1024, true], [512, true], [4096, false]] as const) {
    const w = new Worker(new URL('../engine/diag.worker.ts', import.meta.url), { type: 'module' });
    const r = await timeout(new Promise<{ ok: boolean; error?: string }>((res) => {
      w.onmessage = (e) => res(e.data as { ok: boolean; error?: string });
      w.onerror = (e) => res({ ok: false, error: e.message || 'worker failed' });
      w.postMessage({ mb: size, shared });
    }), 10_000, { ok: false, error: 'no answer in 10 s' });
    w.terminate();
    rows.push([`${shared ? 'shared' : 'plain'} ${size} MB`, r.ok ? 'ok' : r.error ?? 'failed']);
  }
  return rows;
}

function speechRows(r: SpeechCheck): Rows {
  const rows: Rows = [['result', r.ok ? 'ok' : 'FAILED'], ['load', sec(r.loadMs)]];
  if (r.runMs !== undefined) rows.push(['read 10 s', sec(r.runMs)]);
  if (r.text !== undefined) rows.push(['text', r.text || '(nothing)']);
  if (r.error) rows.push(['error', r.error]);
  rows.push(['heap', r.heap?.capMb ? `${Math.round(r.heap.mb ?? 0)} MB of ${r.heap.capMb} MB max` : 'not created']);
  if (r.heap?.refused.length) rows.push(['heap refused', r.heap.refused.map((x) => `${x} MB`).join(', ')]);
  return rows;
}

/** 5 s of 1080p30 H.264 through the browser's encoder: the iOS simulator's stalls after 8 frames (docs/11 L5). */
async function encoder(): Promise<Rows> {
  if (typeof VideoEncoder === 'undefined') return [['VideoEncoder', 'missing']];
  const W = 1920, H = 1080, N = 150;
  const config = { codec: 'avc1.640028', width: W, height: H, bitrate: 8e6, framerate: 30 };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return [['H.264 1080p', 'not supported']];
  let out = 0, error = '';
  const enc = new VideoEncoder({ output: () => { out++; }, error: (e) => { error = errText(e); } });
  enc.configure(config);
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('2d')!;
  const t0 = performance.now();
  let sent = 0;
  for (; sent < N && !error && performance.now() - t0 < 20_000; sent++) {
    g.fillStyle = `hsl(${sent * 7} 60% 45%)`;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.fillRect((sent * 12) % W, 400, 240, 240);
    const f = new VideoFrame(canvas, { timestamp: Math.round((sent * 1e6) / 30) });
    enc.encode(f, { keyFrame: sent % 60 === 0 });
    f.close();
    while (enc.encodeQueueSize > 6 && !error && performance.now() - t0 < 20_000) await new Promise((r) => setTimeout(r, 5));
  }
  const flushed = await timeout(enc.flush().then(() => true, (e: unknown) => { error ||= errText(e); return false; }), 10_000, false);
  const ms = performance.now() - t0;
  try { enc.close(); } catch { /* already closed by an error */ }
  const rows: Rows = [['H.264 1080p30, 150 frames', flushed && out >= N && !error ? 'ok' : 'FAILED'], ['frames out', `${out} of ${sent} sent`], ['time', `${sec(ms)} (${((N / 30) / (ms / 1000)).toFixed(2)}× real time)`]];
  if (error) rows.push(['error', error]);
  return rows;
}

/** The speech sample (SOVA RuDevices, CC BY 4.0) as 16 kHz mono. */
async function sample(): Promise<Float32Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}diag/ru-live.m4a`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await res.arrayBuffer());
  const x = buf.getChannelData(0);
  const step = buf.sampleRate / SR; // 48 kHz → 16 kHz, a box filter is plenty for speech
  const out = new Float32Array(Math.floor(x.length / step));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += x[Math.floor(i * step) + k] ?? 0;
    out[i] = s / step;
  }
  return out;
}

const STEPS: [string, () => Promise<Rows>][] = [
  ['Device', device],
  ['Codecs', codecs],
  ['Speech engine', async () => speechRows(await checkSpeechEngine())],
  ['WebAssembly memory', memory],
  ['Video export', encoder],
];

export function Diag() {
  const [sections, setSections] = useState<[string, Rows][]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const put = (title: string, rows: Rows) => setSections((s) => [...s.filter(([x]) => x !== title), [title, rows]]);
  const step = async (title: string, run: () => Promise<Rows>) => {
    setBusy(title);
    put(title, [['…', 'running']]);
    try { put(title, await run()); } catch (e) { put(title, [['error', errText(e)]]); }
  };
  const all = async () => {
    for (const [title, run] of STEPS) await step(title, run);
    setBusy(null);
  };
  const model = async (m: AsrModel) => {
    const title = `Speech model: ${m}`;
    await step(title, async () => {
      const audio = await sample();
      return speechRows(await checkSpeechModel(m, audio, 'russian', (f) => put(title, [['download', `${Math.round(f * 100)}%`]])));
    });
    setBusy(null);
  };
  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    void all();
  }, []);

  const report = sections.map(([title, rows]) => `## ${title}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`).join('\n\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(report); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="diag">
      <h1>{t('Diagnostics')}</h1>
      <p className="hint">{t('What this device can do for Kadr. Nothing is sent anywhere: copy the report and send it yourself.')}</p>
      <div className="diag-actions">
        <button className="btn primary" onClick={() => void copy()} disabled={!!busy}>{copied ? t('Copied') : t('Copy report')}</button>
        <button className="btn" onClick={() => void all()} disabled={!!busy}>{t('Check again')}</button>
      </div>
      <h2>{t('Speech models')}</h2>
      <p className="hint">{t('Each downloads once and reads 10 seconds of Russian speech. Speech sample: SOVA RuDevices, CC BY 4.0.')}</p>
      <div className="diag-actions">
        {(['tiny', 'base', 'ru'] as const).map((m) => (
          <button key={m} className="btn" disabled={!!busy} onClick={() => void model(m)}>{t(ASR_MODELS[m].label)}, {ASR_MODELS[m].mb} MB</button>
        ))}
      </div>
      {busy && <p className="hint" role="status">{t('Checking: {step}…', { step: busy })}</p>}
      <pre className="diag-report" aria-label={t('Report')}>{report}</pre>
      <a className="btn" href={import.meta.env.BASE_URL}>{t('Back to Kadr')}</a>
    </div>
  );
}
