// A project written by an earlier version, or a backup made by one (audit V-239). Every field a later version adds gets
// its default here, once, on the way in: before this a new setting made old backups lose their clips as "damaged" and
// old projects crash where the field was read.
import { defaultAdjust, defaultChroma, defaultTransform } from './defaults';
import { SCHEMA_VERSION, type Project } from './types';

type Loose = Record<string, unknown>;
const isObj = (x: unknown): x is Loose => typeof x === 'object' && x !== null && !Array.isArray(x);

/** `to` keeps what it has; what it lacks comes from `defaults`. */
function fill(to: Loose, defaults: Loose): void {
  for (const [k, v] of Object.entries(defaults)) if (to[k] === undefined) to[k] = v;
}

function migrateClip(c: Loose): void {
  const kind = c.kind;
  if (kind === 'video' || kind === 'image') {
    if (c.adjust === undefined) c.adjust = defaultAdjust(); else if (isObj(c.adjust)) fill(c.adjust, defaultAdjust() as unknown as Loose);
    if (c.chroma === undefined) c.chroma = defaultChroma(); else if (isObj(c.chroma)) fill(c.chroma, defaultChroma() as unknown as Loose);
    fill(c, { filter: null });
  }
  if (kind !== 'audio') {
    if (c.transform === undefined) c.transform = defaultTransform(); else if (isObj(c.transform)) fill(c.transform, defaultTransform() as unknown as Loose);
    fill(c, { blend: 'normal' });
  }
  if (kind === 'video' || kind === 'audio') fill(c, { in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 });
  if (kind === 'text' || kind === 'caption') {
    if (isObj(c.style)) fill(c.style, { weight: 700, italic: false, align: 'center', stroke: null, background: null, shadow: false });
  }
  if (kind === 'text') fill(c, { animIn: { type: 'none', duration: 0.3 }, animOut: { type: 'none', duration: 0.3 } });
  if (kind === 'caption') fill(c, { highlight: null, wordsPerPage: 4 });
}

/** Steps between versions of the format, by the version they start from: none yet. */
const STEPS: Record<number, (p: Project) => void> = {};

/** Brings a project to the current format. Tolerates a damaged one: `repairBackup` judges what is left. */
export function migrateProject(p: Project): void {
  const from = typeof p.version === 'number' ? p.version : 1;
  for (let v = from; v < SCHEMA_VERSION; v++) STEPS[v]?.(p);
  if (Array.isArray(p.tracks)) for (const t of p.tracks as unknown[]) if (isObj(t) && Array.isArray(t.clips)) for (const c of t.clips) if (isObj(c)) migrateClip(c);
  p.version = SCHEMA_VERSION;
}
