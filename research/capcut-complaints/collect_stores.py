#!/usr/bin/env python3
"""Tier 1 of docs/15: public store reviews of CapCut into data/*.jsonl.

Usage: python3 -I collect_stores.py gp ru | gp en | as
Author names exist only in memory, as salted hashes; the disk gets the cluster size.
"""
import collections, datetime as dt, hashlib, json, os, secrets, sys, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
UA = 'Mozilla/5.0 (compatible; research-probe)'
APP = 'com.lemon.lvoverseas'
ASID = '1500855883'
WINDOW_START = dt.datetime(2025, 11, 9, tzinfo=dt.timezone.utc).timestamp()
PAUSE = 1.2
SALT = secrets.token_bytes(16)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')


def author_key(name):
    return hashlib.sha256(SALT + (name or '').encode('utf8')).digest()


def save(path, rows, authors):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf8') as f:
        for key, row in rows:
            row = dict(row, author_cluster=authors[key])
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    os.replace(tmp, path)


def gp_page(lang, token):
    tok = json.dumps(token) if token else 'null'
    inner = '[null,null,[2,2,[200,null,%s],null,[null,null]],["%s",7]]' % (tok, APP)
    req = json.dumps([[["UsvDTd", inner, None, "generic"]]], separators=(',', ':'))
    body = urllib.parse.urlencode({'f.req': req}).encode()
    url = 'https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=%s&gl=%s' % (lang, 'ru' if lang == 'ru' else 'us')
    r = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA})
    text = urllib.request.urlopen(r, timeout=40).read().decode('utf8')
    payload = json.loads(json.loads(text[5:])[0][2])
    next_token = payload[1][-1] if len(payload) > 1 and payload[1] else None
    return payload[0] or [], next_token


def collect_gp(lang):
    source = 'gp-' + lang
    path = os.path.join(DATA, source + '.jsonl')
    rows, authors, seen = [], collections.Counter(), set()
    token, pages, stop = None, 0, 'token ended'
    while True:
        for attempt in range(4):
            try:
                reviews, token = gp_page(lang, token)
                break
            except (urllib.error.URLError, TimeoutError, ValueError, IndexError, TypeError) as e:
                code = getattr(e, 'code', None)
                if code in (403, 429) or attempt == 3:
                    print(source, 'stopped on', repr(e), flush=True)
                    reviews, token = None, None
                    stop = 'error: ' + repr(e)
                    break
                time.sleep(5 * (attempt + 1))
        if reviews is None:
            break
        pages += 1
        oldest = None
        for x in reviews:
            ts = x[5][0]
            oldest = ts
            if x[0] in seen or ts < WINDOW_START:
                continue
            seen.add(x[0])
            key = author_key(x[1][0] if x[1] else '')
            authors[key] += 1
            rows.append((key, {
                'id': x[0], 'source': source, 'url': '', 'lang': lang, 'storefront': '',
                'date': dt.datetime.fromtimestamp(ts, dt.timezone.utc).date().isoformat(),
                'stars': x[2], 'app_version': x[10] or '', 'os': 'android', 'text': x[4] or '',
                'likes': x[6] or 0, 'fetched_at': now(), 'found_by': 'full',
            }))
        if pages % 25 == 0:
            save(path, rows, authors)
            print(source, 'pages', pages, 'rows', len(rows), 'oldest', dt.datetime.fromtimestamp(oldest, dt.timezone.utc).date() if oldest else None, flush=True)
        if oldest is not None and oldest < WINDOW_START:
            stop = 'window start reached'
            break
        if not token or not reviews:
            break
        time.sleep(PAUSE)
    save(path, rows, authors)
    print(source, 'DONE pages', pages, 'rows', len(rows), 'stop:', stop, flush=True)


def collect_as():
    for cc in ('ru', 'by', 'kz'):
        source = 'as-' + cc
        path = os.path.join(DATA, source + '.jsonl')
        rows, authors, seen = [], collections.Counter(), set()
        for page in range(1, 11):
            url = f'https://itunes.apple.com/{cc}/rss/customerreviews/page={page}/id={ASID}/sortby=mostrecent/json'
            try:
                d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30))
            except Exception as e:
                print(source, 'page', page, 'stopped on', repr(e), flush=True)
                break
            for x in d['feed'].get('entry', []):
                if 'content' not in x or x['id']['label'] in seen:
                    continue
                seen.add(x['id']['label'])
                # author.uri is deliberately never read
                key = author_key(x['author']['name']['label'])
                authors[key] += 1
                rows.append((key, {
                    'id': x['id']['label'], 'source': source, 'url': '', 'lang': '', 'storefront': cc,
                    'date': x['updated']['label'][:10], 'stars': int(x['im:rating']['label']),
                    'app_version': x.get('im:version', {}).get('label', ''), 'os': 'ios',
                    'text': (x['title']['label'] + '. ' + x['content']['label']).strip(),
                    'likes': int(x.get('im:voteSum', {}).get('label', 0)), 'fetched_at': now(), 'found_by': 'full',
                }))
            time.sleep(PAUSE)
        save(path, rows, authors)
        print(source, 'DONE rows', len(rows), flush=True)


if __name__ == '__main__':
    if sys.argv[1] == 'as':
        collect_as()
    else:
        collect_gp(sys.argv[2])
