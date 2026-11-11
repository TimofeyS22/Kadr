// The film an export shows while it is made (DESIGN.md, Progress): a few of the file's own frames between two marks.

/**
 * Which of `count` frames each of `slots` pictures of the film shows: slot k takes the frame at the start of its part,
 * so its picture is there as soon as the progress reaches it. A film shorter than its slots repeats frames, and every
 * slot still gets one. Returns frame index → the slots it fills.
 */
export function filmFrames(count: number, slots: number): Map<number, number[]> {
  const at = new Map<number, number[]>();
  if (count < 1) return at;
  for (let k = 0; k < slots; k++) {
    const i = Math.min(count - 1, Math.floor((k / slots) * count));
    at.set(i, [...(at.get(i) ?? []), k]);
  }
  return at;
}

/**
 * Seconds left of a job `done` (0 … 1) of the way after `elapsed` seconds, at the pace so far; null while too little is
 * done to say (the first 5% and 2 s hold the encoder's start-up, which says nothing about the rest).
 */
export function timeLeft(elapsed: number, done: number): number | null {
  if (done < 0.05 || elapsed < 2 || done >= 1) return null;
  return (elapsed * (1 - done)) / done;
}

/** A time left as a person says it: whole minutes from a minute up, else up to the next 5 seconds (never «0 s»). */
export function roundLeft(s: number): { min: number } | { s: number } {
  return s >= 60 ? { min: Math.ceil(s / 60) } : { s: Math.max(5, Math.ceil(s / 5) * 5) };
}
