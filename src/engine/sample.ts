// Generates a sample project entirely in the browser (no network): two short synthesized clips
// with music, a transition, a filter and an animated title. Doubles as an end-to-end fixture.
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_MEDIUM, WebMOutputFormat,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { produce } from 'immer';
import { anim, createProject, createTextClip, createVideoClip } from '../core/defaults';
import { insertMain, placeClip, setTransition } from '../core/timeline';
import type { Asset, Project } from '../core/types';
import { importFile } from './importer';
import { MediaError } from './media';

const W = 720, H = 1280, FPS = 30, DUR = 4;

function drawScene(ctx: CanvasRenderingContext2D, scene: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (scene === 0) {
    g.addColorStop(0, `hsl(${20 + t * 8}, 80%, ${30 + t * 6}%)`);
    g.addColorStop(1, `hsl(${280 + t * 5}, 60%, 18%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.62 - t * 70, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1030';
    ctx.fillRect(0, H * 0.66, W, H * 0.34);
  } else {
    g.addColorStop(0, '#0b2a4a');
    g.addColorStop(1, '#02101f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let k = 0; k < 6; k++) {
      ctx.strokeStyle = `hsla(${190 + k * 12}, 90%, ${55 + k * 4}%, 0.8)`;
      ctx.lineWidth = 14;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) {
        const y = H * (0.3 + k * 0.09) + Math.sin(x / 70 + t * 3 + k) * 40;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${scene === 0 ? 'Sunrise' : 'Waves'} · ${t.toFixed(1)}s`, W / 2, 110);
}

async function synthMusic(seed: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, DUR * 48000, 48000);
  const roots = seed === 0 ? [261.63, 329.63, 392.0, 523.25] : [220.0, 277.18, 329.63, 440.0];
  for (let i = 0; i < DUR * 4; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = roots[i % roots.length] * (i % 8 < 4 ? 1 : 1.5);
    const t = i * 0.25;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  }
  return ctx.startRendering();
}

async function synthClip(scene: number): Promise<Asset> {
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width: W, height: H });
  if (!codec) throw new MediaError('Video encoding is not supported in this browser');
  const mp4 = codec === 'avc';
  const audioCodec = await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus']);
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const video = new CanvasSource(canvas, { codec, bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_MEDIUM }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  if (audio) await audio.add(await synthMusic(scene));
  for (let i = 0; i < DUR * FPS; i++) {
    drawScene(ctx, scene, i / FPS);
    await video.add(i / FPS, 1 / FPS);
  }
  video.close();
  audio?.close();
  await output.finalize();
  const type = mp4 ? 'video/mp4' : 'video/webm';
  return importFile(new Blob([output.target.buffer!], { type }), `${scene === 0 ? 'sunrise' : 'waves'}.${mp4 ? 'mp4' : 'webm'}`);
}

export async function createSampleProject(): Promise<Project> {
  const a = await synthClip(0);
  const b = await synthClip(1);
  const p = createProject('Sample project', '9:16');
  p.assets = { [a.id]: a, [b.id]: b };
  return produce(p, (d) => {
    insertMain(d, createVideoClip(a), 0);
    const c2 = createVideoClip(b);
    c2.filter = { id: 'vivid', intensity: 0.8 };
    insertMain(d, c2, 99);
    setTransition(d, c2.id, { type: 'slideLeft', duration: 0.6 });
    const title = createTextClip(0.3, 'Made with Kadr');
    title.duration = 3;
    title.animIn = { type: 'pop', duration: 0.5 };
    title.transform.y = anim(-0.3);
    title.style = { ...title.style, font: 'anton', size: 0.075, weight: 400, stroke: { color: '#000000', width: 0.06 } };
    placeClip(d, title);
  });
}
