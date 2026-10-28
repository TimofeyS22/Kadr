// Voice-over recording with MediaRecorder (Safari records AAC/MP4, Chrome Opus/WebM; both import fine).
import { within } from '../lib/limits';

const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
/** A recorder gets this long to hand over its last data after stop (docs/12 G2). */
const STOP_MS = 3000;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf = new Float32Array(1024);

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.recorder.start(250);
  }

  /** Input level 0..1 for a meter (scaled up so speech fills it) and the raw sample peak (for the clip mark). */
  levels(): { level: number; peak: number } {
    if (!this.analyser) return { level: 0, peak: 0 };
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let peak = 0;
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v));
    return { level: Math.min(1, peak * 1.5), peak };
  }

  /** The recording. A recorder that never reports its stop (seen in WebKit) gives what it has after STOP_MS. */
  stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return Promise.reject(new Error('Not recording'));
    const finish = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
      this.release();
      if (!blob.size) throw new Error('The recording is empty');
      return blob;
    };
    const stopped = new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => { try { resolve(finish()); } catch (e) { reject(e as Error); } };
      if (rec.state === 'inactive') rec.onstop(new Event('stop'));
      else rec.stop();
    });
    return within(stopped, STOP_MS, () => { rec.onstop = null; return finish(); });
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.recorder = null;
    this.ctx = null;
    this.analyser = null;
  }
}
