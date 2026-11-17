import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSite } from '../seo/render';
import { eventsUrl, withEvents } from './events-sink';

const html = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8'); // the page the app is built from
const hostsOf = (page: string) => page.match(/connect-src ([^;"]+)/)![1].trim().split(/\s+/);

describe('the anonymous statistics sink in the built page (G-3)', () => {
  it('a build without a key is the page as it is: no sink, no new host', () => {
    expect(eventsUrl('')).toBe('');
    expect(withEvents(html, '', '')).toBe(html);
  });

  it('an Aptabase key brings its region\'s address, the meta tag, and that one host in connect-src', () => {
    const url = eventsUrl('A-EU-1234567890');
    expect(url).toBe('https://eu.aptabase.com/api/v0/event');
    expect(eventsUrl('A-US-1')).toBe('https://us.aptabase.com/api/v0/event');
    const page = withEvents(html, 'A-EU-1234567890', url);
    expect(page).toContain('<meta name="kadr-events" content="https://eu.aptabase.com/api/v0/event" data-key="A-EU-1234567890" />');
    expect(hostsOf(page).filter((h) => !hostsOf(html).includes(h))).toEqual(['https://eu.aptabase.com']);
    expect(page.replace(/\s*<meta name="kadr-events"[^>]*>/, '').replace(' https://eu.aptabase.com', '')).toBe(html);
  });

  it('any other sink is named by its address, which must be https; a key is a plain word', () => {
    expect(eventsUrl('k1', 'https://stats.example.org/api/v0/event')).toBe('https://stats.example.org/api/v0/event');
    expect(() => eventsUrl('k1', 'http://stats.example.org/e')).toThrow(/https/);
    expect(() => eventsUrl('A-EU-1" onload="x')).toThrow(/plain key/);
    expect(() => eventsUrl('no-region-key')).toThrow(/https/);
  });
});

describe('the Privacy page says what the build does (G-3)', () => {
  it('without a sink: nothing leaves the device; with one: what goes, where, and how to say no, in both languages', () => {
    const off = buildSite('https://example.org/'), on = buildSite('https://example.org/', 'eu.aptabase.com');
    expect(off['ru/privacy/index.html']).toContain('Нет телеметрии, уходящей с устройства');
    expect(off['en/privacy/index.html']).toContain('No telemetry leaves the device');
    for (const [lang, said, no] of [['ru', 'Обезличенная статистика', 'Нет телеметрии'], ['en', 'Anonymous statistics', 'No telemetry']]) {
      const html = on[`${lang}/privacy/index.html`];
      expect(html).toContain(said);
      expect(html).toContain('eu.aptabase.com (Aptabase');
      expect(html).not.toContain(no);
    }
    expect(Object.keys(on).filter((f) => on[f] !== off[f])).toEqual(['ru/privacy/index.html', 'en/privacy/index.html']);
  });
});
