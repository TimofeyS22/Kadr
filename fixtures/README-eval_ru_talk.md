# eval_ru_talk.mp4, eval_ru_talk_music.mp4 — живая неподготовленная речь

Не в репозитории (`fixtures/*.mp4` в `.gitignore`) и не в браузере: только для замеров субтитров и «Рилса» (`docs/20`, V-142, O-13-5).

- **Источник:** «Интервью телеканалам „Первый“, „Россия“ и НТВ», 29–30 сентября 2011, kremlin.ru. Файл на Wikimedia Commons: `File:Medvedev's interview 29 September 2011.webm`, копия 240p.
- **Лицензия:** CC BY 4.0, автор — kremlin.ru (http://kremlin.ru/events/president/news/12880).
- **Что взято:** звук с 5:00 по 6:25 (85 с), моно 48 кГц; картинка — заливка, как у остальных `eval_*`. `_music` — та же речь и первый трек `public/music/tracks/` на 0,35 громкости.
- **Как собрать снова:**
  `curl -A "fixture-fetch/1.0" -o interview.webm "https://upload.wikimedia.org/wikipedia/commons/transcoded/2/2c/Medvedev%27s_interview_29_September_2011.webm/Medvedev%27s_interview_29_September_2011.webm.240p.vp9.webm"`
  `ffmpeg -ss 300 -t 85 -i interview.webm -vn -ac 1 -ar 48000 talk.wav`, дальше как в `scripts/fetch-live-speech.mjs`.
- **Эталонного текста нет.** Официальная стенограмма отредактирована (без «а-а», «э-э», повторов) и для дословного сравнения не годится; человек запись не размечал. Что услышали модели — `reports/captions-docs20/talk/`.
- **Запинки в записи:** GigaAM записала пять («А-а», «Аа-а», «э-э»); FastConformer и Whisper small — ни одной.
