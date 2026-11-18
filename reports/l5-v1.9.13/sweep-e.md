### строки E1–E4 (проверка P0–P3): https://timofeys22.github.io/Kadr/, v1.9.13, 2026-11-18T12:44Z

Скрипт `scripts/l5-sweep-e.mjs`; итог: PASS 2, FAIL 1, ERROR 0, LOOK 0. Касания — click() и события пальца в странице, файлы положены в страницу вместо «Фото» (L5-авто, `docs/16` §4).

| ID | Исход | Замер | Порог |
|---|---|---|---|
| V-259 · C-B2 | прошла | файл целый (ffprobe, длина ± 0,1 с, звук) 6 из 6; кодек H.264 6 из 6; меньшая сторона 4K 2160 px; перезапуски «Baseline» 0; профили 1080p Baseline, 4k Baseline; ошибки страницы 0; тосты ошибок 0 | файл целый (ffprobe, длина ± 0,1 с, звук) 6 из 6; кодек H.264 6 из 6; меньшая сторона 4K ≥ 2160 px; перезапуски «Baseline» = 0; профили записать; ошибки страницы = 0; тосты ошибок = 0 |
| V-190 | **не прошла** | ✗ экспорт дошёл до файла Export failed: Something went wrong. The details are under “Details”. / DetailsKadr 1.9.13, 2026-11-18T12:51:43.408Z iPhone, iOS 18.7, Safari 26.5 export: InvalidStateError: Canvas has no frameCopy for supportNothing is sent by itself. File names and your text are not in it. / log [[{"at":1795006303408,"version":"1.9.13","where":"export","kind":"InvalidStateError","message":"Canvas has no frame","device":"iPhone, iOS 18.7, Safari 26.5"}]] | экспорт дошёл до файла да |
| V-232 | прошла | превью: квадрат в середине (зелёный) 216; превью: край широкого места 0; файл: квадрат в середине 216; файл: край широкого места 0; ошибки страницы 0; тосты ошибок 0 | превью: квадрат в середине (зелёный) ≥ 150; превью: край широкого места < 100; файл: квадрат в середине ≥ 150; файл: край широкого места < 100; ошибки страницы = 0; тосты ошибок = 0 |
