#!/usr/bin/env python3
"""Builds the in-app music library (docs/05 M1) from scripts/music-sources.json.

For every candidate, in order, until PER_MOOD tracks per mood are accepted:
  1. the track page must state "CC0 1.0 Universal" (proof URL goes into the manifest);
  2. duration 90..300 s;
  3. two-pass loudnorm to -14 LUFS / -1.5 dBTP, AAC 128 kbit/s, 48 kHz stereo -> public/music/tracks/<id>.m4a;
  4. then scripts/music-beats.ts adds BPM and beat times with the app's own code (decoding via an ffmpeg pipe).
Writes public/music/music.json. Re-runnable: downloads and encodes are cached.
"""
import datetime, hashlib, json, os, re, subprocess, urllib.request

PER_MOOD = 6
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'scripts', '.music-cache')
OUT = os.path.join(ROOT, 'public', 'music')
UA = {'User-Agent': 'Mozilla/5.0 (Kadr music library builder)'}
os.makedirs(CACHE, exist_ok=True)
os.makedirs(os.path.join(OUT, 'tracks'), exist_ok=True)

def fetch(url, path=None):
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
    if path:
        open(path, 'wb').write(data)
    return data

def run(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True)

def duration(path):
    return float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path).stdout.strip())

sources = json.load(open(os.path.join(ROOT, 'scripts', 'music-sources.json')))
today = datetime.date.today().isoformat()
tracks, count = [], {}
for s in sources:
    if count.get(s['mood'], 0) >= PER_MOOD:
        continue
    tid = re.sub(r'[^a-z0-9]+', '-', f"{s['artist']}-{s['title']}".lower()).strip('-')[:48] + '-' + hashlib.sha1(s['page'].encode()).hexdigest()[:6]
    page = fetch(s['page']).decode('utf8', 'ignore')
    if 'CC0 1.0 Universal' not in page:
        print('skip (license)', s['title']); continue
    mp3 = os.path.join(CACHE, tid + '.mp3')
    if not os.path.exists(mp3):
        fetch(s['file'], mp3)
    d = duration(mp3)
    if not 90 <= d <= 300:
        print('skip (duration %.0fs)' % d, s['title']); continue
    m4a = os.path.join(OUT, 'tracks', tid + '.m4a')
    if not os.path.exists(m4a):
        measured = run('ffmpeg', '-hide_banner', '-i', mp3, '-map', '0:a:0', '-vn', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-').stderr
        m = json.loads(measured[measured.rindex('{'):measured.rindex('}') + 1])
        norm = ('loudnorm=I=-14:TP=-1.5:LRA=11:linear=true:measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s'
                % (m['input_i'], m['input_tp'], m['input_lra'], m['input_thresh'], m['target_offset']))
        tmp = m4a + '.tmp.m4a'  # atomic: a failed encode never leaves a broken cached file
        run('ffmpeg', '-v', 'error', '-y', '-i', mp3, '-map', '0:a:0', '-vn', '-af', norm, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmp)
        os.replace(tmp, m4a)
    count[s['mood']] = count.get(s['mood'], 0) + 1
    tracks.append({
        'id': tid, 'title': re.sub(r'\.mp3$', '', s['title'], flags=re.I).strip(), 'artist': s['artist'], 'album': s['album'], 'mood': s['mood'],
        'duration': round(duration(m4a), 2), 'file': f'tracks/{tid}.m4a', 'bytes': os.path.getsize(m4a),
        'license': 'CC0 1.0 Universal (public domain)', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'source': s['page'], 'verified': today,
    })
    print('ok', s['mood'], s['title'], '%.0fs' % d)

json.dump({'version': 1, 'tracks': tracks}, open(os.path.join(OUT, 'music.json'), 'w'), ensure_ascii=False, indent=1)
print(len(tracks), 'tracks;', count, '; %.1f MB' % (sum(t['bytes'] for t in tracks) / 1e6))
