// V-231 (owner, 2026-11-16: «как сделали бы лучшие мировые специалисты»): how big Kadr's video is for the quality it
// gives, against x264. Four 10 s 1080p30 sources of different difficulty are made here with ffmpeg — a talking head with
// sensor grain, a fast camera pan, synthetic screen graphics, a grainy fractal zoom (the hardest) — and each goes
//   · through Kadr: a 16:9 project, the default preset «TikTok, Reels, Shorts» (1080p30), on this engine's encoder;
//   · through x264 (preset medium) at CRF 14…32, the reference ladder (cached in fixtures/enc_x264.json).
// VMAF (libvmaf, model v0.6.1) and SSIM against the source. From the ladder: what x264 needs for Kadr's VMAF (the
// encoder's efficiency) and for VMAF 95 (what the default preset needs to spend). The thresholds are V-231's, written
// before the encoder settings change: every source at VMAF ≥ 93, and no more than 1.6× what x264 needs for VMAF 95.
//   EVAL=1 npx playwright test --project eval encoder-eval          (Chromium)
//   EVAL=1 npx playwright test --project eval-webkit encoder-eval   (WebKit)
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FIX = path.join(import.meta.dirname, '..', 'fixtures');
const FLOOR = 93; // VMAF every source keeps at the default preset
const TARGET = 95; // the quality the default preset is for: a phone screen, a social upload that is encoded again
const MAX_OVER = 1.6; // Kadr's size against what x264 needs for TARGET
const CRFS = [14, 17, 20, 23, 26, 29, 32];

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).toString();
const BT709 = ['-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const master = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '8', ...BT709, '-t', '10', '-r', '30', '-an'];

/** The sources: how each is made from what fixtures/ has (person.jpg) and ffmpeg's own generators. */
const SOURCES: Record<string, string[]> = {
  talk: ['-loop', '1', '-i', path.join(FIX, 'person.jpg'), '-filter_complex',
    "[0:v]split[a][b];[a]scale=1920:-2,boxblur=20,crop=1920:1080[bg];[b]scale=-2:1080[fg];[bg][fg]overlay=(W-w)/2:0,scale=eval=frame:w='1920*(1+0.004*t)':h=-2,crop=1920:1080,noise=alls=4:allf=t,format=yuv420p"],
  pan: ['-f', 'lavfi', '-i', 'mandelbrot=size=3840x2160:rate=30:end_pts=0.04', '-filter_complex',
    "[0:v]trim=end_frame=1,loop=loop=300:size=1:start=0,setpts=N/30/TB,crop=1920:1080:x='t*190':y=540,noise=alls=3:allf=t,format=yuv420p"],
  screen: ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-vf', 'format=yuv420p'],
  hard: ['-f', 'lavfi', '-i', 'mandelbrot=size=1920x1080:rate=30', '-vf', 'noise=alls=8:allf=t,format=yuv420p'],
};

function source(name: string): string {
  const file = path.join(FIX, `enc_${name}.mp4`);
  if (!fs.existsSync(file)) ff([...SOURCES[name], ...master, file]);
  return file;
}

const mbps = (file: string) => (fs.statSync(file).size * 8) / 10 / 1e6; // every file is 10 s
/** Pooled VMAF and SSIM (luma) of `file` against `ref`, frame by frame from the first. */
function quality(file: string, ref: string): { vmaf: number; ssim: number } {
  const log = `${file}.vmaf.json`;
  const pair = '[0:v]setpts=PTS-STARTPTS,format=yuv420p[d];[1:v]setpts=PTS-STARTPTS,format=yuv420p[r];[d][r]';
  ff(['-i', file, '-i', ref, '-lavfi', `${pair}libvmaf=n_threads=8:log_fmt=json:log_path=${log}`, '-f', 'null', '-']);
  const vmaf = (JSON.parse(fs.readFileSync(log, 'utf8')) as { pooled_metrics: { vmaf: { mean: number } } }).pooled_metrics.vmaf.mean;
  const said = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', ref, '-lavfi', `${pair}ssim`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return { vmaf, ssim: Number(said.match(/ Y:([0-9.]+)/g)?.at(-1)?.slice(3) ?? NaN) };
}

type Rung = { crf: number; mbps: number; vmaf: number };
/** x264's ladder for a source, kept between runs (it does not depend on the engine). */
function ladder(name: string, src: string): Rung[] {
  const cache = path.join(FIX, 'enc_x264.json');
  const all = (fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : {}) as Record<string, Rung[]>;
  const key = `${name}:${fs.statSync(src).size}`;
  if (!all[key]) {
    all[key] = CRFS.map((crf) => {
      const out = path.join(FIX, `enc_${name}_x264_${crf}.mp4`);
      ff(['-i', src, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), ...BT709, '-an', out]);
      return { crf, mbps: mbps(out), vmaf: quality(out, src).vmaf };
    });
    fs.writeFileSync(cache, JSON.stringify(all, null, 1));
  }
  return all[key];
}
/** The x264 rate for a VMAF, between the two rungs around it (log of the rate, linear in VMAF); the end rung past them. */
function x264At(l: Rung[], vmaf: number): number {
  const s = [...l].sort((a, b) => a.vmaf - b.vmaf);
  if (vmaf <= s[0].vmaf) return s[0].mbps;
  for (let i = 1; i < s.length; i++) {
    if (vmaf <= s[i].vmaf) {
      const f = (vmaf - s[i - 1].vmaf) / (s[i].vmaf - s[i - 1].vmaf);
      return Math.exp(Math.log(s[i - 1].mbps) + f * (Math.log(s[i].mbps) - Math.log(s[i - 1].mbps)));
    }
  }
  return s.at(-1)!.mbps;
}

async function kadrExport(page: Page, file: string, out: string): Promise<string> {
  await page.addInitScript(() => {
    for (const [k, v] of Object.entries({ 'kadr.tips': '99', 'kadr.iosFormatCard.v1': '1', 'kadr.locale': 'en', 'kadr.hint.move': '1', 'kadr.iosVideoTip.v3': '1' })) localStorage.setItem(k, v);
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'TikTok, Reels, Shorts' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 600_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await (await dl).saveAs(out);
  return out;
}

for (const name of Object.keys(SOURCES)) {
  test(`V-231 ${name}: Kadr's default preset against x264 at the same VMAF`, async ({ page }, info) => {
    test.setTimeout(1_800_000);
    const src = source(name);
    const ours = await kadrExport(page, src, info.outputPath(`kadr_${name}.mp4`));
    const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,profile,width,height,r_frame_rate,nb_read_frames,color_space,color_range', '-of', 'json', ours]).toString()).streams[0];
    const q = quality(ours, src);
    const l = ladder(name, src);
    const same = x264At(l, q.vmaf), target = x264At(l, TARGET);
    const row = `${info.project.name} ${name}: Kadr ${v.codec_name} ${v.profile} ${v.width}×${v.height} ${v.r_frame_rate} ${v.nb_read_frames} fr ${v.color_space}/${v.color_range} — ${mbps(ours).toFixed(2)} Mbit/s, VMAF ${q.vmaf.toFixed(2)}, SSIM ${q.ssim.toFixed(4)}; x264 for that VMAF ${same.toFixed(2)} (×${(mbps(ours) / same).toFixed(2)}), for VMAF ${TARGET} ${target.toFixed(2)} (×${(mbps(ours) / target).toFixed(2)}); ladder ${l.map((r) => `crf${r.crf} ${r.mbps.toFixed(2)}/${r.vmaf.toFixed(1)}`).join(' ')}`;
    console.log(row);
    fs.appendFileSync(path.join(FIX, 'enc_results.txt'), `${new Date().toISOString()} ${row}\n`);
    expect.soft(q.vmaf, `${name}: quality floor`).toBeGreaterThanOrEqual(FLOOR);
    expect.soft(mbps(ours) / target, `${name}: no more than ${MAX_OVER}× what x264 needs for VMAF ${TARGET}`).toBeLessThanOrEqual(MAX_OVER);
  });
}
