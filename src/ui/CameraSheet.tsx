// Camera with a teleprompter (v0.6): record yourself reading a script; the clip lands on the main track at the
// playhead. The camera and microphone are on only while this screen is open (every track is stopped on close).
import { FlipHorizontal2, Pencil, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { errorMessage, track } from '../lib/telemetry';
import { editor } from '../state/store';
import { addFiles } from './actions';
import { Slider } from './controls';
import { formatTime } from './format';

const MAX_S = 10 * 60;
const SCRIPT_KEY = 'kadr.script';
type State = 'starting' | 'ready' | 'countdown' | 'recording' | 'saving' | 'error';
type WakeLock = { release(): Promise<void> };

const load = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
const stopAll = (s: MediaStream) => s.getTracks().forEach((tr) => tr.stop());

function cameraError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('Camera access was denied. Allow it in the browser settings and try again.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('No camera was found on this device');
  if (name === 'NotReadableError') return t('The camera is busy in another app');
  return t('Camera is not available: {error}', { error: errorMessage(e) });
}

/** A recording format this browser can make and Kadr can import: MP4 in Safari, MP4 or WebM in Chrome. */
const pickMime = () => ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  .find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));

export function CameraSheet() {
  const video = useRef<HTMLVideoElement>(null);
  const prompter = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; lock: WakeLock | null } | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [state, setState] = useState<State>('starting');
  const [error, setError] = useState('');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState(() => load(SCRIPT_KEY) ?? '');
  const [speed, setSpeed] = useState(() => Number(load(`${SCRIPT_KEY}.speed`)) || 1);
  const [size, setSize] = useState(() => Number(load(`${SCRIPT_KEY}.size`)) || 26);
  const [editing, setEditing] = useState(false);

  // Opens (or re-opens after a flip) the camera; the cleanup stops every track.
  useEffect(() => {
    let alive = true;
    player.pause();
    setState('starting');
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) { setError(t('No camera was found on this device')); setState('error'); return; }
    md.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    }).then((s) => {
      if (!alive) { stopAll(s); return; }
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      void v.play().catch(() => undefined);
      setState('ready');
    }).catch((e) => { if (alive) { setError(cameraError(e)); setState('error'); } });
    return () => {
      alive = false;
      if (stream.current) stopAll(stream.current);
      stream.current = null;
    };
  }, [facing]);

  // Leaving the screen mid-recording discards the take and frees everything.
  useEffect(() => () => {
    const r = rec.current;
    if (r) { r.recorder.ondataavailable = null; if (r.recorder.state !== 'inactive') r.recorder.stop(); void r.lock?.release().catch(() => undefined); }
  }, []);

  // Countdown → recording.
  useEffect(() => {
    if (state !== 'countdown') return;
    if (count === 0) { begin(); return; }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [state, count]);

  // Timer, auto-stop at the limit, and the teleprompter scroll (about `speed` lines per second).
  useEffect(() => {
    if (state !== 'recording') return;
    const t0 = performance.now();
    let last = t0, raf = 0;
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      setElapsed(s);
      if (prompter.current) prompter.current.scrollTop += ((now - last) / 1000) * speed * size * 1.3;
      last = now;
      if (s >= MAX_S) { void stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  function start() {
    if (!stream.current) return;
    setEditing(false);
    if (prompter.current) prompter.current.scrollTop = 0;
    setCount(3);
    setState('countdown');
  }

  function begin() {
    const s = stream.current;
    if (!s) return;
    try {
      const mime = pickMime();
      const recorder = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.start(1000); // 1 s chunks: memory stays flat and a crash loses at most a second
      rec.current = { recorder, chunks, lock: null };
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLock> } }).wakeLock;
      void wl?.request('screen').then((l) => { if (rec.current) rec.current.lock = l; else void l.release(); }, () => undefined);
      setElapsed(0);
      setState('recording');
      track('camera_recording_started', { facing, script: script.length > 0 });
    } catch (e) {
      setError(cameraError(e));
      setState('error');
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    setState('saving');
    await new Promise<void>((res) => { r.recorder.onstop = () => res(); r.recorder.stop(); });
    void r.lock?.release().catch(() => undefined);
    rec.current = null;
    const type = r.recorder.mimeType || r.chunks[0]?.type || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '-');
    const file = new File(r.chunks, `${t('Camera')} ${stamp}.${ext}`, { type: type.split(';')[0] });
    track('camera_recording_saved', { seconds: Math.round(elapsed), mb: Math.round(file.size / 1e6) });
    editor().openSheet(null); // closes this screen (stops the camera) before the import overlay
    await addFiles([file], 'main');
  }

  const close = () => editor().openSheet(null);
  const recording = state === 'recording';

  return (
    <section className="camera" role="dialog" aria-label={t('Camera')}>
      <video ref={video} className={`camera-video ${facing === 'user' ? 'mirror' : ''}`} muted playsInline autoPlay />
      {script && !editing && (
        <div ref={prompter} className="prompter" style={{ fontSize: size }} aria-label={t('Teleprompter')}>
          <p>{script}</p>
        </div>
      )}
      {state === 'countdown' && <div className="countdown" aria-live="assertive">{count}</div>}
      {state === 'error' && <p className="camera-error" role="alert">{error}</p>}
      {state === 'saving' && <p className="camera-error">{t('Saving the recording…')}</p>}
      {editing && (
        <div className="script-editor">
          <textarea value={script} placeholder={t('Paste or type what you want to say')} aria-label={t('Script')}
            onChange={(e) => { setScript(e.target.value); save(SCRIPT_KEY, e.target.value); }} />
          <Slider label={t('Scroll speed')} value={speed} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} reset={1}
            onChange={(v) => { setSpeed(v); save(`${SCRIPT_KEY}.speed`, String(v)); }} />
          <Slider label={t('Text size')} value={size} min={16} max={48} step={1} format={(v) => `${v}`} reset={26}
            onChange={(v) => { setSize(v); save(`${SCRIPT_KEY}.size`, String(v)); }} />
        </div>
      )}
      <div className="camera-bar">
        <button className="icon-btn" onClick={close} disabled={state === 'saving'} aria-label={t('Close camera')}><X size={24} /></button>
        <button className="icon-btn" onClick={() => setEditing((e) => !e)} disabled={recording || state === 'countdown'} aria-pressed={editing} aria-label={t('Edit script')}><Pencil size={22} /></button>
        {recording ? (
          <button className="rec-btn on" onClick={() => void stop()} aria-label={t('Stop recording')}><Square size={26} fill="currentColor" /></button>
        ) : (
          <button className="rec-btn" onClick={start} disabled={state !== 'ready'} aria-label={t('Start recording')}><span className="rec-dot" /></button>
        )}
        <span className="rec-time">{recording ? formatTime(elapsed) : ''}</span>
        <button className="icon-btn" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={recording || state === 'countdown'} aria-label={t('Switch camera')}><FlipHorizontal2 size={22} /></button>
      </div>
    </section>
  );
}
