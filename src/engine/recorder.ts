// Voice-over recording with MediaRecorder (Safari records AAC/MP4, Chrome Opus/WebM; both import fine).
// Every second goes to storage as it comes, as a camera take's does (TakeWriter): memory stays flat, and a crash loses at
// most a second — the voice-over comes back at its place when the project opens (SW-A-19). Before, every piece waited in
// memory for Stop, and a crash lost the whole voice-over.
import { within } from '../lib/limits';
import { TakeWriter } from '../storage/db';

const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
/** A recorder gets this long to hand over its last data after stop (docs/12 G2). */
const STOP_MS = 3000;

/** The extension of a voice-over file of this type. */
export const voiceExt = (type: string) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm');

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private take: TakeWriter | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf = new Float32Array(1024);

  /** Records a voice-over for the project `project`, to be placed at `at()` s (asked once the microphone is open). */
  async start(project: string, at: () => number): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    const take = this.take = new TakeWriter(project, { kind: 'voice', at: at(), type: (recorder.mimeType || mimeType || '').split(';')[0] });
    recorder.ondataavailable = (e) => { if (e.data.size) take.add(e.data); };
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    recorder.start(1000); // 1 s pieces, each to storage, as the camera's
  }

  /** Input level 0..1 for a meter (scaled up so speech fills it) and the raw sample peak (for the clip mark). */
  levels(): { level: number; peak: number } {
    if (!this.analyser) return { level: 0, peak: 0 };
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let peak = 0;
    for (const v of this.levelBuf) peak = Math.max(peak, Math.abs(v));
    return { level: Math.min(1, peak * 1.5), peak };
  }

  /**
   * Stops and hands over the take, its seconds in storage, with the type it was recorded in: for `saveTake`, then
   * `discard` once it is in the project, or `release` to leave it for the next open. A recorder that never reports its
   * stop (seen in WebKit) gives what it has after STOP_MS.
   */
  async stop(): Promise<{ take: TakeWriter; type: string }> {
    const rec = this.recorder, take = this.take;
    if (!rec || !take) throw new Error('Not recording');
    await within(new Promise<void>((res) => {
      rec.onstop = () => res();
      if (rec.state === 'inactive') res(); else rec.stop();
    }), STOP_MS, () => undefined);
    rec.onstop = null;
    const type = rec.mimeType || 'audio/webm';
    this.release();
    return { take, type };
  }

  /** Stops with nothing kept: what was recorded is deleted. */
  cancel(): void {
    const take = this.take;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    }
    this.release();
    void take?.discard();
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.recorder = null;
    this.take = null;
    this.ctx = null;
    this.analyser = null;
  }
}
