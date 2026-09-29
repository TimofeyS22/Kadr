// Templates: turn the user's media into a finished, fully editable edit in one step.
// Builders are pure (they mutate a draft project whose assets are already added).
import { anim, createAudioClip, createImageClip, createTextClip, createVideoClip } from './defaults';
import { TEXT_PRESETS } from './presets';
import { clipEnd, cutMainToBeats, insertMain, mainTrack, placeClip, projectDuration, setTransition } from './timeline';
import type { Anim, AspectId, Asset, ImageClip, Project, TextClip, VideoClip } from './types';

export type TemplateId = 'slideshow' | 'beat' | 'vlog' | 'beforeAfter' | 'quote' | 'intro';

export interface TemplateSpec {
  id: TemplateId;
  name: string;
  description: string;
  aspect: AspectId;
  /** How many photos/videos the template needs. */
  visuals: [min: number, max: number];
  /** Whether a music file is required, optional or not used. */
  music: 'required' | 'optional' | 'none';
}

export const TEMPLATES: TemplateSpec[] = [
  { id: 'slideshow', name: 'Slideshow', description: 'Photos with gentle zoom and cross-fades, music fades out at the end.', aspect: '9:16', visuals: [2, 30], music: 'optional' },
  { id: 'beat', name: 'Beat edit', description: 'Cuts land on the beat of your music, with a punch-in on every cut.', aspect: '9:16', visuals: [2, 40], music: 'required' },
  { id: 'vlog', name: 'Vlog', description: 'Your clips joined with quick slides and a title up front.', aspect: '9:16', visuals: [1, 20], music: 'optional' },
  { id: 'beforeAfter', name: 'Before / After', description: 'Two shots stacked with labels.', aspect: '9:16', visuals: [2, 2], music: 'optional' },
  { id: 'quote', name: 'Quote card', description: 'A big quote over a dimmed background.', aspect: '4:5', visuals: [1, 1], music: 'optional' },
  { id: 'intro', name: 'Title intro', description: 'A bold animated title over your first shot, then the rest.', aspect: '16:9', visuals: [1, 10], music: 'optional' },
];

const kf = (from: number, to: number, dur: number): Anim => ({ v: from, k: [{ t: 0, v: from, e: 'inOut' }, { t: dur, v: to }] });

function visualClip(a: Asset, duration: number): ImageClip | VideoClip {
  if (a.kind === 'image') return createImageClip(a, 0, duration);
  const c = createVideoClip(a);
  c.duration = Math.min(a.duration, duration);
  return c;
}

function title(text: string, start: number, duration: number, preset = 'outline', y = -0.25): TextClip {
  const t = createTextClip(start, text);
  const pr = TEXT_PRESETS.find((p) => p.id === preset) ?? TEXT_PRESETS[0];
  t.style = { ...pr.style };
  t.duration = duration;
  t.animIn = { type: 'pop', duration: 0.45 };
  t.animOut = { type: 'fade', duration: 0.3 };
  t.transform.y = anim(y);
  return t;
}

function addMusic(p: Project, music: Asset | undefined, fadeOut = 1.5): void {
  if (!music) return;
  const end = projectDuration(p);
  const m = createAudioClip(music, 0);
  m.duration = Math.min(music.duration, end);
  m.fadeOut = Math.min(fadeOut, m.duration / 2);
  m.duck = 0.7;
  placeClip(p, m);
}

/** Builds template `id` into draft `p` from the given assets (already in p.assets). `beats` = music beat grid. */
export function buildTemplate(p: Project, id: TemplateId, visuals: Asset[], music?: Asset, beats?: number[]): void {
  const main = mainTrack(p);
  switch (id) {
    case 'slideshow': {
      visuals.forEach((a, i) => {
        const c = visualClip(a, 2.8);
        c.transform.scale = i % 2 ? kf(1.15, 1, c.duration) : kf(1, 1.15, c.duration);
        insertMain(p, c, Infinity);
        if (i > 0) setTransition(p, c.id, { type: 'fade', duration: 0.5 });
      });
      p.settings.background.mode = 'blur';
      placeClip(p, title('Our story', 0.2, 2.4, 'serif', 0.3));
      addMusic(p, music);
      break;
    }
    case 'beat': {
      visuals.forEach((a) => {
        const c = visualClip(a, 1.2);
        c.transform.scale = kf(1.08, 1, 0.25);
        insertMain(p, c, Infinity);
      });
      p.settings.background.mode = 'blur';
      if (beats?.length) cutMainToBeats(p, beats, 2);
      addMusic(p, music, 0.8);
      break;
    }
    case 'vlog': {
      visuals.forEach((a, i) => {
        insertMain(p, visualClip(a, 4), Infinity);
        if (i > 0) setTransition(p, main.clips[main.clips.length - 1].id, { type: 'slideLeft', duration: 0.35 });
      });
      p.settings.background.mode = 'blur';
      const t = title('Today', 0.3, 2.5, 'yellow', -0.3);
      t.animIn = { type: 'rise', duration: 0.5 };
      placeClip(p, t);
      addMusic(p, music);
      break;
    }
    case 'beforeAfter': {
      const [a, b] = visuals;
      const half = (asset: Asset, y: number, label: string) => {
        const c = visualClip(asset, 5);
        // Crop to the half-frame shape (canvas width × half height) so it fills its half exactly.
        const target = p.settings.width / (p.settings.height / 2);
        const src = asset.width / Math.max(1, asset.height);
        c.crop = target > src ? { x: 0, y: (1 - src / target) / 2, w: 1, h: src / target } : { x: (1 - target / src) / 2, y: 0, w: target / src, h: 1 };
        c.transform.y = anim(y);
        placeClip(p, c);
        const t = title(label, 0, c.duration, 'box', y - 0.2);
        t.style = { ...t.style, size: 0.035 };
        t.animIn = { type: 'fade', duration: 0.3 };
        placeClip(p, t);
      };
      half(a, -0.25, 'Before');
      half(b, 0.25, 'After');
      addMusic(p, music);
      break;
    }
    case 'quote': {
      const c = visualClip(visuals[0], 6);
      c.adjust.exposure = -0.45;
      insertMain(p, c, 0);
      p.settings.background.mode = 'blur';
      const q = title('“Write your quote here.”', 0.4, c.duration - 0.4, 'serif', 0);
      q.style = { ...q.style, size: 0.065 };
      q.animIn = { type: 'fade', duration: 0.9 };
      placeClip(p, q);
      addMusic(p, music);
      break;
    }
    case 'intro': {
      visuals.forEach((a, i) => {
        const c = visualClip(a, i === 0 ? 3.5 : 4);
        insertMain(p, c, Infinity);
        if (i === 1) setTransition(p, c.id, { type: 'zoom', duration: 0.5 });
      });
      const first = main.clips[0];
      placeClip(p, title('YOUR TITLE', 0.3, Math.max(1, clipEnd(first) - 0.8), 'outline', 0));
      addMusic(p, music);
      break;
    }
  }
}
