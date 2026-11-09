#!/usr/bin/env python3
"""sha256 of the frozen raw snapshot and clean corpus labels included (no texts), tracked in git."""
import glob, hashlib, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
out = {}
for p in sorted(glob.glob(os.path.join(HERE, 'data', '*.jsonl'))):
    name = os.path.basename(p)
    out[name] = {'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest(), 'lines': sum(1 for _ in open(p, encoding='utf8'))}
json.dump(out, open(os.path.join(HERE, 'manifest.json'), 'w'), indent=1)
print(len(out), 'files')
