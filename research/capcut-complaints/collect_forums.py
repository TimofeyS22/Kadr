#!/usr/bin/env python3
"""Сбор публичных отзывов о CapCut, ярус 2: otvet.mail.ru, pikabu.ru, irecommend.ru, otzovik.com.

Запуск: python3 -I research/capcut-complaints/collect_forums.py
Только стандартная библиотека. Правило доступа (docs/15 §3): 401/403/429, капча, «вы человек»,
вход -> хост останавливается и записывается как закрытый. Без зеркал, прокси и подмены браузера.
Авторы (имена, ники, аватары, ссылки на профили) не сохраняются.
"""
import hashlib
import html as htmllib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "data" / "forums.jsonl"
UA = "Mozilla/5.0 (compatible; research-probe)"
GAP = 1.5
SEARCH_PAGES = 3  # 2-3 страницы выдачи на запрос

CAPCUT_RE = re.compile(r"cap\s?cut|кап\s?к[аеэ]т|кап\s?кут|кеп\s?кат|кепкут", re.I)
BLOCK_PHRASES = ("вы человек", "вы не робот", "я не робот", "captcha", "капча", "проверка браузера",
                 "подтвердите, что вы", "доступ ограничен", "access denied")

fetched_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
last_hit: dict[str, float] = {}
requests_by_host: dict[str, int] = {}
closed: dict[str, str] = {}
notes: list[str] = []
records: dict[str, dict] = {}


class Blocked(Exception):
    pass


def visible(htm: str) -> str:
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", htm, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", htmllib.unescape(t)).strip()


def fetch(url: str, host: str, charset: str = "utf-8") -> str:
    """GET с паузой на хост. Возвращает текст; на признак блокировки закрывает хост."""
    if host in closed:
        raise Blocked(closed[host])
    wait = GAP - (time.time() - last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    last_hit[host] = time.time()
    requests_by_host[host] = requests_by_host.get(host, 0) + 1
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            final = r.geturl()
            status = r.status
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429, 451):
            closed[host] = f"HTTP {e.code} на {url}"
            raise Blocked(closed[host])
        if e.code in (404, 410):
            return ""
        notes.append(f"{host}: HTTP {e.code} на {url}")
        return ""
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        notes.append(f"{host}: сеть {e!r} на {url}")
        return ""
    text = raw.decode(charset, errors="replace")
    fp = urllib.parse.urlparse(final)
    if re.search(r"/(login|signin|user/login|auth)\b", fp.path) and fp.path not in urllib.parse.urlparse(url).path:
        closed[host] = f"редирект на вход: {final}"
        raise Blocked(closed[host])
    probe = visible(text)
    head = probe[:600].lower()
    if status != 200 or ((len(probe) < 3000) and any(p in probe.lower() for p in BLOCK_PHRASES)) \
            or any(p in head for p in BLOCK_PHRASES):
        closed[host] = f"капча/проверка на {url}"
        raise Blocked(closed[host])
    return text


def add(source, url, text, date="", stars=None, likes=0, found_by="query", query="", lang="ru"):
    text = re.sub(r"[ \t ]+", " ", text).strip()
    text = re.sub(r"\n\s*\n+", "\n", text)
    if not text or not CAPCUT_RE.search(text + " " + url):
        return False
    rid = hashlib.sha256(url.encode()).hexdigest()[:16]
    if rid in records:
        return False
    records[rid] = {
        "id": rid, "source": source, "url": url, "lang": lang, "storefront": "", "date": date,
        "stars": stars, "app_version": "", "os": "", "text": text, "likes": likes,
        "fetched_at": fetched_at, "found_by": found_by, "query": query,
    }
    return True


# ------------------------------------------------------------------ otvet.mail.ru

def nuxt_data(htm: str):
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', htm, re.S)
    if not m:
        return None
    d = json.loads(m.group(1))

    def res(i, depth=0):
        if depth > 40:
            return None
        x = d[i]
        if isinstance(x, list):
            if x and isinstance(x[0], str) and x[0] in ("Reactive", "Ref", "ShallowReactive", "ShallowRef"):
                return res(x[1], depth + 1) if len(x) > 1 and isinstance(x[1], int) else None
            if x and isinstance(x[0], str) and x[0] in ("Set", "Map", "Date", "null", "undefined"):
                return None
            return [res(j, depth + 1) if isinstance(j, int) else j for j in x]
        if isinstance(x, dict):
            return {k: (res(v, depth + 1) if isinstance(v, int) else v) for k, v in x.items()}
        return x
    return res(0)


def pm_text(node) -> str:
    """Текст из ProseMirror-документа."""
    if isinstance(node, dict):
        if node.get("type") == "text":
            return node.get("text", "")
        inner = "".join(pm_text(c) for c in node.get("content") or [])
        return inner + ("\n" if node.get("type") in ("paragraph", "heading") else "")
    if isinstance(node, list):
        return "".join(pm_text(c) for c in node)
    return ""


def find_posts(obj, out):
    if isinstance(obj, dict):
        if "title" in obj and "content" in obj and "id" in obj and isinstance(obj.get("content"), dict):
            out[obj["id"]] = obj
        for v in obj.values():
            find_posts(v, out)
    elif isinstance(obj, list):
        for v in obj:
            find_posts(v, out)


def collect_otvet(queries):
    host = "otvet.mail.ru"
    seen_q = {}
    for q in queries:
        for tab in ("relevant", "new"):  # две выдачи; постраничная подгрузка идёт через API, его не трогаем
            url = f"https://{host}/search/{tab}/{urllib.parse.quote(q)}/"
            try:
                htm = fetch(url, host)
            except Blocked:
                return
            nd = nuxt_data(htm) if htm else None
            posts = {}
            if nd:
                find_posts(nd, posts)
            for pid in posts:
                seen_q.setdefault(pid, q)
    for pid, q in seen_q.items():
        url = f"https://{host}/question/{pid}"
        try:
            htm = fetch(url, host)
        except Blocked:
            return
        nd = nuxt_data(htm) if htm else None
        posts = {}
        if nd:
            find_posts(nd, posts)
        p = posts.get(pid) or posts.get(int(pid) if str(pid).isdigit() else pid)
        if not p:
            continue
        body = pm_text((p.get("content") or {}).get("json"))
        text = (p.get("title") or "") + "\n" + body
        date = (p.get("createdAtTimestamp") or "")[:10]
        up = ((p.get("reactions") or {}) .get("rating") or {}) if isinstance(p.get("reactions"), dict) else {}
        likes = up.get("upVotes", 0) if isinstance(up, dict) and isinstance(up.get("upVotes"), int) else 0
        add("otvet", url, text, date=date, likes=likes, found_by="query", query=q)


# ------------------------------------------------------------------ pikabu.ru

def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>|</p>|</div>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return htmllib.unescape(s).replace("⁠", "")


def collect_pikabu(queries):
    host = "pikabu.ru"
    found: dict[str, str] = {}
    for q in queries:
        for page in range(1, SEARCH_PAGES + 1):
            url = f"https://{host}/search?q={urllib.parse.quote(q)}" + (f"&page={page}" if page > 1 else "")
            try:
                htm = fetch(url, host, charset="cp1251")
            except Blocked:
                return
            if not htm:
                break
            links = re.findall(r'<a[^>]*href="(https://pikabu\.ru/story/[^"?]+)[^"]*"[^>]*class="story__title-link', htm)
            links += re.findall(r'class="story__title-link[^>]*href="(https://pikabu\.ru/story/[^"?]+)', htm)
            links += re.findall(r'href="(https://pikabu\.ru/story/[^"?]+)"[^>]*class="[^"]*story__title-link', htm)
            if not links:
                break
            for u in links:
                found.setdefault(u, q)
    for u, q in found.items():
        try:
            htm = fetch(u, host, charset="cp1251")
        except Blocked:
            return
        if not htm:
            continue
        title = re.search(r'class="story__title-link[^>]*>(.*?)</a>', htm, re.S)
        blocks = re.findall(r'<div[^>]*class="[^"]*story-block_type_text[^"]*"[^>]*>(.*?)</div>\s*(?=<div class="story-block|<div class="story__footer|</div>)', htm, re.S)
        if not blocks:
            blocks = re.findall(r'story-block_type_text[^>]*>(.*?)</div>', htm, re.S)
        text = strip_html(title.group(1)) if title else ""
        text += "\n" + "\n".join(strip_html(b) for b in blocks)
        d = re.search(r'datetime="(\d{4}-\d{2}-\d{2})', htm)
        add("pikabu", u, text, date=d.group(1) if d else "", found_by="query", query=q)


# ------------------------------------------------------------------ irecommend.ru

RU_MONTHS = {"января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6, "июля": 7, "августа": 8,
             "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
             "январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6, "июль": 7, "август": 8,
             "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
             "янв": 1, "фев": 2, "мар": 3, "апр": 4, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10,
             "ноя": 11, "дек": 12}


def ru_date(s: str) -> str:
    m = re.search(r"(\d{1,2})\s+([А-Яа-я]+)\.?,?\s+(\d{4})", s)
    if m and m.group(2).lower() in RU_MONTHS:
        return f"{int(m.group(3)):04d}-{RU_MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    return ""


def collect_irecommend(listings):
    host = "irecommend.ru"
    base = f"https://{host}"
    for lst in listings:
        pages = [lst, lst + "?page=1", lst + "?page=2"]
        links = []
        for i, pg in enumerate(pages):
            try:
                htm = fetch(pg, host)
            except Blocked:
                return
            if not htm:
                break
            got = re.findall(r'class="reviewTextSnippet"[^>]*href="(/content/[^"]+)"', htm)
            got += re.findall(r'href="(/content/[^"]+)"[^>]*class="reviewTextSnippet"', htm)
            new = [g for g in got if g not in links]
            if i > 0 and not new:
                notes.append(f"irecommend: {pg} не дала новых отзывов (редирект на первую страницу или конец)")
                break
            links += new
        for path in links:
            u = base + path
            try:
                htm = fetch(u, host)
            except Blocked:
                return
            if not htm:
                continue
            title = re.search(r'<h2 class="reviewTitle"[^>]*>(.*?)</h2>', htm, re.S)
            body = re.search(r'itemprop="reviewBody"\s*>(.*?)</div>\s*(?:<div class="(?:clear|views-field|review-footer)|<!--)', htm, re.S) \
                or re.search(r'itemprop="reviewBody"\s*>(.*?)</div>', htm, re.S)
            adv = re.findall(r'<div class="(?:plus|minus)[^"]*"[^>]*>(.*?)</div>', htm, re.S)
            text = (strip_html(title.group(1)) if title else "") + "\n" + (strip_html(body.group(1)) if body else "")
            text += "\n" + "\n".join(strip_html(a) for a in adv)
            d = re.search(r'itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})', htm)
            r = re.search(r'itemprop="ratingValue" content="(\d)"', htm)
            add("irecommend", u, text, date=d.group(1) if d else "", stars=int(r.group(1)) if r else None,
                found_by="listing", query=lst)


# ------------------------------------------------------------------ otzovik.com

def collect_otzovik(listings):
    host = "otzovik.com"
    for lst in listings:
        try:
            htm = fetch(lst, host)
        except Blocked:
            return
        prods = sorted(set(re.findall(r'href="(/reviews/[^"]*capcut[^"]*/)"', htm)))
        for prod in prods:
            urls = []
            nxt = f"https://{host}{prod}"
            seen_pages = set()
            while nxt and nxt not in seen_pages and len(seen_pages) < 30:
                seen_pages.add(nxt)
                try:
                    ph = fetch(nxt, host)
                except Blocked:
                    return
                if not ph:
                    break
                for r in re.findall(r'href="(/review_\d+\.html)"', ph):
                    if r not in urls:
                        urls.append(r)
                m = re.search(r"<a class='next[^']*' href='([^']+)'", ph)
                nxt = f"https://{host}{m.group(1)}" if m else None
            for r in urls:
                u = f"https://{host}{r}"
                try:
                    rh = fetch(u, host)
                except Blocked:
                    return
                if not rh:
                    continue
                title = re.search(r"<h1[^>]*>(.*?)</h1>", rh, re.S)
                parts = [strip_html(title.group(1)) if title else ""]
                for cls in ("review-plus", "review-minus"):
                    m = re.search(rf'<div class="{cls}">(.*?)</div>', rh, re.S)
                    if m:
                        parts.append(strip_html(m.group(1)))
                body = re.search(r'class="review-body description"[^>]*>(.*?)</div>', rh, re.S)
                if body:
                    parts.append(strip_html(body.group(1)))
                d = re.search(r'itemprop="datePublished" content="(\d{4}-\d{2}-\d{2})', rh)
                rt = re.search(r'itemprop="reviewRating".*?itemprop="ratingValue" content="(\d)"', rh, re.S)
                add("otzovik", u, "\n".join(parts), date=d.group(1) if d else "",
                    stars=int(rt.group(1)) if rt else None, found_by="listing", query=lst)


# ------------------------------------------------------------------ main

def main():
    q = json.loads((ROOT / "queries.json").read_text(encoding="utf-8"))
    ru = q["ru"]
    steps = [
        ("otvet.mail.ru", lambda: collect_otvet(ru)),
        ("pikabu.ru", lambda: collect_pikabu(ru)),
        ("irecommend.ru", lambda: collect_irecommend(q["listings"]["irecommend"])),
        ("otzovik.com", lambda: collect_otzovik(q["listings"]["otzovik"])),
    ]
    for host, fn in steps:
        try:
            fn()
        except Exception as e:  # хост не должен ронять остальные
            notes.append(f"{host}: исключение {e!r}")
        print(f"{host}: запросов {requests_by_host.get(host, 0)}, закрыт: {closed.get(host, 'нет')}", file=sys.stderr)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for r in records.values():
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    by = {}
    for r in records.values():
        by.setdefault(r["source"], []).append(r["date"])
    for s, ds in by.items():
        ds2 = sorted(d for d in ds if d)
        print(f"{s}: {len(ds)} док., даты {ds2[0] if ds2 else '-'}..{ds2[-1] if ds2 else '-'}, без даты {len(ds)-len(ds2)}")
    for n in notes:
        print("note:", n)


if __name__ == "__main__":
    main()
