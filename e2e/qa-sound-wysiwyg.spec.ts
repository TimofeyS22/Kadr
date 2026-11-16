// What the preview plays is what the file has, for processed sound (QA matrix Q-22, Q-23 — docs/11 §3.2): «Enhance
// voice» (noise reduction, voice EQ, compression, −16 LUFS) on one clip and the «Deep» voice effect on another, together.
// The preview is tapped on the audio thread, as in «WYSIWYG for sound» (e2e/editor.spec.ts). The check proves it can
// fail: the same preview against a file without the processing is far off.
import { expect, test, type Page } from '@playwright/test';
import { compareSound } from './soundMatch';
import { audits, exportAs, importFiles, newProject, selectClip, sheet, tool } from './qa-platform-kit';

// The preview tap of e2e/editor.spec.ts («WYSIWYG for sound»), as it is there.
/**
 * Taps the preview mixer on the audio thread: an AudioWorklet sees every 128-sample render quantum of what the
 * realtime context sends to the speakers, numbered, and outputs silence. (A ScriptProcessor runs on the main
 * thread and repeats or drops blocks when it is busy — it made dropouts that were not in the preview.)
 */
async function tapPreviewSound(page: Page) {
  const TAP = `
    registerProcessor('tap', class extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
      process(inputs) {
        const ch = inputs[0];
        for (let i = 0; i < 128; i++) this.buf[this.n + i] = ch.length > 1 ? (ch[0][i] + ch[1][i]) / 2 : ch.length ? ch[0][i] : 0;
        this.n += 128;
        if (this.n === 4096) { this.port.postMessage({ frame: currentFrame + 128 - 4096, d: this.buf }); this.buf = new Float32Array(4096); this.n = 0; }
        return true;
      }
    });`;
  await page.route('**/__tap-worklet.js', (r) => r.fulfill({ contentType: 'text/javascript', body: TAP }));
  await page.addInitScript((code) => {
    const blob = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const tap = { chunks: [] as { frame: number; d: Float32Array }[], rate: 0, error: '' };
    (window as unknown as { __tap: typeof tap }).__tap = tap;
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const ctx = this.context;
      if (args[0] instanceof AudioDestinationNode && ctx instanceof AudioContext && this instanceof GainNode) {
        const master = this;
        tap.rate = ctx.sampleRate;
        void ctx.audioWorklet.addModule(new URL('__tap-worklet.js', location.href).href).catch(() => ctx.audioWorklet.addModule(blob)).then(() => {
          const node = new AudioWorkletNode(ctx, 'tap');
          node.port.onmessage = (e: MessageEvent<{ frame: number; d: Float32Array }>) => tap.chunks.push(e.data);
          connect.call(master, node);
          connect.call(node, ctx.destination);
          (window as unknown as { __tapNode: AudioNode }).__tapNode = node;
        }, (e: unknown) => { tap.error = String(e); });
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  }, TAP);
}

/**
 * The preview, played from the start to the end in real time: what it sent to the speakers. A first short play wakes
 * the audio context (it starts suspended until a tap, which hides any delay); the measured play is the next one, as
 * most are. Right after its tap the page is kept busy for 0.8 s, as a phone is while it opens files and renders: the
 * sound must still start with the picture, not after.
 */
async function playPreviewSound(page: Page): Promise<{ played: Float32Array; rate: number }> {
  // From the start: near the end the waking play would end before its Pause (a voice-over leaves the playhead there).
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    (window as unknown as { __tap: { chunks: unknown[] } }).__tap.chunks.length = 0;
    window.addEventListener('click', (e) => { // after the app's own handler (React listens on its root)
      // The path, not the target: React has already swapped the Play icon the tap landed on for Pause.
      if (!e.composedPath().some((n) => n instanceof Element && n.classList.contains('play-btn'))) return;
      (window as unknown as { __busy: number }).__busy = ((window as unknown as { __busy?: number }).__busy ?? 0) + 1;
      const until = performance.now() + 800;
      while (performance.now() < until) { /* busy */ }
    });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 30_000 }); // stopped at the end
  const { b64, rate, gaps, error, count } = await page.evaluate(() => {
    const { chunks, rate } = (window as unknown as { __tap: { chunks: { frame: number; d: Float32Array }[]; rate: number } }).__tap;
    let gaps = 0;
    for (let k = 1; k < chunks.length; k++) if (chunks[k].frame !== chunks[k - 1].frame + 4096) gaps++;
    const all = new Float32Array(chunks.length * 4096);
    chunks.forEach((c, k) => all.set(c.d, k * 4096));
    const u = new Uint8Array(all.buffer);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { b64: btoa(s), rate, gaps, error: (window as unknown as { __tap: { error: string } }).__tap.error, count: chunks.length };
  });
  expect(error, 'the tap worklet loads').toBe('');
  expect(await page.evaluate(() => (window as unknown as { __busy?: number }).__busy), 'the page was kept busy after the tap').toBe(1);
  expect(count, 'the tap heard the preview').toBeGreaterThan(0);
  expect.soft(gaps, 'the tap saw every render quantum').toBe(0);
  const tb = Buffer.from(b64, 'base64');
  return { played: new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4), rate };
}

/** The exported sound at the preview's rate, (L + R) / 2 like the tap: ffmpeg's own `-ac 1` sums stereo at 0.707 each. */
async function exportedSound(file: string, rate: number): Promise<Float32Array> {
  const { execFileSync } = await import('node:child_process');
  const eb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  return new Float32Array(eb.buffer, eb.byteOffset, eb.byteLength / 4);
}

audits();
// The tap is test equipment: WebKit loads its worklet from a routed URL the app's CSP would refuse (as in editor.spec).
test.use({ bypassCSP: true, serviceWorkers: 'block' });

test('enhanced voice under a «Deep» voice: the preview plays the processed sound the file has, at its time and level (Q-22, Q-23)', async ({ page, browserName }, info) => {
  test.setTimeout(600_000);
  test.skip(browserName === 'chromium', 'realtime sound in headless Chromium measures the machine, not the mix (as «WYSIWYG for sound»)');
  await tapPreviewSound(page);
  await newProject(page);
  await importFiles(page, 'Audio', ['noisy_en.m4a']); // 7.9 s of speech in noise; on an empty project it keeps its length
  const noisy = page.locator('.tl-row.audio .clip').first();
  await expect(noisy).toHaveCount(1);
  await selectClip(page, noisy);
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Enhance voice' }).check();
  await expect(page.getByRole('switch', { name: 'Enhance voice' })).toBeChecked({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await importFiles(page, 'Media', ['speech_en.mp4']); // 5.9 s of speech
  const speech = page.locator('.tl-row.main .clip').first();
  await expect(speech).toHaveCount(1);
  await selectClip(page, speech);
  await tool(page, 'Voice').click();
  await sheet(page).getByRole('radio', { name: 'Deep', exact: true }).click();
  await expect(sheet(page).getByRole('radio', { name: 'Deep', exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  if (await close.isVisible()) await close.click();

  const { played, rate } = await playPreviewSound(page);
  // Both processed sounds play together over the 5.9 s of speech (the file is as long as the video).
  const windows = [['Deep speech over the enhanced voice', 0.2, 2.8], ['…and on to the end of the speech', 2.8, 5.5]] as const;
  const processed = await exportedSound(await exportAs(page, info, 'Audio', { loudness: false }), rate);
  const same = compareSound(played, processed, rate, windows);
  console.log(`WYSIWYG processed sound (${info.project.name}): ${same.header}\n${same.rows.join('\n')}`);
  expect(played.length - same.best, 'the preview played to the end').toBeGreaterThan(processed.length - rate / 2);
  expect.soft(same.drops.filter((t) => t < 1), 'the sound starts with the picture').toEqual([]);
  for (const { name, gain, rest } of same.stats) {
    expect.soft(Math.abs(gain - 1), `level, ${name}`).toBeLessThan(0.03);
    expect.soft(rest, `left over, ${name}`).toBeLessThan(0.06);
  }
  // The measure tells processed from plain: undo both, and the file no longer matches what was played.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  const plain = await exportedSound(await exportAs(page, info, 'Audio', { loudness: false }), rate);
  const other = compareSound(played, plain, rate, windows);
  console.log(`…against the plain file: ${other.rows.join(' | ')}`);
  expect(Math.min(...other.stats.map((s) => s.rest)), 'the plain file is far from the processed preview').toBeGreaterThan(0.2);
});
