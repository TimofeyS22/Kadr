#!/usr/bin/env python3
"""Steps 4 and 6 of docs/15: draws the labelling samples from data/clean.jsonl, seeded, into data/sample_*.jsonl.

Short ids (n1, n2...) save tokens; data/sample_key.json maps them back.
Strata: stars 1-2 / 3 / 4-5 and three equal periods of the main window. weights.json (no texts) holds inverse weights.
"""
import collections, datetime as dt, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
SEED = 20261109
CAP = 500
STAR_QUOTA = {'low': 450, 'mid': 100, 'high': 250}
START = dt.date(2025, 11, 9)


def star(r):
    s = r.get('stars')
    return 'low' if s <= 2 else 'mid' if s == 3 else 'high'


def block(r):
    days = (dt.date.fromisoformat(r['date']) - START).days
    return min(2, days // 122)


def week(r):
    return dt.date.fromisoformat(r['date']).isocalendar()[:2]


def main():
    rng = random.Random(SEED)
    rows = [json.loads(l) for l in open(os.path.join(DATA, 'clean.jsonl'), encoding='utf8')]
    by = collections.defaultdict(list)
    for r in rows:
        by[r['source']].append(r)
    ru = [r for r in by['gp-ru'] if r['period'] == 'main' and r['text_lang'] == 'ru' and not r['mod']]
    en = [r for r in by['gp-en'] if r['period'] == 'main' and r['text_lang'] == 'latin' and not r['mod']]
    # Control: same weeks as the Russian corpus, thinned inside each week to the Russian count.
    ru_weeks = collections.Counter(week(r) for r in ru)
    en_by_week = collections.defaultdict(list)
    for r in en:
        en_by_week[week(r)].append(r)
    en_thin = []
    for w, n in ru_weeks.items():
        pool = en_by_week.get(w, [])
        en_thin += rng.sample(pool, min(n, len(pool)))
    print('ru', len(ru), 'en', len(en), 'en thinned', len(en_thin), 'weeks with en', sum(1 for w in ru_weeks if w in en_by_week), 'of', len(ru_weeks))

    key, n = {}, 0
    weights = {}

    def emit(name, chosen):
        nonlocal n
        with open(os.path.join(DATA, f'sample_{name}.jsonl'), 'w', encoding='utf8') as f:
            for r, role in chosen:
                n += 1
                sid = f'n{n}'
                key[sid] = r['source'] + '|' + r['id']
                f.write(json.dumps({'sid': sid, 'stars': r.get('stars'), 'role': role, 'text': r['text'][:CAP]}, ensure_ascii=False) + '\n')

    def stratified(name, pool):
        cells = collections.defaultdict(list)
        for r in pool:
            cells[(star(r), block(r))].append(r)
        chosen = []
        for (s, b), items in sorted(cells.items()):
            q = STAR_QUOTA[s] // 3
            take = rng.sample(items, min(q, len(items)))
            weights[f'{name}|{s}|{b}'] = {'pool': len(items), 'sampled': len(take)}
            for i, r in enumerate(take):
                chosen.append((r, f'{s}{b}|' + ('dev' if i % 2 == 0 else 'hold')))
        rng.shuffle(chosen)
        emit(name, chosen)
        return chosen

    a = stratified('gp_ru', ru)
    stratified('gp_en', en_thin)

    others = []
    for src in ('as-ru', 'as-by', 'as-kz'):
        pool = [r for r in by[src] if r['period'] == 'main' and r['text_lang'] in ('ru', 'mixed') and not r['mod']]
        take = rng.sample(pool, min(100, len(pool)))
        weights[f'{src}|all'] = {'pool': len(pool), 'sampled': len(take)}
        others += [(r, src) for r in take]
    emit('as', others)

    forums = [(r, r['source']) for s in by for r in by[s] if s not in ('gp-ru', 'gp-en', 'as-ru', 'as-by', 'as-kz') and not r['mod']]
    emit('forums', forums)

    # Blind second coding: 150 from the Russian hold-out half, uniformly across its roles.
    hold = [(r, role) for r, role in a if role.endswith('hold')]
    second = rng.sample(hold, min(150, len(hold)))
    sid_of = {v: k for k, v in key.items()}
    with open(os.path.join(DATA, 'sample_second.jsonl'), 'w', encoding='utf8') as f:
        for r, role in second:
            f.write(json.dumps({'sid': sid_of[r['source'] + '|' + r['id']], 'text': r['text'][:CAP]}, ensure_ascii=False) + '\n')

    json.dump(key, open(os.path.join(DATA, 'sample_key.json'), 'w'))
    json.dump(weights, open(os.path.join(HERE, 'weights.json'), 'w'), indent=1)
    print('sampled total', n)


if __name__ == '__main__':
    main()
