#!/usr/bin/env python3
"""Step 2 of docs/15: data/*.jsonl -> data/clean.jsonl, plus funnel.json (counts only, tracked in git)."""
import collections, glob, json, os, re, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
WINDOW = ('2025-11-09', '2026-11-09')
MOD = re.compile(r'\b(мод|модом|взлом\w*|apk|апк|крякнут\w*|modded|mod apk|cracked)\b', re.I)
UK = re.compile(r'[їєґ]', re.I)
KK = re.compile(r'[әғқңөұүһ]', re.I)
BY = re.compile(r'[ў]', re.I)
UK_WORDS = re.compile(r'\b(дуже|немає|чому|додаток|програма|працює|не можу|будь ласка)\b', re.I)


def norm(t):
    t = unicodedata.normalize('NFKC', t).lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', t)).strip()


def language(t):
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return 'none'
    cyr = sum('Ѐ' <= c <= 'ӿ' for c in letters) / len(letters)
    if cyr >= 0.5:
        if UK.search(t) or UK_WORDS.search(t):
            return 'uk'
        if KK.search(t):
            return 'kk'
        if BY.search(t):
            return 'be'
        return 'ru'
    if cyr > 0.1:
        return 'mixed'
    return 'latin'


def main():
    funnel = collections.defaultdict(collections.Counter)
    seen_id, seen_text = set(), set()
    out = open(os.path.join(DATA, 'clean.tmp'), 'w', encoding='utf8')
    for path in sorted(glob.glob(os.path.join(DATA, '*.jsonl'))):
        name = os.path.basename(path)
        if name.startswith(('clean', 'sample', 'labels', 'mods')):
            continue
        for line in open(path, encoding='utf8'):
            r = json.loads(line)
            s = r['source']
            f = funnel[s]
            f['raw'] += 1
            text = (r.get('text') or '').strip()
            if not text:
                f['drop_empty'] += 1
                continue
            key = s + '|' + r['id']
            if key in seen_id:
                f['drop_dup_id'] += 1
                continue
            seen_id.add(key)
            n = norm(text)
            if len(n.split()) >= 8:
                tkey = s + '|' + n
                if tkey in seen_text:
                    f['drop_dup_text'] += 1
                    continue
                seen_text.add(tkey)
            d = r.get('date') or ''
            r['period'] = 'undated' if not d else 'older' if d < WINDOW[0] else 'main'
            if d and d >= '2026-08-11':
                r['now90'] = True
            r['text_lang'] = language(text)
            r['words'] = len(n.split())
            r['mod'] = bool(MOD.search(text))
            f['period_' + r['period']] += 1
            f['lang_' + r['text_lang']] += 1
            if r['mod']:
                f['flag_mod'] += 1
            f['kept'] += 1
            out.write(json.dumps(r, ensure_ascii=False) + '\n')
    out.close()
    os.replace(os.path.join(DATA, 'clean.tmp'), os.path.join(DATA, 'clean.jsonl'))
    with open(os.path.join(HERE, 'funnel.json'), 'w', encoding='utf8') as f:
        json.dump({k: dict(v) for k, v in sorted(funnel.items())}, f, ensure_ascii=False, indent=1)
    for k, v in sorted(funnel.items()):
        print(k, dict(v))


if __name__ == '__main__':
    main()
