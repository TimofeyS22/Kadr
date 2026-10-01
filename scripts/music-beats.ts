// Adds BPM and beat times to public/music/music.json using the app's own beat tracker (core/beats.ts), so
// "Cut to beat" works instantly with library music. Run after build-music.py: npx tsx scripts/music-beats.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateBeats, onsetEnvelope } from '../src/core/beats';

const SR = 48000, HOP_S = 0.01; // same as engine/analysis.ts
const root = join(import.meta.dirname, '..');
const path = join(root, 'public/music/music.json');
const lib = JSON.parse(readFileSync(path, 'utf8')) as { tracks: { id: string; duration: number; bpm?: number; beats?: number[] }[] };
for (const t of lib.tracks) {
  // Decoded through a pipe (mono 48 kHz float): ~35 MB per track never touches the disk.
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', join(root, 'public/music/tracks', `${t.id}.m4a`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const hop = Math.round(SR * HOP_S);
  const energy = new Float32Array(Math.floor(pcm.length / hop));
  for (let i = 0; i < energy.length; i++) {
    let e = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) e += pcm[k] * pcm[k];
    energy[i] = e / hop;
  }
  const grid = estimateBeats(onsetEnvelope(energy), HOP_S, t.duration);
  t.bpm = grid ? Math.round(grid.bpm * 10) / 10 : undefined;
  t.beats = grid ? grid.times.map((x) => Math.round(x * 1000) / 1000) : undefined;
  console.log(t.id, t.bpm ?? 'no steady beat');
}
writeFileSync(path, JSON.stringify(lib, null, 1));
