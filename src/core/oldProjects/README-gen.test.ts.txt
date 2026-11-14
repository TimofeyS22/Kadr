// Verifier E1: builds one project with this version's own core and records what buildFrame draws at every frame.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import * as D from './defaults';
import * as T from './timeline';
import { buildFrame } from './frame';

type L = { source: { kind: string; assetId?: string; time?: number; clip?: { text?: string }; chars?: number }; x: number; y: number; scale: number; rotation: number; opacity: number };
const sig = (l: L) => {
  const s = l.source;
  const what = s.kind === 'video' ? `${s.assetId}@${(s.time ?? 0).toFixed(3)}` : s.kind === 'image' ? s.assetId : s.kind === 'text' ? `${s.clip?.text}/${s.chars}` : '';
  return `${s.kind}:${what} x${l.x.toFixed(3)} y${l.y.toFixed(3)} s${l.scale.toFixed(3)} r${l.rotation.toFixed(2)} o${l.opacity.toFixed(3)}`;
};

it('archive', () => {
  const p = D.createProject('Archive', '9:16', 1_760_000_000_000);
  const video = (id: string, duration: number) => ({ id, kind: 'video', name: `${id}.mp4`, mime: 'video/mp4', size: 1000, duration, width: 1080, height: 1920, hasAudio: true });
  const a1 = video('a1', 10), a2 = video('a2', 8);
  const im = { id: 'im', kind: 'image', name: 'im.png', mime: 'image/png', size: 10, duration: 0, width: 1080, height: 1080, hasAudio: false };
  const mu = { id: 'mu', kind: 'audio', name: 'mu.m4a', mime: 'audio/mp4', size: 10, duration: 20, width: 0, height: 0, hasAudio: true };
  for (const x of [a1, a2, im, mu]) (p.assets as Record<string, unknown>)[x.id] = x;
  const c1 = D.createVideoClip(a1 as never, 0); T.insertMain(p, c1, 0);
  const c2 = D.createVideoClip(a2 as never, 0); T.insertMain(p, c2, T.projectDuration(p));
  const right = T.splitClip(p, c1.id, 4);
  if (right) T.trimClip(p, right, 'start', 5);
  T.setSpeed(p, c2.id, 2);
  const img = D.createImageClip(im as never, 2); T.placeClip(p, img);
  const text = D.createTextClip(1, 'Hello'); T.placeClip(p, text);
  const au = D.createAudioClip(mu as never, 0); T.placeClip(p, au);
  const duration = T.projectDuration(p);
  const frames: string[][] = [];
  for (let i = 0; i < Math.round(duration * 30); i++) frames.push(buildFrame(p, (i + 0.5) / 30).layers.map((l) => sig(l as unknown as L)));
  writeFileSync(process.env.ARCHIVE_OUT!, JSON.stringify({ version: process.env.ARCHIVE_VERSION, duration, project: p, frames }));
});
