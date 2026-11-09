#!/usr/bin/env python3
"""Steps 4-6 of docs/15: all numbers of the report from the frozen snapshot. Writes results.json (no texts)."""
import collections, datetime as dt, json, math, os, random, re, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dictionary import COMPILED, tag

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
SEED, REPS = 20261109, 1000
WEIGHTS = json.load(open(os.path.join(HERE, 'weights.json')))
BLOCKS_REGION = {'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'E1', 'E2', 'E3', 'E4', 'E5'}  # the whole money and region blocks
# Red team read these first-coder labels: documents the v1 rule missed (typos, phrasing), and C3 that is not about launching.
OVERRIDES = json.load(open(os.path.join(HERE, 'overrides.json'), encoding='utf8'))
res = {}

# Codebook v1 (see codebook.md): two themes the coders had split across C3, X1 and Y1.
V1 = {
    'ru': (re.compile(r'безопасн.{0,40}верси|верси.{0,40}безопасн|небезопасн|нов(ую|ейшую).{0,12}верси|последн.{0,12}верси|скача.{0,40}(из магазин|с плей|с play|с официальн|с гугл|из google)|просит.{0,15}обнов', re.I),
           re.compile(r'(нет|отсутств|нестабильн|плох).{0,25}интернет|интернет.{0,30}(нет|хотя|нестабильн)|ошибк.{0,15}(сет|подключ)|нет сети', re.I)),
    'en': (re.compile(r'(security|safe|secure).{0,40}version|(latest|newest|new|updated) version|keeps? asking.{0,20}update|asks?.{0,12}(to )?update|not secure', re.I),
           re.compile(r'no internet|network error|internet connection|no network|connection error', re.I)),
}


def recode(rec, text, lang, overrides=None):
    forced, offline = V1[lang]
    seen = set()
    kept = []
    for t in rec.get('t', []):
        new = (overrides or {}).get(rec['sid'], {})
        if t['k'] in new:
            if new[t['k']] is None:
                continue
            t = dict(t, k=new[t['k']])
        elif t['k'] in ('C3', 'X1', 'Y1'):
            if forced.search(text):
                t = dict(t, k='C5')
            elif offline.search(text):
                t = dict(t, k='C6')
        if t['k'] not in seen:
            seen.add(t['k'])
            kept.append(t)
    rec['t'] = kept
    return rec


def jl(name):
    return [json.loads(l) for l in open(os.path.join(DATA, name), encoding='utf8')]


def load(name):
    labels = {r['sid']: r for r in jl(f'labels_{name}.jsonl')}
    out = []
    lang = 'en' if name == 'gp_en' else 'ru'
    for s in jl(f'sample_{name}.jsonl'):
        if s['sid'] not in labels:
            continue
        r = recode(dict(s, **labels[s['sid']]), s['text'], lang, OVERRIDES if name == 'gp_ru' else None)
        r['themes'] = {t['k'] for t in r['t']} if r['c'] else set()
        out.append(r)
    return out


def strata(rows, name):
    cells = collections.defaultdict(list)
    for r in rows:
        star_block = r['role'].split('|')[0]
        cells[star_block].append(r)
    w = {}
    for c, items in cells.items():
        meta = WEIGHTS[f'{name}|{c[:-1]}|{c[-1]}']
        w[c] = meta['pool'] / len(items)
    return cells, w


def share(cells, w, fn, denom=lambda r: r['c'] == 1):
    n = d = 0.0
    for c, items in cells.items():
        for r in items:
            if denom(r):
                d += w[c]
                if fn(r):
                    n += w[c]
    return n / d if d else float('nan')


def boot(cells, w, stat, rng):
    vals = []
    keys = list(cells)
    for _ in range(REPS):
        re_cells = {c: rng.choices(cells[c], k=len(cells[c])) for c in keys}
        vals.append(stat(re_cells, w))
    vals = sorted(v for v in vals if not math.isnan(v))
    return vals[int(len(vals) * .025)], vals[int(len(vals) * .975)]


def kappa(a, b):
    n = len(a)
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return (po - pe) / (1 - pe) if pe < 1 else float('nan'), po


def bh(pvals, q=.05):
    order = sorted(range(len(pvals)), key=lambda i: pvals[i])
    k = 0
    for rank, i in enumerate(order, 1):
        if pvals[i] <= q * rank / len(pvals):
            k = rank
    return {order[i] for i in range(k)}


rng = random.Random(SEED)
ru = load('gp_ru')
en = load('gp_en')
cru, wru = strata(ru, 'gp_ru')
cen, wen = strata(en, 'gp_en')
codes = sorted({t for r in ru + en for t in r['themes']})

# Complaint share of the whole corpus
all_docs = lambda r: True
res['complaint_share'] = {'gp_ru': share(cru, wru, lambda r: r['c'] == 1, all_docs), 'gp_en': share(cen, wen, lambda r: r['c'] == 1, all_docs),
                          'gp_ru_ci': boot(cru, wru, lambda c, w: share(c, w, lambda r: r['c'] == 1, all_docs), rng)}
res['n'] = {'gp_ru': len(ru), 'gp_en': len(en), 'gp_ru_complaints': sum(r['c'] for r in ru), 'gp_en_complaints': sum(r['c'] for r in en)}

themes = {}
for k in codes:
    has = lambda r, k=k: k in r['themes']
    sev = lambda r, k=k: any(t['k'] == k and t['s'] in ('S1', 'S2') for t in r['t'])
    n = sum(1 for r in ru if k in r['themes'])
    themes[k] = {
        'n_ru': n, 'share_ru': share(cru, wru, has), 'ci_ru': boot(cru, wru, lambda c, w: share(c, w, has), rng),
        'share_ru_noY1': share(cru, wru, has, lambda r: r['c'] == 1 and r['themes'] != {'Y1'}),
        's12_ru': share(cru, wru, sev), 'ci_s12': boot(cru, wru, lambda c, w: share(c, w, sev), rng),
        'n_en': sum(1 for r in en if k in r['themes']), 'share_en': share(cen, wen, has),
    }
res['themes'] = themes
res['rank'] = sorted(codes, key=lambda k: -themes[k]['s12_ru'])

# RU vs EN
rr, pv, idx = {}, [], []
for k in codes:
    if k in ('X1', 'Y1'):
        continue
    has = lambda r, k=k: k in r['themes']
    def lrr(cr, cn):
        a, b = share(cr, wru, has), share(cn, wen, has)
        return math.log(a / b) if a > 0 and b > 0 else float('nan')
    point = lrr(cru, cen)
    if math.isnan(point):
        continue
    vals = []
    for _ in range(REPS):
        v = lrr({c: rng.choices(i, k=len(i)) for c, i in cru.items()}, {c: rng.choices(i, k=len(i)) for c, i in cen.items()})
        if not math.isnan(v):
            vals.append(v)
    se = st.pstdev(vals)
    p = 0.5 * math.erfc((point - math.log(1.25)) / (se * math.sqrt(2)))
    no_reg = lambda r: r['c'] == 1 and not (r['themes'] & BLOCKS_REGION)
    a2, b2 = share(cru, wru, has, no_reg), share(cen, wen, has, no_reg)
    nb = []
    if k not in BLOCKS_REGION and a2 > 0 and b2 > 0:
        for _ in range(REPS):
            x = share({c: rng.choices(i, k=len(i)) for c, i in cru.items()}, wru, has, no_reg)
            y = share({c: rng.choices(i, k=len(i)) for c, i in cen.items()}, wen, has, no_reg)
            if x > 0 and y > 0:
                nb.append(x / y)
        nb.sort()
    long_doc = lambda r: r['c'] == 1 and len(r['text'].split()) >= 8
    a3, b3 = share(cru, wru, has, long_doc), share(cen, wen, has, long_doc)
    vals.sort()
    rr[k] = {'rr': math.exp(point), 'lo': math.exp(vals[int(len(vals) * .025)]), 'hi': math.exp(vals[int(len(vals) * .975)]), 'p': p,
             'rr_no_region': a2 / b2 if b2 else None, 'rr_long': a3 / b3 if b3 else None,
             'no_block_ci': [nb[int(len(nb) * .025)], nb[int(len(nb) * .975)]] if nb else None}
    pv.append(p); idx.append(k)
keep = bh(pv)
for i, k in enumerate(idx):
    nbci = rr[k]['no_block_ci']
    rr[k]['specific'] = bool(i in keep and rr[k]['rr'] >= 1.5 and rr[k]['lo'] > 1.25 and (nbci is None or nbci[0] > 1.25))
res['rr'] = rr

# Second coder
first = {r['sid']: r for r in ru}
second = {r['sid']: recode(r, first[r['sid']]['text'], 'ru') for r in jl('labels_second.jsonl') if r['sid'] in first}
pairs = [(first[s], second[s]) for s in second if s in first]
agree = {'n': len(pairs)}
a = [p[0]['c'] for p in pairs]; b = [p[1]['c'] for p in pairs]
agree['complaint'] = kappa(a, b)
per = {}
for k in codes:
    x = [int(k in p[0]['themes']) for p in pairs]
    y = [int(any(t['k'] == k for t in p[1]['t']) and p[1]['c']) for p in pairs]
    per[k] = {'pos_first': sum(x), 'pos_second': sum(y), 'kappa': None if min(sum(x), sum(y)) < 20 else kappa(x, y)[0], 'kappa_raw': kappa(x, y)[0], 'agree': kappa(x, y)[1]}
agree['per_theme'] = per
for field in ('s', 'w', 'r'):
    same = tot = 0
    for f, s in pairs:
        fm = {t['k']: t[field] for t in f['t']}
        sm = {t['k']: t[field] for t in s['t']}
        for k in fm.keys() & sm.keys():
            tot += 1; same += fm[k] == sm[k]
    agree['field_' + field] = {'same': same, 'pairs': tot, 'share': same / tot if tot else None}
res['agreement'] = agree

# Dictionary validity on the hold-out half
hold = [r for r in ru if r['role'].endswith('hold')]
dev = [r for r in ru if r['role'].endswith('dev')]
ch, wh = strata(hold, 'gp_ru')
for c in wh:
    meta = WEIGHTS['gp_ru|' + c[:-1] + '|' + c[-1]]
    wh[c] = meta['pool'] / len(ch[c])
d_eval = {}
for k in COMPILED:
    tp = fp = fn = 0.0; ntp = 0; pos = 0
    for c, items in ch.items():
        for r in items:
            pred = k in tag(r['text']) and r['c'] == 1
            gold = k in r['themes']
            pos += gold
            if pred and gold: tp += wh[c]; ntp += 1
            elif pred: fp += wh[c]
            elif gold: fn += wh[c]
    d_eval[k] = {'gold_pos': pos, 'tp': ntp, 'precision': tp / (tp + fp) if tp + fp else None, 'recall': tp / (tp + fn) if tp + fn else None,
                 'pass': bool(pos >= 30 and tp + fp and tp + fn and tp / (tp + fp) >= .9 and tp / (tp + fn) >= .7), 'evaluated': pos >= 30}
res['dictionary'] = d_eval

# Dynamics on the whole gp-ru by month: low-star docs as denominator (proxy, stated in the report)
clean = [r for r in jl('clean.jsonl') if r['source'] == 'gp-ru' and r['period'] == 'main' and r['text_lang'] == 'ru']
months = collections.defaultdict(lambda: collections.Counter())
weeks = collections.defaultdict(lambda: collections.Counter())
for r in clean:
    if r['stars'] > 2:
        continue
    ts = tag(r['text'])
    m = r['date'][:7]; w = dt.date.fromisoformat(r['date']).isocalendar()[:2]
    months[m]['_n'] += 1; weeks[w]['_n'] += 1
    for k in ts:
        months[m][k] += 1; weeks[w][k] += 1
res['months'] = {m: dict(c) for m, c in sorted(months.items())}
wk = sorted(weeks)
spikes = []
for k in COMPILED:
    series = [(w, weeks[w][k] / weeks[w]['_n'] if weeks[w]['_n'] else 0, weeks[w][k]) for w in wk]
    for i in range(8, len(series)):
        prev = [s[1] for s in series[i - 8:i]]
        med = st.median(prev); mad = st.median(abs(x - med) for x in prev)
        if series[i][2] >= 20 and series[i][1] > med + 3 * mad:
            spikes.append({'theme': k, 'week': series[i][0], 'share': series[i][1], 'n': series[i][2], 'median': med})
res['spikes'] = spikes

# App Store (random samples, unweighted) and search-found sources (counts only)
ast = load('as')
key = json.load(open(os.path.join(DATA, 'sample_key.json')))
by_src = collections.defaultdict(list)
for r in ast:
    by_src[key[r['sid']].split('|')[0]].append(r)
res['as'] = {s: {'n': len(v), 'complaints': sum(x['c'] for x in v), 'themes': collections.Counter(t for x in v for t in x['themes']).most_common(12)} for s, v in by_src.items()}
forums = load('forums')
clean_all = {r['source'] + '|' + r['id']: r for r in jl('clean.jsonl')}
c = collections.defaultdict(lambda: collections.Counter())
for r in forums:
    meta = clean_all[key[r['sid']]]
    for t in r['themes']:
        c[meta['source']][t] += 1
    c[meta['source']]['_docs'] += 1
    c[meta['source']]['_complaints'] += r['c']
    c[meta['source']]['_main'] += meta['period'] == 'main'
res['counts_by_query'] = {s: dict(v) for s, v in c.items()}

# Churn: stated intent and named replacements, counts only
churn = collections.Counter(); targets = collections.Counter(); churn_docs = collections.Counter()
for r in ru + ast + forums:
    for u in {t['u'] for t in r['t']} - {'none'}:
        churn_docs[u] += 1
    for t in r['t']:
        if t['u'] != 'none':
            churn[t['u']] += 1
            if t.get('to'):
                targets[t['to'].strip().lower()] += 1
res['churn'] = {'pairs': dict(churn), 'docs': dict(churn_docs), 'targets': targets.most_common(20)}
# Export family as a count, all stores of labelled docs
fam = {'B1', 'B2', 'B5'}
res['export_family'] = {'gp_ru_n': sum(1 for r in ru if r['themes'] & fam), 'gp_ru_share': share(cru, wru, lambda r: bool(r['themes'] & fam)), 'gp_ru_ci': boot(cru, wru, lambda c, w: share(c, w, lambda r: bool(r['themes'] & fam)), rng)}
top5 = {'C3', 'C1', 'C2', 'D1', 'J2'}
res['top5_as'] = {s: sum(1 for x in v if x['themes'] & top5) for s, v in by_src.items()}
res['moneyA_as'] = {s: sum(1 for x in v if any(t.startswith('A') for t in x['themes'])) for s, v in by_src.items()}
res['other_notes'] = collections.Counter((r.get('note') or '').lower() for r in ru + ast + forums if 'X1' in r['themes']).most_common(30)
res['offtopic'] = sum(1 for r in ru + ast + forums + en if r.get('note') == 'offtopic')
json.dump(res, open(os.path.join(HERE, 'results.json'), 'w'), ensure_ascii=False, indent=1, default=list)
print('ok', {k: (round(v['s12_ru'], 3)) for k, v in sorted(themes.items(), key=lambda kv: -kv[1]['s12_ru'])[:10]})
