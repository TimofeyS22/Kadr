// Camera with a teleprompter (v0.6): record yourself reading a script; the clip lands on the main track at the
// playhead. The camera and microphone are on only while this screen is open (every track is stopped on close).
import { CircleAlert, Pencil, SwitchCamera, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { errorMessage, track } from '../lib/telemetry';
import { editor } from '../state/store';
import { addFiles } from './actions';
import { TakeWriter } from '../storage/db';
import { Slider, Values } from './controls';
import { Button, IconButton } from './ck/controls';
import { Field } from './ck/Field';
import './capture.css';
import { formatTime } from './format';
import { useHoldUpdates } from '../lib/update';
import { within } from '../lib/limits';

const MAX_S = 10 * 60;
const SCRIPT_KEY = 'kadr.script';
type State = 'starting' | 'ready' | 'countdown' | 'recording' | 'saving' | 'error';
type WakeLock = { release(): Promise<void> };
/** The recorder gets this long to hand over its last chunk after stop (docs/12 G2). */
const STOP_MS = 3000;
/**
 * A recorder that gives nothing (S-1-12): under load WebKit's MediaRecorder ran a whole take without one piece and
 * handed 0 bytes at Stop, and the person learned it afterwards as "Unsupported file format". It cuts a piece every
 * second (measured: the first comes 1.1–2.3 s after the start on a loaded Mac); with nothing by SILENT_MS the take is
 * stopped and said not to have started, while the person can still record again.
 */
const SILENT_MS = 5000;

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

/** The front camera is recorded the way the preview shows it: frames are flipped on a canvas, the microphone passes through. */
function mirrored(s: MediaStream, v: HTMLVideoElement): { stream: MediaStream; stop: () => void } {
  const c = Object.assign(document.createElement('canvas'), { width: v.videoWidth || 1280, height: v.videoHeight || 720 });
  const g = c.getContext('2d')!;
  g.setTransform(-1, 0, 0, 1, c.width, 0);
  let alive = true;
  const next = () => { if (!alive) return; if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(draw); else requestAnimationFrame(draw); };
  const draw = () => { if (!alive) return; g.drawImage(v, 0, 0, c.width, c.height); next(); };
  draw();
  const out = c.captureStream(30);
  return {
    stream: new MediaStream([...out.getVideoTracks(), ...s.getAudioTracks()]),
    stop: () => { alive = false; stopAll(out); },
  };
}

export function CameraSheet() {
  const video = useRef<HTMLVideoElement>(null);
  const prompter = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; take: TakeWriter; lock: WakeLock | null; mirror: { stop: () => void } | null; watch: number[] } | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [state, setState] = useState<State>('starting');
  useHoldUpdates(state === 'countdown' || state === 'recording' || state === 'saving');
  const [error, setError] = useState('');
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [script, setScript] = useState(() => load(SCRIPT_KEY) ?? '');
  const [speed, setSpeed] = useState(() => Number(load(`${SCRIPT_KEY}.speed`)) || 1);
  const [size, setSize] = useState(() => Number(load(`${SCRIPT_KEY}.size`)) || 26);
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);

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
    if (r) { r.watch.forEach(clearTimeout); r.recorder.ondataavailable = null; if (r.recorder.state !== 'inactive') r.recorder.stop(); r.mirror?.stop(); void r.take.discard(); void r.lock?.release().catch(() => undefined); }
  }, []);

  // Countdown → recording.
  useEffect(() => {
    if (state !== 'countdown') return;
    if (count === 0) { begin(); return; }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [state, count]);

  // Timer and auto-stop at the limit.
  useEffect(() => {
    if (state !== 'recording') return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      setElapsed(s);
      if (s >= MAX_S) { void stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  // Teleprompter scroll, about `speed` lines per second: while recording, and as a live preview of the chosen speed
  // (looping) before it. Changing speed or size mid-preview continues from where the text is.
  const scrolling = state === 'recording' || (previewing && state === 'ready');
  useEffect(() => {
    if (!scrolling) return;
    let last = performance.now(), raf = 0;
    let pos = prompter.current?.scrollTop ?? 0; // fractional: scrollTop rounds small per-frame steps away
    const tick = (now: number) => {
      pos += ((now - last) / 1000) * speed * size * 1.3;
      last = now;
      const el = prompter.current;
      if (el) {
        if (state !== 'recording' && pos >= el.scrollHeight - el.clientHeight) pos = 0;
        el.scrollTop = pos;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, speed, size]);

  function start() {
    if (!stream.current) return;
    setEditing(false);
    setPreviewing(false);
    if (prompter.current) prompter.current.scrollTop = 0;
    setCount(3);
    setState('countdown');
  }

  function begin() {
    const s = stream.current;
    if (!s) return;
    try {
      const mime = pickMime();
      const mirror = facing === 'user' && video.current ? mirrored(s, video.current) : null;
      const recorder = new MediaRecorder(mirror?.stream ?? s, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      const take = new TakeWriter(editor().project!.id);
      let got = false;
      recorder.ondataavailable = (e) => { if (e.data.size) { got = true; take.add(e.data); } };
      recorder.start(1000); // 1 s pieces, each to storage: memory stays flat and a crash loses at most a second
      const watch = [window.setTimeout(() => { if (!got && rec.current?.recorder === recorder) gaveNothing(); }, SILENT_MS)];
      rec.current = { recorder, take, lock: null, mirror, watch };
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLock> } }).wakeLock;
      void wl?.request('screen').then((l) => { if (rec.current) rec.current.lock = l; else void l.release(); }, () => undefined);
      setElapsed(0);
      setState('recording');
      track('camera_recording_started', { facing, mirrored: !!mirror, script: script.length > 0 });
    } catch (e) {
      setError(cameraError(e));
      setState('error');
    }
  }

  /** Ends a take that holds nothing: the person hears it now, and the camera stays ready for the next one (S-1-12). */
  function dropEmpty(r: NonNullable<typeof rec.current>, said: string) {
    r.watch.forEach(clearTimeout);
    r.recorder.ondataavailable = null;
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    r.mirror?.stop();
    void r.lock?.release().catch(() => undefined);
    void r.take.discard();
    rec.current = null;
    track('camera_recording_empty', { seconds: Math.round(elapsed) });
    editor().toast(said, 'error');
    if (prompter.current) prompter.current.scrollTop = 0; // the script waits at its start for the next take, not scrolled away
    setState('ready');
  }

  function gaveNothing() {
    const r = rec.current;
    if (r) dropEmpty(r, t('The recording did not start: the browser gave no video. Record again.'));
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    r.watch.forEach(clearTimeout);
    setState('saving');
    // A recorder that never reports its stop (seen in WebKit) keeps what it has: the 1 s pieces are already stored.
    await within(new Promise<void>((res) => {
      r.recorder.onstop = () => res();
      if (r.recorder.state === 'inactive') res(); else r.recorder.stop();
    }), STOP_MS, () => undefined);
    r.mirror?.stop();
    void r.lock?.release().catch(() => undefined);
    rec.current = null;
    const type = r.recorder.mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const stamp = new Date().toTimeString().slice(0, 5).replace(':', '-');
    const file = await r.take.file(`${t('Camera')} ${stamp}.${ext}`, type.split(';')[0]);
    // Nothing came out of the recorder: said as it is, not as a file "in an unsupported format" (S-1-12).
    if (!file.size) { rec.current = r; dropEmpty(r, t('The recording came out empty: the browser gave no video. Record again.')); return; }
    track('camera_recording_saved', { seconds: Math.round(elapsed), mb: Math.round(file.size / 1e6) });
    editor().openSheet(null); // closes this screen (stops the camera) before the import overlay
    // Only once it is in the project does the take leave storage: a full disk at this moment no longer loses the recording.
    if (await addFiles([file], 'main', { script: script.trim() || undefined })) void r.take.discard();
  }

  const close = () => editor().openSheet(null);
  const recording = state === 'recording';

  return (
    // Chetko (Ч4 release 9): black round the picture, white buttons on solid rounds, the record button white — red is for
    // deleting only (DESIGN.md §2.3). The old class names stay as hooks for the tests and the L5 scripts.
    <section className="camera ck-cam" role="dialog" aria-label={t('Camera')}>
      <video ref={video} className="camera-video ck-cam-video" data-mirror={facing === 'user' ? true : undefined} muted playsInline autoPlay />
      {script && (
        // The plate is as tall as four lines of the script, not a third of the screen over the face; the words scroll
        // inside it and fade at its edges (the art director, release 9).
        <div className="prompter ck-prompter">
          <div ref={prompter} className="ck-prompter-text" style={{ fontSize: size }} aria-label={t('Teleprompter')}>
            <p>{script}</p>
          </div>
        </div>
      )}
      {state === 'countdown' && <div className="countdown ck-countdown" aria-live="assertive">{count}</div>}
      {state === 'error' && <p className="camera-error ck-cam-note" role="alert"><CircleAlert aria-hidden />{error}</p>}
      {state === 'saving' && <p className="camera-error ck-cam-note" role="status">{t('Saving the recording…')}</p>}
      {editing && (
        <div className="script-editor ck-script">
          <Field label={t('Script to read')} multiline rows={4} value={script} placeholder={t('Paste or type what you want to say')}
            onChange={(v) => { setScript(v); save(SCRIPT_KEY, v); }} />
          <Values label={t('Speed and size')}>
            <Slider label={t('Scroll speed')} value={speed} min={0.3} max={3} step={0.1} format={(v) => `${v.toFixed(1)}×`} reset={1}
              onChange={(v) => { setSpeed(v); save(`${SCRIPT_KEY}.speed`, String(v)); }} />
            <Slider label={t('Text size')} value={size} min={16} max={48} step={1} format={(v) => `${v}`} reset={26}
              onChange={(v) => { setSize(v); save(`${SCRIPT_KEY}.size`, String(v)); }} />
          </Values>
          <Button disabled={!script || state !== 'ready'} aria-pressed={previewing}
            onClick={() => { if (previewing && prompter.current) prompter.current.scrollTop = 0; setPreviewing((x) => !x); }}>
            {previewing ? t('Stop the test') : t('Test the speed')}
          </Button>
        </div>
      )}
      <div className="camera-bar ck-cam-bar">
        <div className="ck-cam-side">
          {/* Not while a take runs or is counted in: one tap must not throw a take away (DESIGN.md §2.6). */}
          <IconButton hook="icon-btn" label={t('Close camera')} onClick={close} disabled={state === 'saving' || state === 'countdown' || recording}><X aria-hidden /></IconButton>
          <IconButton label={t('Edit script')} onClick={() => { setEditing((e) => !e); setPreviewing(false); }} disabled={recording || state === 'countdown'} aria-pressed={editing}><Pencil aria-hidden /></IconButton>
        </div>
        {recording ? (
          <button type="button" className="rec-btn on ck-rec" data-on onClick={() => void stop()} aria-label={t('Stop recording')} />
        ) : state === 'countdown' ? (
          // 3, 2, 1 can be stopped with the same button, as the phone's own timer: the square, back to ready.
          <button type="button" className="rec-btn on ck-rec" data-on onClick={() => { setCount(3); setState('ready'); }} aria-label={t('Cancel the countdown')} />
        ) : (
          <button type="button" className="rec-btn ck-rec" onClick={start} disabled={state !== 'ready'} aria-label={t('Start recording')} />
        )}
        {/* The time is there before the take: this camera records video. While the take runs, its «now» mark beats. */}
        {(state === 'ready' || state === 'countdown' || recording) && <span className="rec-time ck-rec-time" data-on={recording || undefined}>{formatTime(recording ? elapsed : 0)}</span>}
        <div className="ck-cam-side">
          <IconButton label={t('Switch camera')} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={recording || state === 'countdown'}><SwitchCamera aria-hidden /></IconButton>
        </div>
      </div>
    </section>
  );
}
