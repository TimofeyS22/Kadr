// The preview's sound against the exported file's (QA docs/11 §3.2, WYSIWYG for sound). Pure arithmetic on samples, so
// it is tested on its own (`soundMatch.unit.ts`): a measurement that reports a shift the preview does not have sends
// people after a P0 that is not there (Q-24-1).

/**
 * Lines the preview up with the export and compares them in named windows (seconds of the export). Two different
 * questions, 20 ms at a time. Delivery: a dropout is preview silence where the export is loud — the realtime engine
 * late with a buffer (a slow first decode, a starved CPU). Mix: where the preview sounds, the gain that best maps the
 * export onto it (1 = same level) and what is left over (fades, ducking, timing).
 */
export function compareSound(played: Float32Array, exported: Float32Array, rate: number, windows: readonly (readonly [string, number, number])[]) {
  // To the millisecond on 10 ms RMS (the tap starts before the sound: the clock may wait for it up to 2 s), then to the
  // sample.
  const ms = rate / 1000;
  const perMs = (x: Float32Array) => Array.from({ length: Math.floor(x.length / ms) }, (_, k) => x.subarray(k * ms, (k + 1) * ms).reduce((s, v) => s + v * v, 0));
  const pp = perMs(played), pe = perMs(exported);
  const rms10 = (e: number[], k: number) => { let v = 0; for (let j = k; j < k + 10; j++) v += e[j] ?? 0; return Math.sqrt(v); };
  // Each 10 ms RMS once, not once per lag tried (the same numbers, 3000 times fewer sums).
  const rp = Float64Array.from({ length: pe.length + 3001 }, (_, k) => rms10(pp, k)), re = Float64Array.from({ length: pe.length }, (_, k) => rms10(pe, k));
  let lagMs = 0, bestMisfit = Infinity;
  for (let l = 0; l <= 3000; l++) {
    let d = 0;
    for (let k = 0; k + 10 <= pe.length; k += 10) d += Math.abs(rp[k + l] - re[k]);
    if (d < bestMisfit) { bestMisfit = d; lagMs = l; }
  }
  const lag = lagMs * ms;
  const span = Math.min(5 * rate, exported.length);
  // How alike the preview `o` samples on is to the export over these stretches of the export: their sum of products
  // over the preview's own energy there (the export's is the same for every `o`). The bare sum also grows where the
  // moved window takes in a louder stretch of the preview, and for a tone that outweighs the true line-up: a period of
  // 330 Hz away (145 samples, 3.021 ms) the same tone matches within 0.1%, and a voice-over that swells four times a
  // second came out "3.021 ms early" or late in runs where it was exact to the sample (Q-24-1).
  const fit = (o: number, spans: readonly (readonly [number, number])[]) => {
    let xy = 0, xx = 0;
    for (const [a, b2] of spans) for (let i = a; i < b2; i++) { const p = played[i + o]; xy += p * exported[i]; xx += p * p; }
    return xx > 0 ? xy / Math.sqrt(xx) : -Infinity;
  };
  const mix = [[Math.min(rate, span / 5), span]] as const;
  let best = lag, bestFit = fit(lag, mix);
  for (let o = lag - 2 * ms; o <= lag + 2 * ms; o++) { if (o < 0) continue; const v = fit(o, mix); if (v > bestFit) { bestFit = v; best = o; } }

  const w = 20 * ms;
  const win = (i: number) => {
    let pv = 0, ev = 0;
    for (let j = i; j < i + w; j++) { pv += played[j + best] ** 2; ev += exported[j] ** 2; }
    return { p: Math.sqrt(pv / w), e: Math.sqrt(ev / w) };
  };
  const dropped = (i: number) => { const v = win(i); return v.e > 0.01 && v.p < 0.1 * v.e; };
  const drops: number[] = [];
  for (let i = Math.round(0.05 * rate); i + w <= exported.length; i += w) if (dropped(i)) drops.push(i / rate);
  const rows: string[] = [];
  const stats: { name: string; gain: number; rest: number; shiftMs: number; ownRest: number; envGain: number; envRest: number }[] = [];
  for (const [name, a, b2] of windows) {
    let xy = 0, yy = 0, rr = 0, gone = 0;
    const i0 = Math.round(a * rate), i1 = Math.round(b2 * rate);
    for (let i = i0; i + w <= i1; i += w) {
      if (dropped(i)) { gone++; continue; }
      for (let j = i; j < i + w; j++) { xy += played[j + best] * exported[j]; yy += exported[j] * exported[j]; }
    }
    const gain = xy / yy;
    for (let i = i0; i + w <= i1; i += w) if (!dropped(i)) for (let j = i; j < i + w; j++) rr += (played[j + best] - gain * exported[j]) ** 2;
    const rest = Math.sqrt(rr / yy);
    // The window on its own: is it as early or late as the rest of the mix (a sound out of time), or the same moment
    // and only coded differently? Its own best line-up within ±5 ms and what is left over there — where the preview
    // sounded, a 20 ms block clear of any dropout: a dropout lines up with nothing, and where the sound breaks off in
    // the middle of a block, a candidate that takes in more of it scores higher (a run that dropped the voice-over's
    // last 1.4 s called it 3.021 ms early; the dropout fails the test on its own).
    const heard: [number, number][] = [];
    for (let i = i0; i < i1; i += w) if (!dropped(i - w) && !dropped(i) && !dropped(i + w)) heard.push([i, Math.min(i + w, i1)]);
    let own = 0, ownFit = -Infinity;
    for (let o = -5 * ms; o <= 5 * ms; o++) { if (i0 + best + o < 0) continue; const v = fit(best + o, heard); if (v > ownFit) { ownFit = v; own = o; } }
    let oxy = 0, oyy = 0, orr = 0;
    for (const [s, e] of heard) for (let j = s; j < e; j++) { oxy += played[j + best + own] * exported[j]; oyy += exported[j] ** 2; }
    for (const [s, e] of heard) for (let j = s; j < e; j++) orr += (played[j + best + own] - (oxy / oyy) * exported[j]) ** 2;
    const shiftMs = own / ms, ownRest = Math.sqrt(orr / oyy);
    // The 10 ms loudness envelope: what a noise-like sound is heard as. AAC codes noise loosely (a whoosh came back with
    // the same level in every band and the same timing, but its waveform 25% off, mostly above 3 kHz); its envelope
    // does not care, and still moves 7% for 5 ms late and 5% for a 1 dB step.
    const envOf = (x: Float32Array, from: number) => Array.from({ length: Math.floor((i1 - i0) / (10 * ms)) }, (_, k) => { let v = 0; for (let j = 0; j < 10 * ms; j++) v += x[from + k * 10 * ms + j] ** 2; return Math.sqrt(v / (10 * ms)); });
    const pe = envOf(played, i0 + best), ee = envOf(exported, i0);
    const envGain = pe.reduce((v, x, k) => v + x * ee[k], 0) / ee.reduce((v, x) => v + x * x, 0);
    const envRest = Math.sqrt(pe.reduce((v, x, k) => v + (x - envGain * ee[k]) ** 2, 0) / ee.reduce((v, x) => v + x * x, 0));
    stats.push({ name, gain, rest, shiftMs, ownRest, envGain, envRest });
    rows.push(`${name} ${a.toFixed(2)}–${b2.toFixed(2)} s: preview ×${gain.toFixed(4)}, left over ${(rest * 100).toFixed(1)}%${gone ? `, ${gone * 20} ms dropped` : ''}; on its own ${shiftMs >= 0 ? '+' : ''}${shiftMs.toFixed(3)} ms, left over ${(ownRest * 100).toFixed(1)}%; envelope ×${envGain.toFixed(4)}, left over ${(envRest * 100).toFixed(1)}%`);
  }
  return { best, drops, stats, rows, header: `preview at ${rate} Hz, the clock waited ${(best / ms).toFixed(0)} ms; dropouts ${drops.length * 20} ms${drops.length ? ` from ${drops[0].toFixed(2)} s` : ''}` };
}
