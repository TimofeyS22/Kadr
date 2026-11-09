#!/usr/bin/env python3
"""docs/15 §7 strength labels per theme and examples.md (record ids only, no texts). Run after analyze.py."""
import collections, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, 'data')
import importlib.util
src = open(os.path.join(HERE, 'analyze.py'), encoding='utf8').read().split('rng = random.Random(SEED)')[0]
ns = {'__file__': os.path.join(HERE, 'analyze.py')}; exec(src, ns); load = ns['load']
key = json.load(open(os.path.join(DATA, 'sample_key.json')))
clean = {r['source'] + '|' + r['id']: r for r in ns['jl']('clean.jsonl')}
TYPE = {'gp-ru': 'store', 'as-ru': 'store', 'as-by': 'store', 'as-kz': 'store', 'otvet': 'forum', 'pikabu': 'forum', 'x': 'social', 'telegram': 'social', '4pda': 'forum', 'dtf': 'forum', 'vc': 'forum', 'irecommend': 'review', 'otzovik': 'review', 'trustpilot': 'review'}
res = json.load(open(os.path.join(HERE, 'results.json'), encoding='utf8'))
per = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
ex = collections.defaultdict(list)
for name in ('gp_ru', 'as', 'forums'):
    for r in load(name):
        m = clean[key[r['sid']]]
        if m['period'] == 'older':
            continue
        for t in r['t']:
            ty = TYPE[m['source']]
            per[t['k']][ty][0] += 1
            per[t['k']][ty][1] += not m.get('snippet_only') and bool(r['text'])
            if t['s'] in ('S1', 'S2') and m['source'] != 'trustpilot':
                ex[t['k']].append((r['sid'], m['source'], m['storefront'] or '-', m['date'], m['stars']))
out = {}
for k, v in per.items():
    total = sum(x[0] for x in v.values())
    types5 = [ty for ty, x in v.items() if x[1] >= 5]
    share = res['themes'].get(k, {}).get('share_ru', 0)
    label = 'ПОДТВЕРЖДЕНО' if total >= 30 and len(types5) >= 2 and share >= .01 else 'УСТОЙЧИВЫЙ СИГНАЛ' if total >= 10 else 'СИГНАЛ'
    out[k] = {'total': total, 'by_type': {t: x[0] for t, x in v.items()}, 'label': label}
json.dump(out, open(os.path.join(HERE, 'strength.json'), 'w'), ensure_ascii=False, indent=1)
with open(os.path.join(HERE, 'examples.md'), 'w', encoding='utf8') as f:
    f.write('# Примеры (только идентификаторы записей, без текстов)\n\n| Тема | sid | Площадка | Витрина | Дата | Оценка |\n|---|---|---|---|---|---|\n')
    for k in sorted(ex):
        for e in sorted(ex[k], key=lambda e: e[3] or '', reverse=True)[:3]:
            f.write(f'| {k} | {e[0]} | {e[1]} | {e[2]} | {e[3]} | {e[4]} |\n')
    f.write('\nsid раскрывается в полный id файлом `data/sample_key.json` (вне git).\n')
print(json.dumps({k: (v['total'], v['by_type'], v['label']) for k, v in sorted(out.items(), key=lambda kv: -kv[1]['total'])[:16]}, ensure_ascii=False))
