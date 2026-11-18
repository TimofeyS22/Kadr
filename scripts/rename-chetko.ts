// Stage Ч5 of docs/17: the product is renamed Kadr → Chetko, «Чётко» in Russian text. The rename runs once, on a fresh
// main, in the window the lead names after a release (other lanes carry edits into the same files, so a hand-made commit
// would rot while the owner checks the register). It is deterministic: general rules where they are safe (the interface's
// strings, the messages, the site's texts) and exact pairs elsewhere. scripts/rename-chetko.test.ts proves on today's tree
// that nothing visible keeps the old name, that every exact pair still finds its line, and that a second run changes nothing.
//   node scripts/rename-chetko.ts          rewrite the files
//   node scripts/rename-chetko.ts --check  list what would change, exit 1 if anything would
//
// What keeps the old name: the storage keys `kadr.*`, IndexedDB and cache names, the site's address /Kadr/ and the repo,
// the package, telemetry, the backup format (`.kadr`), inner names a person never reads, and test data typed into projects.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** Lines that keep «Kadr» on purpose. */
export const KEEP: RegExp[] = [
  /Kadr Custom/, // the CSS family of a person's own font: an inner name (src/engine/text.ts)
  /Kadr font check/, // the FontFace a font file is tried with (src/engine/customFonts.ts)
  /TimofeyS22\/Kadr/, /\/Kadr\//, /KADR_BASE/, // the repo and the site's address stay
  /withKadr/, // a test helper's name
  /Hello from Kadr|hello from Kadr|Kadr 2026|fill\('Kadr'\)|"text":"Kadr"|welcome to Kadr/, // words typed into a project or a subtitle file
];

/** Russian: the name is quoted in running text (unquoted, «чётко» reads as an adverb) and is neuter. */
const RU_GRAMMAR: [string, string][] = [
  ['(«Чётко» определил сам)', '(«Чётко» определило само)'],
  ['«Чётко» обновился.', '«Чётко» обновилось.'],
  ['«Чётко» сам берёт', '«Чётко» само берёт'],
  ['«Чётко» не запустился', '«Чётко» не запустилось'],
  ['Сам «Чётко»', 'Само «Чётко»'],
  ['«Чётко» сам ', '«Чётко» само '],
  ['находит человека сам', 'находит человека само'],
  ['построен «Чётко»', 'построено «Чётко»'],
  ['«Чётко» построен ', '«Чётко» построено '],
  ['После первого визита он работает', 'После первого визита оно работает'],
];
const ruText = (s: string) => {
  let t = s.replace(/ \| Kadr\b/g, ' | Чётко').replace(/(['`])Kadr — (бесплатный)/g, '$1Чётко — $2').replace(/ — Kadr(['`])/g, ' — Чётко$1').replace(/\bKadr\b/g, '«Чётко»');
  for (const [a, b] of RU_GRAMMAR) t = t.split(a).join(b);
  return t;
};
const CYRILLIC = /[А-Яа-яЁё]/;
const kept = (line: string) => KEEP.some((re) => re.test(line));
/** The code of a line without its trailing `// comment` (a URL's `//` inside a string is left alone: it has no space before). */
const codeOf = (line: string): [string, string] => {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return ['', line];
  const i = line.search(/\s\/\/\s/);
  return i < 0 ? [line, ''] : [line.slice(0, i), line.slice(i)];
};

/** Exact pairs: [file, before, after]. Each must find its line on today's tree (or its result, once renamed). */
export const PAIRS: [string, string, string][] = [
  ['src/ui/Home.tsx', "{t('Projects and media are stored in this browser.')} Kadr v{__APP_VERSION__}", "{t('Projects and media are stored in this browser.')} {locale === 'ru' ? 'Чётко' : 'Chetko'} v{__APP_VERSION__}"],
  ['public/boot.js', "'Kadr не запустился: версия на устройстве не загрузилась. Ваши проекты не тронуты.' : 'Kadr did not start:", "'«Чётко» не запустилось: версия на устройстве не загрузилась. Ваши проекты не тронуты.' : 'Chetko did not start:"],
  ['index.html', '    <title>Kadr</title>\n', '    <meta name="apple-mobile-web-app-title" content="Chetko" />\n    <title>Chetko</title>\n'],
  ['vite.config.ts', "html.replace('<title>Kadr</title>',", "html.replace('<title>Chetko</title>',"],
  ['vite.config.ts', "        name: 'Kadr — video editor',\n        short_name: 'Kadr',", "        name: 'Chetko — video editor',\n        short_name: 'Chetko',"],
  ['vite.config.ts', "'Open-source software in Kadr, and the notices", "'Open-source software in Chetko, and the notices"],
  ['vite.config.ts', '// Android: "Share → Kadr" from the gallery', '// Android: "Share → Chetko" from the gallery'],
  ['seo/render.ts', '<meta property="og:site_name" content="Kadr">\n<meta property="og:title"', "<meta property=\"og:site_name\" content=\"${o.lang === 'ru' ? 'Чётко' : 'Chetko'}\">\n<meta property=\"og:title\""],
  ['seo/render.ts', '<header><a class="brand" href="${o.root}">Kadr</a>', "<header><a class=\"brand\" href=\"${o.root}\">${o.lang === 'ru' ? 'Чётко' : 'Chetko'}</a>"],
  ['seo/render.ts', "'@type': 'SoftwareApplication', name: 'Kadr', url: site,", "'@type': 'SoftwareApplication', name: 'Chetko', alternateName: 'Чётко', url: site,"],
  ['seo/render.ts', "    '<meta property=\"og:site_name\" content=\"Kadr\">',", "    '<meta property=\"og:site_name\" content=\"Chetko\">',"],
  ['seo/tasks.verify.test.ts', "    const shown: Record<Lang, Set<string>> = { ru: new Set(Object.values(RU)), en: new Set(Object.keys(RU)) };", "    // The product's own name is in quotes in Russian text (it reads as a word otherwise), and Home shows it as its mark.\n    const shown: Record<Lang, Set<string>> = { ru: new Set([...Object.values(RU), 'Чётко']), en: new Set([...Object.keys(RU), 'Chetko']) };"],
  ['seo/tasks-steps.test.ts', "const shown: Record<Lang, Set<string>> = { ru: new Set(Object.values(RU)), en: new Set(Object.keys(RU)) };", "// The product's own name is quoted in Russian text and shown on Home as its mark (Ч5).\nconst shown: Record<Lang, Set<string>> = { ru: new Set([...Object.values(RU), 'Чётко']), en: new Set([...Object.keys(RU), 'Chetko']) };"],
  ['seo/render.test.ts', '/в меню «Поделиться» Kadr не появится/', '/в меню «Поделиться» «Чётко» не появится/'],
  ['seo/render.test.ts', '/Kadr won’t appear in its Share menu/', '/Chetko won’t appear in its Share menu/'],
  ['src/lib/events.test.ts', "RU['Not enough storage for Kadr on this device.", "RU['Not enough storage for Chetko on this device."],
  ['src/lib/events.test.ts', ".toBe('Not enough storage for Kadr on this device.", ".toBe('Not enough storage for Chetko on this device."],
  ['src/lib/update.test.ts', "'Part of Kadr did not load. Reload the page.'", "'Part of Chetko did not load. Reload the page.'"],
  ['src/lib/update.test.ts', "'Part of Kadr did not load. The page reloads when the current job ends.'", "'Part of Chetko did not load. The page reloads when the current job ends.'"],
  ['src/lib/update.test.ts', "'Kadr has been updated. The page reloads when the current job ends.'", "'Chetko has been updated. The page reloads when the current job ends.'"],
  ['e2e/editor.spec.ts', "toContainText('found by Kadr')", "toContainText('found by Chetko')"],
  ['e2e/editor.spec.ts', "{ name: 'Open Kadr' }", "{ name: 'Open Chetko' }"],
  ['e2e/editor.spec.ts', 'toContainText(`Kadr v${version}`)', 'toContainText(`Chetko v${version}`)'],
  ['e2e/editor.spec.ts', "toContain('not a Kadr project backup')", "toContain('not a Chetko project backup')"],
  ['e2e/qa-chetko-screens.spec.ts', 'toContainText(/Kadr v\\d/)', 'toContainText(/(Chetko|Чётко) v\\d/)'],
  ['e2e/qa-chetko-screens.spec.ts', "toContainText('Kadr ')", "toContainText('Chetko ')"],
  ['e2e/qa-deploy-skew.spec.ts', '/^info: (Kadr обновился|Часть Kadr не загрузилась)\\. Перезагру/', '/^info: («Чётко» обновилось|Часть «Чётко» не загрузилась)\\. Перезагру/'],
  ['e2e/qa-error-details.spec.ts', '/^Kadr \\d+\\.\\d+\\.\\d+, \\d{4}', '/^Chetko \\d+\\.\\d+\\.\\d+, \\d{4}'],
  ['e2e/qa-error-details.spec.ts', '\\S+: Kadr [\\d.]+, captions', '\\S+: Chetko [\\d.]+, captions'],
  ['e2e/qa-inapp-and-install.spec.ts', 'Open Kadr in Safari.', 'Open Chetko in Safari.'],
  ['e2e/qa-inapp-and-install.spec.ts', "{ name: 'Link to Kadr' }", "{ name: 'Link to Chetko' }"],
  ['e2e/qa-inapp-and-install.spec.ts', "{ name: 'Install Kadr' }", "{ name: 'Install Chetko' }"],
  ['e2e/qa-inapp-and-install.spec.ts', 'Open Kadr in Chrome.', 'Open Chetko in Chrome.'],
  ['e2e/qa-inapp-and-install.spec.ts', 'Add Kadr to the Home Screen and make', 'Add Chetko to the Home Screen and make'],
  ['e2e/qa-inapp-and-install.spec.ts', 'To bring one here, open Kadr in Safari,', 'To bring one here, open Chetko in Safari,'],
  ['e2e/qa-media-newer.spec.ts', "'newer version of Kadr'", "'newer version of Chetko'"],
  ['e2e/qa-media-sample.spec.ts', "{ hasText: 'Kadr' }", "{ hasText: 'Чётко' }"],
  ['e2e/qa-media-sample.spec.ts', "toContainText('Сделано в Kadr')", "toContainText('Сделано в «Чётко»')"],
  ['e2e/qa-smoke.spec.ts', 'toContainText(`Kadr v${version}`)', 'toContainText(`Chetko v${version}`)'],
  ['e2e/qa-storage.spec.ts', "'Not enough storage for Kadr on this device'", "'Not enough storage for Chetko on this device'"],
  ['e2e/qa-storage.spec.ts', "hasText: 'Add Kadr to the Home Screen'", "hasText: 'Add Chetko to the Home Screen'"],
];

/** The files the rename may touch, relative to the repository. */
export function targets(): string[] {
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
  return [...walk('src'), ...walk('seo'), 'public/boot.js', 'index.html', 'vite.config.ts', ...new Set(PAIRS.map(([f]) => f).filter((f) => f.startsWith('e2e/')))];
}

/** The text of `file` once renamed. Pure: no file is read or written here. */
export function transform(file: string, text: string): string {
  let out = text;
  for (const [f, a, b] of PAIRS) if (f === file) out = out.split(a).join(b);
  const lines = out.split('\n');
  if (file === 'src/lib/locale-ru.ts') {
    return lines.map((l) => {
      const m = /^( {2}')((?:[^'\\]|\\.)*)(': ')((?:[^'\\]|\\.)*)(',.*)$/.exec(l);
      if (!m || !l.includes('Kadr')) return l;
      return m[1] + m[2].replace(/\bKadr\b/g, 'Chetko') + m[3] + ruText(m[4]) + m[5];
    }).join('\n');
  }
  if (file === 'seo/tasks.ts' || file === 'seo/legal.ts') {
    return lines.map((l) => {
      if (!l.includes('Kadr') || kept(l) || /^\s*\/\//.test(l)) return l;
      return l.replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (lit) => (!lit.includes('Kadr') ? lit : CYRILLIC.test(lit) ? ruText(lit) : lit.replace(/\bKadr\b/g, 'Chetko')));
    }).join('\n');
  }
  if (file.startsWith('src/') && !/\.test\.tsx?$/.test(file)) {
    return lines.map((l) => {
      if (!l.includes('Kadr') || kept(l)) return l;
      const [code, comment] = codeOf(l);
      return code.replace(/\bKadr\b/g, 'Chetko') + comment;
    }).join('\n');
  }
  return out;
}

/** Lines of a renamed text that still show «Kadr» to a person (outside comments and the kept lines). */
export function visibleOld(file: string, text: string): string[] {
  if (!/^(src|seo)\//.test(file) && !['public/boot.js', 'index.html', 'vite.config.ts'].includes(file)) return [];
  if (/\.test\.tsx?$/.test(file)) return [];
  return text.split('\n').filter((l) => /\bKadr\b/.test(codeOf(l)[0]) && !kept(l));
}

if (import.meta.main ?? process.argv[1]?.endsWith('rename-chetko.ts')) {
  const check = process.argv.includes('--check');
  let changed = 0;
  for (const file of targets()) {
    const before = readFileSync(join(ROOT, file), 'utf8');
    const after = transform(file, before);
    if (after === before) continue;
    changed++;
    console.log(`${check ? 'would change' : 'renamed'}: ${relative(ROOT, join(ROOT, file))}`);
    if (!check) writeFileSync(join(ROOT, file), after);
  }
  console.log(`${changed} file(s)`);
  if (check && changed) process.exit(1);
}
