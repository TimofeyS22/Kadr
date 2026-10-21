// Honest progress for long on-device jobs (docs/09 Q4; the idea is Concat's panes/pace.rs, the code is ours).
// Jobs report rarely — once per 30 s of speech, or not at all while the model loads — so a bar fed only those reports
// sits still and then jumps, or even runs back. Here a run is laid out as stages sized by how long each is expected to
// take. Between reports the bar creeps toward the end of the current stage but never reaches it until the job says the
// stage is over, and it never moves backwards.

export interface PaceStage { id: string; /** Expected seconds. */ expected: number }
export interface Pace {
  stages: PaceStage[];
  /** Where each stage starts and ends on the bar (0..1). */
  spans: { a: number; b: number }[];
  /** Current stage, its reported fraction (null: the job cannot tell), the last report and the stage start (ms). */
  i: number; f: number | null; at: number; started: number;
  /** Last value shown: the bar never goes below it. */
  shown: number;
  /** Seconds each finished stage took. */
  took: Record<string, number>;
}

/** Share of the gap to the stage's end the bar may cover on its own: the last stretch waits for the job. */
const CREEP = 0.9;
/** Every stage keeps a visible slice of the bar, however quick it is expected to be. */
const MIN_SHARE = 0.03;
/**
 * Short of a stage's end by this share of it until the job moves on. A job's f = 1 means the part it can measure is
 * done (a track downloaded), not the stage (the track still has to be read and placed): the bar sat at 100% meanwhile.
 */
const HOLD = 0.01;

export function startPace(stages: PaceStage[], now: number): Pace {
  const w = stages.map((s) => Math.max(0, s.expected));
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const shares = w.map((x) => Math.max(MIN_SHARE, x / total));
  const norm = shares.reduce((a, b) => a + b, 0);
  let a = 0;
  const spans = shares.map((x) => { const s = { a, b: a + x / norm }; a = s.b; return s; });
  return { stages, spans, i: 0, f: null, at: now, started: now, shown: 0, took: {} };
}

/** The job reports stage `id` (later stages may skip earlier ones: a cached model) and, if it knows, its fraction. */
export function reportPace(p: Pace, id: string, f: number | null, now: number): void {
  const i = p.stages.findIndex((s) => s.id === id);
  if (i < 0 || i < p.i) return;
  if (i > p.i) {
    p.took[p.stages[p.i].id] = (now - p.started) / 1000;
    p.i = i;
    p.started = now;
    p.f = null;
  }
  if (f !== null) p.f = Math.max(p.f ?? 0, Math.min(1, f));
  p.at = now;
}

/** The value to draw now, 0..1: monotonic, below the current stage's end until the job moves on. */
export function paceAt(p: Pace, now: number): number {
  const { a, b } = p.spans[p.i];
  const f = p.f ?? 0;
  const floor = a + Math.min(f, 1 - HOLD) * (b - a);
  // Time constant: what is left of the stage by expectation (at least 0.3 s, so a tiny stage does not snap).
  const tau = Math.max(0.3, p.stages[p.i].expected * (1 - f));
  const dt = Math.max(0, now - p.at) / 1000;
  const value = floor + (b - floor) * CREEP * (dt / (dt + tau));
  p.shown = Math.max(p.shown, Math.min(value, b - HOLD * (b - a)));
  return p.shown;
}

/** The run is over: the bar may fill. Returns how long each stage took (the last one included). */
export function finishPace(p: Pace, now: number): Record<string, number> {
  p.took[p.stages[p.i].id] = (now - p.started) / 1000;
  p.shown = 1;
  return p.took;
}
