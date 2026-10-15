import { describe, expect, it } from 'vitest';
import { TASK_IDS } from '../src/ui/tasks';
import { LANGS, buildSite } from './render';
import { PAGES } from './tasks';

const SITE = 'https://example.test/Kadr/';
const files = buildSite(SITE);
const html = Object.entries(files).filter(([f]) => f.endsWith('.html'));
const tag = (s: string, re: RegExp) => re.exec(s)?.[1] ?? '';
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

describe('task pages (docs/08 C)', () => {
  it('cover every app task once, in both languages: 10 × 2 pages plus two hubs', () => {
    expect(PAGES.map((p) => p.task).sort()).toEqual([...TASK_IDS].sort());
    expect(html.length).toBe(PAGES.length * LANGS.length + LANGS.length);
  });

  it('every page fits the limits: title ≤ 60, description ≤ 160, 3–5 steps, 3–4 questions, ≤ 20 KB', () => {
    for (const [f, s] of html) {
      expect(decode(tag(s, /<title>(.*?)<\/title>/)).length, f).toBeLessThanOrEqual(60);
      expect(decode(tag(s, /<meta name="description" content="(.*?)">/)).length, f).toBeLessThanOrEqual(160);
      expect(Buffer.byteLength(s), f).toBeLessThanOrEqual(20_000);
      expect(s, f).toMatch(/<h1>.+<\/h1>/);
    }
    for (const p of PAGES) for (const l of LANGS) {
      expect(p.steps[l].length).toBeGreaterThanOrEqual(3);
      expect(p.steps[l].length).toBeLessThanOrEqual(5);
      expect(p.faq[l].length).toBeGreaterThanOrEqual(3);
      expect(p.faq[l].length).toBeLessThanOrEqual(4);
    }
  });

  it('titles, descriptions and H1s are unique', () => {
    for (const re of [/<title>(.*?)<\/title>/, /<meta name="description" content="(.*?)">/, /<h1>(.*?)<\/h1>/]) {
      const all = html.map(([, s]) => tag(s, re));
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('JSON-LD parses, with SoftwareApplication, HowTo and FAQPage on task pages', () => {
    for (const [f, s] of html) {
      const ld = JSON.parse(tag(s, /<script type="application\/ld\+json">(.*?)<\/script>/s)) as { '@graph'?: { '@type': string }[]; '@type'?: string };
      const types = ld['@graph']?.map((x) => x['@type']) ?? [ld['@type']];
      if (f.split('/').length === 3) expect(types, f).toEqual(['SoftwareApplication', 'HowTo', 'FAQPage']);
      else expect(types, f).toEqual(['SoftwareApplication']);
    }
  });

  it('has no scripts or third-party requests, and links only to pages that exist or to app tasks', () => {
    for (const [f, s] of html) {
      expect(s.match(/<script(?! type="application\/ld\+json")/g), f).toBeNull();
      expect(s.match(/(?:src|href)="https?:\/\/(?!example\.test\/Kadr\/)/g), f).toBeNull();
      for (const href of [...s.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])) {
        const url = new URL(href, SITE + f);
        expect(url.href.startsWith(SITE), `${f} → ${href}`).toBe(true);
        const rel = url.pathname.slice(new URL(SITE).pathname.length);
        if (url.hash) {
          expect(rel, `${f} → ${href}`).toBe('');
          expect(TASK_IDS as readonly string[], `${f} → ${href}`).toContain(url.hash.replace('#/start/', ''));
        } else if (rel) expect(files[`${rel}index.html`], `${f} → ${href}`).toBeDefined();
      }
    }
  });

  it('canonical and hreflang are absolute; the sitemap lists every page', () => {
    for (const [f, s] of html) {
      expect(tag(s, /<link rel="canonical" href="(.*?)">/), f).toBe(SITE + f.replace(/index\.html$/, ''));
      for (const l of LANGS) expect(s, f).toMatch(new RegExp(`hreflang="${l}" href="${SITE.replace(/\./g, '\\.')}${l}/`));
    }
    const locs = [...files['sitemap.xml'].matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe(html.length + 1);
    expect(files['robots.txt']).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });
});
