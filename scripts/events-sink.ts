// Anonymous statistics (G-3, src/lib/events.ts): only the deployed site gets a sink. CI sets KADR_EVENTS_KEY (an
// Aptabase app key, «A-EU-…»; KADR_EVENTS_URL for any other sink). The page carries it in a meta tag and its one host
// joins connect-src, so the app can reach nothing else new; the Privacy page says what is sent (seo/legal.ts). Every
// other build — local, test, e2e — has none, and the app sends nothing.

/** Where events go: the given address, or Aptabase's for the key's region; '' without a key. */
export function eventsUrl(key: string, url = ''): string {
  if (!key) return '';
  const u = url || (/^A-(EU|US)-/.test(key) ? `https://${key.slice(2, 4).toLowerCase()}.aptabase.com/api/v0/event` : '');
  const parsed = URL.canParse(u) ? new URL(u) : null;
  if (parsed?.protocol !== 'https:' || !/^[\w-]+$/.test(key)) throw new Error('KADR_EVENTS_URL must be https (or the key an Aptabase «A-EU-…» one) and KADR_EVENTS_KEY a plain key');
  return parsed.href;
}

/** index.html with the sink: its meta tag, and its origin the one host added to connect-src. Unchanged without a key. */
export function withEvents(html: string, key: string, url: string): string {
  if (!key) return html;
  const csp = "connect-src 'self' ";
  if (html.split(csp).length !== 2) throw new Error('index.html: the CSP has no single connect-src for the events host');
  return html.replace(csp, `${csp}${new URL(url).origin} `).replace('</head>', `  <meta name="kadr-events" content="${url}" data-key="${key}" />\n  </head>`);
}
