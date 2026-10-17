// Captions from the user's own text (docs/09 S1): the words come from the script, the timing from speech recognition.
// A global alignment (Needleman–Wunsch) pairs script words with recognized ones; recognition errors are replaced by
// the script's words, improvised words stay as heard, and a stretch of script that was never said is left out.
import { mainTrack } from './timeline';
import type { CaptionWord, Project } from './types';
import { isFiller } from './reframe';

export interface ScriptToken { text: string; norm: string }
export interface ScriptCaptions {
  /** Words in timeline seconds, ready for a caption clip. */
  words: CaptionWord[];
  /** Share of recognized words that found their script word. */
  matched: number;
  /** Script words left out as not said. */
  skipped: number;
  /** Recognized words kept although the script lacks them (improvisation). */
  adlibs: number;
}

/** The texts the project's main recordings were read from, in timeline order (each once). */
export function projectScript(p: Project): string {
  const seen: string[] = [];
  for (const c of mainTrack(p).clips) {
    const s = 'assetId' in c ? p.assets[c.assetId]?.script : undefined;
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.join('\n');
}

/** Comparable form: case, ё/е and punctuation do not matter. */
export const normWord = (s: string): string => s.toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');

/** Script words as written (punctuation kept for display); bare punctuation ("—") sticks to the word before it. */
export function tokenize(script: string): ScriptToken[] {
  const out: ScriptToken[] = [];
  let pending = '';
  for (const raw of script.split(/\s+/)) {
    if (!raw) continue;
    const norm = normWord(raw);
    if (!norm) {
      if (out.length) out[out.length - 1].text += ` ${raw}`;
      else pending += `${raw} `;
      continue;
    }
    out.push({ text: pending + raw, norm });
    pending = '';
  }
  return out;
}

const isNumber = (n: string) => /^\d+$/.test(n);

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Pairing cost of a script word and a heard word: same 0, close (a typo, an ending) 0.3, digits vs words 0.5, other 1. */
export function wordCost(a: string, b: string): number {
  if (a === b) return 0;
  if (isNumber(a) !== isNumber(b)) return 0.5; // Whisper writes "15" for "пятнадцать" and the other way round
  const max = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 0.4 * max) return 1;
  return 1 - levenshtein(a, b) / max >= 0.6 ? 0.3 : 1;
}

const GAP = 1;
/** Above this, matrices get too big for a phone (≈ 90 minutes of speech): the caller keeps the recognized words. */
const MAX_CELLS = 30_000_000;
/** A stretch of script needs at least this much speech per word to count as said. */
const MIN_WORD_S = 0.12;

type Op =
  | { kind: 'pair'; s: number; h: number; cost: number }
  | { kind: 'pair2h'; s: number; h: number; cost: number } // one script word heard as two ("слова-паразиты" → "слово паразиты")
  | { kind: 'pair2s'; s: number; h: number; cost: number } // two script words heard as one
  | { kind: 'script'; s: number }
  | { kind: 'heard'; h: number };

/** A merge costs a little more than the same match one to one, so 1:1 wins a tie. */
const MERGE = 0.1;
/**
 * Merges must be near-exact (≥ 0.8, two edits in a compound like "слово паразит" ≈ "слова-паразиты"): a loose merge
 * lets a short word of an unsaid sentence ride along with its neighbour ("привет" + "это" ≈ "привет"). Infinity = not a merge.
 */
function mergeCost(a: string, b: string): number {
  if (a === b) return MERGE;
  const max = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 0.2 * max) return Infinity; // cannot reach 0.8: skip the distance
  return 1 - levenshtein(a, b) / max >= 0.8 ? 0.3 + MERGE : Infinity;
}

function align(script: ScriptToken[], heard: string[]): Op[] {
  const n = script.length, m = heard.length, w = m + 1;
  // A talk uses a few hundred distinct words over and over: costs are computed once per pair of distinct words.
  const ids = new Map<string, number>();
  const id = (x: string) => { let v = ids.get(x); if (v === undefined) { v = ids.size; ids.set(x, v); } return v; };
  const sid = script.map((x) => id(x.norm)), hid = heard.map(id);
  // Neighbouring pairs for merges, built once. Both parts of a split compound are real words: a short word ("и") never
  // merges into its neighbour ("шагов" + "и" ≈ "шагов"); '' rules the merge out.
  const part = (a: string, b: string) => (a.length >= 3 && b.length >= 3 ? a + b : '');
  const heard2 = heard.map((x, j) => (j ? part(heard[j - 1], x) : ''));
  const script2 = script.map((x, i) => (i ? part(script[i - 1].norm, x.norm) : ''));
  const memo = new Map<number, number>();
  const cost = (i: number, j: number) => {
    const key = sid[i] * 1_048_576 + hid[j];
    let c = memo.get(key);
    if (c === undefined) { c = wordCost(script[i].norm, heard[j]); memo.set(key, c); }
    return c;
  };
  const back = new Uint8Array((n + 1) * w); // 0 pair, 1 script only, 2 heard only, 3 pair2h, 4 pair2s
  let prev2 = new Float64Array(w), prev = new Float64Array(w), cur = new Float64Array(w);
  for (let j = 1; j <= m; j++) { prev[j] = j * GAP; back[j] = 2; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i * GAP;
    back[i * w] = 1;
    const si = script[i - 1].norm;
    for (let j = 1; j <= m; j++) {
      let best = prev[j - 1] + cost(i - 1, j - 1), b = 0;
      const u = prev[j] + GAP, l = cur[j - 1] + GAP;
      if (u < best) { best = u; b = 1; }
      if (l < best) { best = l; b = 2; }
      if (j >= 2) {
        const c = prev[j - 2] + mergeCost(si, heard2[j - 1]);
        if (c < best) { best = c; b = 3; }
      }
      if (i >= 2) {
        const c = prev2[j - 1] + mergeCost(script2[i - 1], heard[j - 1]);
        if (c < best) { best = c; b = 4; }
      }
      cur[j] = best; back[i * w + j] = b;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  const ops: Op[] = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const b = back[i * w + j];
    if (b === 0) { ops.push({ kind: 'pair', s: i - 1, h: j - 1, cost: wordCost(script[i - 1].norm, heard[j - 1]) }); i--; j--; }
    else if (b === 1) { ops.push({ kind: 'script', s: i - 1 }); i--; }
    else if (b === 2) { ops.push({ kind: 'heard', h: j - 1 }); j--; }
    else if (b === 3) { ops.push({ kind: 'pair2h', s: i - 1, h: j - 2, cost: mergeCost(script[i - 1].norm, heard[j - 2] + heard[j - 1]) }); i--; j -= 2; }
    else { ops.push({ kind: 'pair2s', s: i - 2, h: j - 1, cost: mergeCost(script[i - 2].norm + script[i - 1].norm, heard[j - 1]) }); i -= 2; j--; }
  }
  return ops.reverse();
}

/**
 * One unrelated word between good matches is a recognition error: the script's word is shown. Two or more in a row
 * mean the person said something else there: the heard words are shown and the script's words dropped.
 */
function splitDivergence(ops: Op[]): { ops: Op[]; replaced: number } {
  const out: Op[] = [];
  let replaced = 0;
  for (let i = 0; i < ops.length;) {
    const o = ops[i];
    if (o.kind !== 'pair' || o.cost < 1) { out.push(o); i++; continue; }
    let j = i;
    while (j < ops.length && ops[j].kind === 'pair' && (ops[j] as { cost: number }).cost >= 1) j++;
    const run = ops.slice(i, j) as Extract<Op, { kind: 'pair' }>[];
    if (run.length === 1) out.push(o);
    else { for (const r of run) out.push({ kind: 'heard', h: r.h }); replaced += run.length; }
    i = j;
  }
  return { ops: out, replaced };
}

/** Seconds of speech inside [a, b]. */
const speechIn = (speech: [number, number][], a: number, b: number) =>
  speech.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

type Slot = { text: string; t0: number; t1: number; anchor: boolean };

/** Spreads `slots` over [a, b] by text length (longer words take longer to say). */
function spread(slots: Slot[], a: number, b: number): void {
  const total = slots.reduce((s, x) => s + x.text.length, 0) || 1;
  let t = a;
  for (const x of slots) {
    const d = ((b - a) * x.text.length) / total;
    x.t0 = t; x.t1 = t + d; t += d;
  }
}

/**
 * Captions with the script's words and the speech's timing. `heard`: recognized words in timeline seconds;
 * `speech`: where there is speech (VAD), to tell a skipped stretch of script from words recognition missed.
 * Null when the script does not belong to this speech (under half of the heard words found a pair) or is empty.
 */
export function alignScript(script: string, heard: CaptionWord[], speech?: [number, number][]): ScriptCaptions | null {
  const tokens = tokenize(script);
  const hw = heard.filter((x) => normWord(x.text));
  if (!tokens.length || !hw.length || tokens.length * hw.length > MAX_CELLS) return null;
  const aligned = align(tokens, hw.map((x) => normWord(x.text)));
  const heardOf = (o: Op) => (o.kind === 'pair2h' ? 2 : o.kind === 'heard' || o.kind === 'pair' || o.kind === 'pair2s' ? 1 : 0);
  const isGood = (o: Op) => (o.kind === 'pair' && o.cost <= 0.5) || ((o.kind === 'pair2h' || o.kind === 'pair2s') && o.cost <= 0.4);
  const good = aligned.reduce((k, o) => k + (isGood(o) ? heardOf(o) : 0), 0);
  // The script belongs to this speech when most heard words sit in runs of ≥ 3 matches: a different text on the same
  // topic matches scattered words ("ролик", "музыка"), never long stretches.
  // One word the recognizer missed (under music) does not break a run; very short speech needs no run at all.
  const minRun = hw.length < 6 ? 1 : 3;
  let inRuns = 0;
  for (let i = 0; i < aligned.length;) {
    if (!isGood(aligned[i])) { i++; continue; }
    let j = i, k = 0, n = 0;
    while (j < aligned.length) {
      if (isGood(aligned[j])) { k += heardOf(aligned[j++]); n++; }
      else if (aligned[j].kind === 'script' && j + 1 < aligned.length && isGood(aligned[j + 1])) j++;
      else break;
    }
    if (n >= minRun) inRuns += k;
    i = j;
  }
  if (inRuns / hw.length < 0.5) return null;
  const { ops, replaced } = splitDivergence(aligned);

  // Anchors carry timing; script-only words wait for it.
  const slots: (Slot & { pending?: boolean; adlib?: boolean })[] = [];
  let adlibs = 0;
  for (const o of ops) {
    if (o.kind === 'pair') slots.push({ text: tokens[o.s].text, t0: hw[o.h].t0, t1: hw[o.h].t1, anchor: true });
    else if (o.kind === 'pair2h') slots.push({ text: tokens[o.s].text, t0: hw[o.h].t0, t1: hw[o.h + 1].t1, anchor: true });
    else if (o.kind === 'pair2s') {
      const two = [tokens[o.s], tokens[o.s + 1]].map((x) => ({ text: x.text, t0: 0, t1: 0, anchor: true }));
      spread(two, hw[o.h].t0, hw[o.h].t1);
      slots.push(...two);
    } else if (o.kind === 'script') slots.push({ text: tokens[o.s].text, t0: 0, t1: 0, anchor: false, pending: true });
    else if (!isFiller(hw[o.h].text)) { slots.push({ text: hw[o.h].text, t0: hw[o.h].t0, t1: hw[o.h].t1, anchor: true, adlib: true }); adlibs++; }
  }
  // A heard word that is just the start or the end of its neighbouring script word ("слово" next to "слова-паразиты")
  // is that word split by the recognizer, not improvisation: it joins the word instead of showing twice.
  for (let i = 0; i < slots.length; i++) {
    const x = slots[i];
    if (!x.adlib) continue;
    const w = normWord(x.text);
    const near = [slots[i + 1], slots[i - 1]].find((y, k) => {
      if (!y || y.adlib || y.pending) return false;
      const s = normWord(y.text);
      if (s.length < w.length + 3) return false;
      const part = k === 0 ? s.slice(0, w.length) : s.slice(-w.length);
      return 1 - levenshtein(w, part) / w.length >= 0.75;
    });
    if (!near) continue;
    near.t0 = Math.min(near.t0, x.t0);
    near.t1 = Math.max(near.t1, x.t1);
    slots.splice(i--, 1);
    adlibs--;
  }
  // An improvised phrase that runs into the script's next sentence ends it: "кажется, Сначала" → "кажется. Сначала".
  slots.forEach((x, i) => {
    const next = slots[i + 1];
    if (x.adlib && next && !next.adlib && /^\p{Lu}/u.test(next.text)) x.text = x.text.replace(/[,;:]$/, '.');
  });

  let skipped = replaced;
  const keep = new Set<Slot>(slots);
  for (let i = 0; i < slots.length;) {
    if (!slots[i].pending) { i++; continue; }
    let j = i;
    while (j < slots.length && slots[j].pending) j++;
    const run = slots.slice(i, j);
    const before = i > 0 ? slots[i - 1] : null, after = j < slots.length ? slots[j] : null;
    const a = before ? before.t1 : Math.max(0, (after?.t0 ?? 0) - 0.35 * run.length);
    const b = after ? after.t0 : (before?.t1 ?? 0) + 0.35 * run.length;
    const said = speech ? speechIn(speech, a, b) : b - a;
    if (said < MIN_WORD_S * run.length && (run.length >= 3 || !before && !after)) {
      for (const x of run) keep.delete(x); // never said: better to miss a word than to show one that wasn't spoken
      skipped += run.length;
    } else if (b - a >= 0.08 * run.length) {
      spread(run, a, b);
    } else if (before) {
      spread([before, ...run], before.t0, Math.max(b, before.t1)); // the recognizer merged words: share the time
    } else if (after) {
      spread([...run, after], Math.min(a, after.t0), after.t1);
    }
    i = j;
  }
  const words = slots.filter((x) => keep.has(x)).map((x) => ({ t0: x.t0, t1: Math.max(x.t1, x.t0 + 0.05), text: x.text }));
  return { words, matched: good / hw.length, skipped, adlibs };
}
