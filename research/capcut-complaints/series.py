#!/usr/bin/env python3
"""Direct-search series over all reviews <= 3 stars -> regex_series.json. Direction only, not a measured share (docs/15 §6 step 6)."""
import collections, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
P = {
    'forced_update': {'gp-ru': r'безопасн.{0,40}верси|верси.{0,40}безопасн|небезопасн|нов(ую|ейшую).{0,12}верси|последн.{0,12}верси|скача.{0,40}(из магазин|с плей|с play|с официальн|с гугл|из google)|просит.{0,15}обнов',
                      'gp-en': r'(security|safe|secure).{0,40}version|(latest|newest|new|updated) version|keeps? asking.{0,20}update|asks?.{0,12}(to )?update|not secure'},
    'false_no_internet': {'gp-ru': r'(нет|отсутств|нестабильн|плох).{0,25}интернет|интернет.{0,30}(нет|хотя|нестабильн)|ошибк.{0,15}(сет|подключ)|нет сети',
                          'gp-en': r'no internet|network error|internet connection|no network|connection error'},
    'false_no_internet_broad': {'gp-ru': r'интернет|сет[ьи]\b|подключени',
                                'gp-en': r'internet|network|connection|wifi|wi-fi'},
    'region_block': {'gp-ru': r'недоступн.{0,30}(стран|регион)|(в россии|в рф|рф).{0,40}(не работ|недоступ|огранич|убрал|запрет)',
                     'gp-en': r'not available in your (country|region)|unavailable in your (country|region)'},
}
d = [json.loads(l) for l in open(os.path.join(HERE, 'data', 'clean.jsonl'), encoding='utf8')]
out = {}
for src, lang in (('gp-ru', 'ru'), ('gp-en', 'latin')):
    base = [r for r in d if r['source'] == src and r['text_lang'] == lang and r['period'] == 'main' and r['stars'] <= 3]
    months = collections.Counter(r['date'][:7] for r in base)
    out[src] = {'n_le3': len(base)}
    for k, p in P.items():
        rx = re.compile(p[src], re.I)
        hit = [r for r in base if rx.search(r['text'])]
        m = collections.Counter(r['date'][:7] for r in hit)
        out[src][k] = {'n': len(hit), 'share_le3': round(len(hit) / len(base), 4),
                       'by_month': {x: round(m[x] / months[x], 3) for x in sorted(months)},
                       'top_ver': collections.Counter(r['app_version'][:5] for r in hit if r['app_version']).most_common(3)}
json.dump(out, open(os.path.join(HERE, 'regex_series.json'), 'w'), ensure_ascii=False, indent=1)
print({k: (out['gp-ru'][k]['share_le3'], out['gp-en'][k]['share_le3']) for k in P})
