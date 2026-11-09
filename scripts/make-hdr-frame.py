#!/usr/bin/env python3
# One 640x360 frame, 10-bit 4:2:0, of four vertical patches: HDR values (BT.2100) that stand for known SDR colours when
# diffuse white is 203 nits (BT.2408). Argument: hlg or pq. Writes raw yuv420p10le to stdout. See scripts/make-fixtures.sh.
import math, struct, sys

PATCHES = [(1, 1, 1), (.80, .20, .20), (.76, .57, .45), (.5, .5, .5)]
TO_2020 = [(.6274, .3293, .0433), (.0691, .9195, .0114), (.0164, .0880, .8956)]
A, B, C = .17883277, .28466892, .55991073
W, H = 640, 360
luma = lambda v: .2627 * v[0] + .678 * v[1] + .0593 * v[2]


def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4


def hlg(display):  # 1.0 = 203 nits; inverse OOTF of a 1000-nit display, then the OETF
    d = [x * .203 for x in display]
    gain = max(luma(d), 1e-9) ** (1 / 1.2 * .2)
    return [math.sqrt(3 * e) if e <= 1 / 12 else A * math.log(12 * e - B) + C for e in (x / gain for x in d)]


def pq(display):
    out = []
    for x in display:
        y = (x * 203 / 10000) ** .1593017578125
        out.append(((.8359375 + 18.8515625 * y) / (1 + 18.6875 * y)) ** 78.84375)
    return out


def code(rgb):
    y = luma(rgb)
    return int(64 + 876 * y + .5), int(512 + 896 * (rgb[2] - y) / 1.8814 + .5), int(512 + 896 * (rgb[0] - y) / 1.4746 + .5)


encode = hlg if sys.argv[1] == 'hlg' else pq
values = []
for patch in PATCHES:
    l = [linear(v) for v in patch]
    values.append(code(encode([sum(m[j] * l[j] for j in range(3)) for m in TO_2020])))
out = bytearray()
for plane, w, h in ((0, W, H), (1, W // 2, H // 2), (2, W // 2, H // 2)):
    for _ in range(h):
        for x in range(w):
            out += struct.pack('<H', values[x * 4 // w][plane])
sys.stdout.buffer.write(bytes(out))
