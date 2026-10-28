// Task pages (docs/08 C): static HTML from seo/tasks.ts, built by the Vite plugin in vite.config.ts.
// No JS, no third-party requests, CSS inline and pinned by hash in the page's CSP. Links are relative, so the pages
// work under any base path; canonical, hreflang and the sitemap use the absolute site URL.
import { createHash } from 'node:crypto';
import { LEGAL, LICENSES, PRIVACY, legalPath, type LegalId } from './legal.ts';
import { PAGES, UI, type Lang, type TaskPage } from './tasks.ts';

export const LANGS: Lang[] = ['ru', 'en'];
/** Where the production build lives (GitHub Pages); KADR_SITE overrides it. */
export const DEFAULT_SITE = 'https://timofeys22.github.io/Kadr/';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a <script type="application/ld+json">: `<` escaped so text can never close the tag. */
const ldJson = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

export const pagePath = (p: TaskPage, lang: Lang) => `${lang}/${p.slug[lang]}/`;
export const hubPath = (lang: Lang) => `${lang}/`;

const CSS = `
:root{color-scheme:dark;--bg:#161616;--panel:#1f1f1f;--text:#f2f2f2;--muted:#a6a6a6;--accent:#ffc53d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:20px 16px 40px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
header a,a{color:var(--text)}
.brand{font-weight:800;font-size:20px;text-decoration:none}
h1{font-size:28px;line-height:1.2;margin:0 0 14px}
h2{font-size:21px;margin:32px 0 10px}
h3{font-size:17px;margin:16px 0 4px}
p,li{color:var(--text)}
.muted,small{color:var(--muted)}
.cta{display:block;text-align:center;background:var(--accent);color:#161616;font-weight:700;font-size:19px;text-decoration:none;padding:16px;border-radius:14px;margin:22px 0 6px}
.note{text-align:center;color:var(--muted);font-size:14px;margin:0}
ol,ul{padding-left:22px}
li{margin:6px 0}
.tasks{list-style:none;padding:0;display:grid;gap:8px}
.tasks a{display:block;background:var(--panel);padding:12px 14px;border-radius:12px;text-decoration:none}
footer{margin-top:36px;font-size:14px;color:var(--muted)}
`.trim().replace(/\n/g, '');
const CSS_HASH = createHash('sha256').update(CSS).digest('base64');
const CSP = `default-src 'none'; style-src 'sha256-${CSS_HASH}'; img-src 'self' data:; base-uri 'none'; form-action 'none'`;

function layout(o: {
  lang: Lang; title: string; description: string; url: string; alternates: Record<Lang, string>;
  ld: unknown; body: string; switchHref: string; root: string;
}): string {
  const other = o.lang === 'ru' ? 'en' : 'ru';
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${o.url}">
${LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${o.alternates[l]}">`).join('\n')}
<link rel="alternate" hreflang="x-default" href="${o.alternates.en}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kadr">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${o.url}">
<meta property="og:locale" content="${o.lang === 'ru' ? 'ru_RU' : 'en_US'}">
<meta name="theme-color" content="#161616">
<style>${CSS}</style>
<script type="application/ld+json">${ldJson(o.ld)}</script>
</head>
<body>
<main>
<header><a class="brand" href="${o.root}">Kadr</a><a href="${o.switchHref}" hreflang="${other}" lang="${other}">${UI[o.lang].other}</a></header>
${o.body}
<footer>${esc(UI[o.lang].footer)}</footer>
</main>
</body>
</html>
`;
}

const app = (site: string) => ({
  '@type': 'SoftwareApplication', name: 'Kadr', url: site, applicationCategory: 'MultimediaApplication',
  operatingSystem: 'iOS, Android, Windows, macOS (web browser)', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
});

/** One task page. It sits at <lang>/<slug>/, so the app is two levels up. */
export function renderTask(p: TaskPage, lang: Lang, site: string): string {
  const ui = UI[lang];
  const url = site + pagePath(p, lang);
  const others = PAGES.filter((x) => x !== p);
  const body = `<h1>${esc(p.h1[lang])}</h1>
<p>${esc(p.intro[lang])}</p>
<a class="cta" href="../../#/start/${p.task}">${esc(ui.cta)}</a>
<p class="note">${esc(ui.ctaNote)}</p>
<h2>${esc(ui.how)}</h2>
<ol>${p.steps[lang].map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
<h2>${esc(ui.why)}</h2>
<ul>${ui.whyItems.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>${esc(ui.faq)}</h2>
${p.faq[lang].map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n')}
<h2>${esc(ui.more)}</h2>
<ul class="tasks">${others.map((x) => `<li><a href="../${x.slug[lang]}/">${esc(x.h1[lang])}</a></li>`).join('')}</ul>
<p><a href="../">${esc(ui.all)}</a></p>`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      app(site),
      {
        '@type': 'HowTo', name: p.h1[lang], description: p.description[lang], inLanguage: lang,
        step: p.steps[lang].map((text, i) => ({ '@type': 'HowToStep', position: i + 1, text })),
      },
      {
        '@type': 'FAQPage', inLanguage: lang,
        mainEntity: p.faq[lang].map(([name, text]) => ({ '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text } })),
      },
    ],
  };
  const alternates = Object.fromEntries(LANGS.map((l) => [l, site + pagePath(p, l)])) as Record<Lang, string>;
  const other = lang === 'ru' ? 'en' : 'ru';
  return layout({ lang, title: p.title[lang], description: p.description[lang], url, alternates, ld, body, switchHref: `../../${pagePath(p, other)}`, root: '../../' });
}

/** The list of tasks in one language, at <lang>/. */
export function renderHub(lang: Lang, site: string): string {
  const ui = UI[lang];
  const body = `<h1>${esc(ui.hubH1)}</h1>
<p>${esc(ui.hubIntro)}</p>
<ul class="tasks">${PAGES.map((x) => `<li><a href="${x.slug[lang]}/">${esc(x.h1[lang])}</a></li>`).join('')}</ul>
<a class="cta" href="../">${esc(ui.cta)}</a>
<p class="note">${esc(ui.ctaNote)}</p>
<h2>${esc(ui.why)}</h2>
<ul>${ui.whyItems.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, site + hubPath(l)])) as Record<Lang, string>;
  const other = lang === 'ru' ? 'en' : 'ru';
  return layout({
    lang, title: ui.hubTitle, description: ui.hubDescription, url: site + hubPath(lang), alternates,
    ld: { '@context': 'https://schema.org', ...app(site), description: ui.hubDescription, inLanguage: lang }, body, switchHref: `../${hubPath(other)}`, root: '../',
  });
}

/** Text with [label](url) links, escaped. */
const linked = (s: string) => esc(s).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${url}">${label}</a>`);

/** "Privacy" or "Licenses" (seo/legal.ts) at <lang>/<id>/. */
export function renderLegal(id: LegalId, lang: Lang, site: string): string {
  const page = (id === 'privacy' ? PRIVACY : LICENSES)[lang];
  const body = `<h1>${esc(page.h1)}</h1>
<p>${linked(page.intro)}</p>
${page.sections.map((x) => `<h2>${esc(x.h)}</h2>${(x.p ?? []).map((t) => `<p>${linked(t)}</p>`).join('')}${x.items ? `<ul>${x.items.map((t) => `<li>${linked(t)}</li>`).join('')}</ul>` : ''}`).join('\n')}
<a class="cta" href="../../">${esc(UI[lang].cta)}</a>`;
  const alternates = Object.fromEntries(LANGS.map((l) => [l, site + legalPath(id, l)])) as Record<Lang, string>;
  const other = lang === 'ru' ? 'en' : 'ru';
  return layout({
    lang, title: page.title, description: page.description, url: site + legalPath(id, lang), alternates,
    ld: { '@context': 'https://schema.org', '@type': 'WebPage', name: page.h1, inLanguage: lang }, body, switchHref: `../../${legalPath(id, other)}`, root: '../../',
  });
}

/** Every generated file: path inside dist/ → contents. */
export function buildSite(site: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const lang of LANGS) {
    files[`${hubPath(lang)}index.html`] = renderHub(lang, site);
    for (const p of PAGES) files[`${pagePath(p, lang)}index.html`] = renderTask(p, lang, site);
    for (const id of LEGAL) files[`${legalPath(id, lang)}index.html`] = renderLegal(id, lang, site);
  }
  const urls = [site, ...Object.keys(files).map((f) => site + f.replace(/index\.html$/, ''))];
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  files['robots.txt'] = `User-agent: *\nAllow: /\nSitemap: ${site}sitemap.xml\n`;
  return files;
}

/** The app's own <title> (index.html), the same as its Open Graph title. */
export const APP_TITLE = UI.en.hubTitle;

/** Title, description and Open Graph for the app's own index.html. */
export function appMeta(site: string): string {
  const ui = UI.en;
  return [
    `<meta name="description" content="${esc(ui.hubDescription)}">`,
    `<link rel="canonical" href="${site}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Kadr">',
    `<meta property="og:title" content="${esc(ui.hubTitle)}">`,
    `<meta property="og:description" content="${esc(ui.hubDescription)}">`,
    `<meta property="og:url" content="${site}">`,
  ].join('\n    ');
}
