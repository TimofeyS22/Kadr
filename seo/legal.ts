// "Privacy" and "Licenses" (docs/12 stage 6, G6): static pages next to the task pages, in Russian and English.
// Every statement here must be true of Kadr today: what runs on the device, what is downloaded and from where, what
// is kept. The licenses cover what ships in the browser bundle and what the app downloads, with the attributions
// their licenses ask for. When a dependency, model, font or sample changes, change this file (CLAUDE.md §4).
import type { Lang } from './tasks.ts';

export type LegalId = 'privacy' | 'licenses';
export const LEGAL: LegalId[] = ['privacy', 'licenses'];
export const legalPath = (id: LegalId, lang: Lang) => `${lang}/${id}/`;

const ISSUES = 'https://github.com/TimofeyS22/Kadr/issues';
const REPO = 'https://github.com/TimofeyS22/Kadr';

type Section = { h: string; p?: string[]; items?: string[] };
export interface LegalPage { title: string; description: string; h1: string; intro: string; sections: Section[] }

/** Text with [label](url) links; everything else is escaped by the renderer. */
export const PRIVACY: Record<Lang, LegalPage> = {
  ru: {
    title: 'Конфиденциальность — Kadr',
    description: 'Как Kadr обращается с вашими видео и данными: всё обрабатывается на устройстве, ничего не загружается на сервер.',
    h1: 'Конфиденциальность',
    intro: 'Kadr — видеоредактор, который работает целиком на вашем устройстве. Ваши видео, фото, звук, текст и речь не покидают телефон или компьютер.',
    sections: [
      { h: 'Что обрабатывается на устройстве', items: [
        'Видео, фото и звук: импорт, монтаж, эффекты, экспорт. Файлы никуда не загружаются.',
        'Распознавание речи (субтитры, «Рилс в 1 тап», удаление пауз и слов-паразитов): модель работает в браузере, звук не отправляется.',
        'Удаление фона, скрытие лиц, авторефрейм, шумоподавление — тоже на устройстве.',
      ] },
      { h: 'Что скачивается и откуда', items: [
        'Сам Kadr — с этого сайта (GitHub Pages). После первого визита он работает и без интернета.',
        'Модели распознавания речи (41–249 МБ) — один раз, при первом использовании субтитров, с этого же сайта; если он недоступен, и для самой большой модели («Максимально точно», Whisper small) — с [Hugging Face](https://huggingface.co). Запрос содержит только адрес файла модели; ваши данные в нём не передаются. Сайт, с которого идёт файл, видит ваш IP-адрес, как любой сайт.',
        'Музыка из библиотеки — с этого сайта, когда вы её выбираете.',
      ] },
      { h: 'Что хранится и где', items: [
        'Проекты, медиа, модели и журнал ошибок хранятся в браузере на этом устройстве (IndexedDB, Cache API, файловая система сайта). Удалить их можно, удалив проекты в Kadr или данные сайта в настройках браузера.',
        'Safari на iPhone стирает данные сайта, который не открывали 7 дней, если он не добавлен на экран «Домой». Для важных проектов сохраняйте бэкап.',
      ] },
      { h: 'Чего нет', items: [
        'Нет регистрации, аккаунтов, рекламы, cookie и сторонних трекеров.',
        'Нет телеметрии, уходящей с устройства: счётчики действий хранятся только в памяти открытой вкладки. Если когда-нибудь появится обезличенная статистика, она будет без содержимого, с возможностью отказа, и эта страница изменится до неё.',
      ] },
      { h: 'Ошибки', p: [
        'Когда что-то не получается, Kadr показывает «Подробнее»: версию, устройство, где и какая ошибка. Это же хранится на устройстве (последние 50 записей) и видно на странице диагностики. Ничего не отправляется само: кнопка «Скопировать для поддержки» кладёт текст в буфер обмена, а отправите ли вы его — решаете вы. Имён файлов и вашего текста в нём нет.',
      ] },
      { h: 'Связь', p: [`Вопросы и сообщения об ошибках — в [GitHub Issues](${ISSUES}). Исходный код Kadr открыт: [${REPO.replace('https://', '')}](${REPO}).`] },
    ],
  },
  en: {
    title: 'Privacy — Kadr',
    description: 'How Kadr treats your videos and data: everything is processed on your device, nothing is uploaded.',
    h1: 'Privacy',
    intro: 'Kadr is a video editor that runs entirely on your device. Your videos, photos, sound, text and speech never leave your phone or computer.',
    sections: [
      { h: 'What is processed on the device', items: [
        'Video, photos and sound: import, editing, effects, export. Files are never uploaded.',
        'Speech recognition (captions, Reel in 1 tap, removing pauses and filler words): the model runs in the browser; no audio is sent.',
        'Background removal, face hiding, auto reframe and noise reduction run on the device too.',
      ] },
      { h: 'What is downloaded, and from where', items: [
        'Kadr itself, from this site (GitHub Pages). After the first visit it works offline.',
        'Speech recognition models (41–249 MB), once, the first time you make captions, from this same site; if it cannot be reached, and for the largest one (“Most accurate”, Whisper small), from [Hugging Face](https://huggingface.co). The request holds only the model file’s address, none of your data. The site a file comes from sees your IP address, as any website does.',
        'Library music, from this site, when you pick it.',
      ] },
      { h: 'What is stored, and where', items: [
        'Projects, media, models and the error log are stored in the browser on this device (IndexedDB, Cache API, the site’s file system). Delete them by deleting projects in Kadr or the site’s data in the browser settings.',
        'Safari on iPhone erases the data of a site not opened for 7 days unless it is on the Home Screen. Keep a backup of important projects.',
      ] },
      { h: 'What there is not', items: [
        'No sign-up, accounts, ads, cookies or third-party trackers.',
        'No telemetry leaves the device: action counters live only in the memory of the open tab. If anonymous statistics ever come, they will carry no content, have an opt-out, and this page will change before they do.',
      ] },
      { h: 'Errors', p: [
        'When something fails, Kadr offers “Details”: the version, the device, where and what kind of error. The same is kept on the device (the last 50 entries) and shown on the diagnostics page. Nothing is sent by itself: “Copy for support” puts the text on the clipboard, and whether you send it is up to you. File names and your text are not in it.',
      ] },
      { h: 'Contact', p: [`Questions and bug reports: [GitHub Issues](${ISSUES}). Kadr’s source code is open: [${REPO.replace('https://', '')}](${REPO}).`] },
    ],
  },
};

const lic = (name: string, by: string, license: string, url: string, note = '') => `[${name}](${url}) — ${by}, ${license}${note ? `. ${note}` : ''}`;

const MODELS: Record<Lang, string[]> = {
  ru: [
    lic('GigaAM v3', 'Sber (ai-sage), экспорт в ONNX — istupakov', 'MIT', 'https://huggingface.co/istupakov/gigaam-v3-onnx', 'Русская речь'),
    lic('FastConformer Hybrid Large RU P&C', 'NVIDIA, экспорт в ONNX int8 — istupakov', '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)', 'https://huggingface.co/nvidia/stt_ru_fastconformer_hybrid_large_pc', 'Русская речь на телефонах. Изменения: преобразована в ONNX и квантована в int8 ([istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx](https://huggingface.co/istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx)); Kadr берёт выход CTC'),
    lic('Whisper tiny, base, small', 'OpenAI, преобразование в ONNX — onnx-community (Hugging Face)', 'Apache-2.0', 'https://huggingface.co/openai/whisper-base', 'Речь на других языках'),
    lic('Silero VAD', 'Silero Team, ONNX — onnx-community', 'MIT', 'https://huggingface.co/onnx-community/silero-vad', 'Поиск речи'),
    lic('Selfie Segmenter', 'Google (MediaPipe)', 'Apache-2.0', 'https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter', 'Удаление фона'),
    lic('BlazeFace (short range)', 'Google (MediaPipe)', 'Apache-2.0', 'https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector', 'Скрытие лиц'),
    lic('RNNoise', 'Xiph.Org Foundation, Jean-Marc Valin', 'BSD-3-Clause', 'https://github.com/xiph/rnnoise', 'Шумоподавление (сборка WASM — @shiguredo/rnnoise-wasm, Apache-2.0)'),
  ],
  en: [
    lic('GigaAM v3', 'Sber (ai-sage), ONNX export by istupakov', 'MIT', 'https://huggingface.co/istupakov/gigaam-v3-onnx', 'Russian speech'),
    lic('FastConformer Hybrid Large RU P&C', 'NVIDIA, ONNX int8 export by istupakov', '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)', 'https://huggingface.co/nvidia/stt_ru_fastconformer_hybrid_large_pc', 'Russian speech on phones. Changes: converted to ONNX and quantized to int8 ([istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx](https://huggingface.co/istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx)); Kadr uses its CTC output'),
    lic('Whisper tiny, base, small', 'OpenAI, ONNX conversion by onnx-community (Hugging Face)', 'Apache-2.0', 'https://huggingface.co/openai/whisper-base', 'Speech in other languages'),
    lic('Silero VAD', 'Silero Team, ONNX by onnx-community', 'MIT', 'https://huggingface.co/onnx-community/silero-vad', 'Finding speech'),
    lic('Selfie Segmenter', 'Google (MediaPipe)', 'Apache-2.0', 'https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter', 'Background removal'),
    lic('BlazeFace (short range)', 'Google (MediaPipe)', 'Apache-2.0', 'https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector', 'Hiding faces'),
    lic('RNNoise', 'Xiph.Org Foundation, Jean-Marc Valin', 'BSD-3-Clause', 'https://github.com/xiph/rnnoise', 'Noise reduction (WASM build: @shiguredo/rnnoise-wasm, Apache-2.0)'),
  ],
};

/** Libraries in the browser bundle (`npm ls --omit=dev`, without packages only Node uses). */
const LIBRARIES: [string, string, string][] = [
  ['React, React DOM', 'MIT', 'https://github.com/facebook/react'],
  ['Mediabunny', 'MPL-2.0', 'https://github.com/Vanilagy/mediabunny'],
  ['SoundTouchJS (@soundtouchjs/core, interpolation-strategy-lanczos)', 'MPL-2.0', 'https://github.com/cutterbl/SoundTouchJS'],
  ['Transformers.js (@huggingface/transformers, tokenizers)', 'Apache-2.0', 'https://github.com/huggingface/transformers.js'],
  ['@huggingface/jinja', 'MIT', 'https://github.com/huggingface/huggingface.js'],
  ['ONNX Runtime Web', 'MIT', 'https://github.com/microsoft/onnxruntime'],
  ['FlatBuffers', 'Apache-2.0', 'https://github.com/google/flatbuffers'],
  ['Long.js', 'Apache-2.0', 'https://github.com/dcodeIO/long.js'],
  ['protobuf.js', 'BSD-3-Clause', 'https://github.com/protobufjs/protobuf.js'],
  ['guid-typescript', 'ISC', 'https://github.com/NicolasDeveloper/guid-typescript'],
  ['platform.js', 'MIT', 'https://github.com/bestiejs/platform.js'],
  ['MediaPipe Tasks Vision', 'Apache-2.0', 'https://github.com/google-ai-edge/mediapipe'],
  ['@shiguredo/rnnoise-wasm', 'Apache-2.0', 'https://github.com/shiguredo/rnnoise-wasm'],
  ['Lucide icons (lucide-react)', 'ISC', 'https://github.com/lucide-icons/lucide'],
  ['@use-gesture', 'MIT', 'https://github.com/pmndrs/use-gesture'],
  ['Zustand', 'MIT', 'https://github.com/pmndrs/zustand'],
  ['Immer', 'MIT', 'https://github.com/immerjs/immer'],
  ['fflate', 'MIT', 'https://github.com/101arrowz/fflate'],
  ['gifenc', 'MIT', 'https://github.com/mattdesl/gifenc'],
  ['idb-keyval', 'Apache-2.0', 'https://github.com/jakearchibald/idb-keyval'],
  ['tslib', '0BSD', 'https://github.com/microsoft/tslib'],
  ['Workbox (service worker)', 'MIT', 'https://github.com/GoogleChrome/workbox'],
];

const FONTS = ['Amatic SC', 'Anton', 'Bebas Neue', 'Caveat', 'Comfortaa', 'Exo 2', 'Inter', 'Lobster', 'Lora', 'Marck Script', 'Montserrat',
  'Oswald', 'Pacifico', 'Playfair Display', 'Press Start 2P', 'PT Serif', 'Raleway', 'Roboto Mono', 'Rubik', 'Rubik Mono One', 'Russo One',
  'Unbounded', 'Yeseva One'];

const SOVA: Record<Lang, string> = {
  ru: 'Образец живой речи на странице диагностики (10 с) — из набора [SOVA RuDevices](https://huggingface.co/datasets/bond005/sova_rudevices) (SOVA.ai; публикация на Hugging Face — Иван Бондаренко, bond005), лицензия [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Изменения: фрагменты вырезаны, склеены с паузами и пережаты в AAC.',
  en: 'The live speech sample on the diagnostics page (10 s) is from [SOVA RuDevices](https://huggingface.co/datasets/bond005/sova_rudevices) (SOVA.ai; published on Hugging Face by Ivan Bondarenko, bond005), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: excerpts were cut, joined with pauses and re-encoded to AAC.',
};

export const LICENSES: Record<Lang, LegalPage> = {
  ru: {
    title: 'Лицензии — Kadr',
    description: 'Модели, библиотеки, шрифты, музыка и записи, на которых построен Kadr, и их лицензии.',
    h1: 'Лицензии',
    intro: 'Kadr построен на открытых моделях и библиотеках. Спасибо их авторам. Ниже — всё, что приходит в браузер, и лицензии.',
    sections: [
      { h: 'Модели (скачиваются при первом использовании)', items: MODELS.ru },
      { h: 'Библиотеки', items: LIBRARIES.map(([n, l, u]) => `[${n}](${u}) — ${l}`) },
      { h: 'Исходный код под MPL-2.0', p: [
        'Mediabunny и SoundTouchJS распространяются по [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/); их исходный код — по ссылкам выше. Kadr при сборке меняет одну строку в файле src/target.js библиотеки Mediabunny: буфер в памяти растёт обычными ArrayBuffer вместо резервирования 4 ГиБ адресного пространства. Изменение — [scripts/no-reserve.ts](https://github.com/TimofeyS22/Kadr/blob/main/scripts/no-reserve.ts) в открытом репозитории Kadr.',
      ] },
      { h: 'Шрифты', p: [`${FONTS.join(', ')} — [SIL Open Font License 1.1](https://openfontlicense.org), пакеты [Fontsource](https://fontsource.org).`] },
      { h: 'Музыка', p: ['Все треки библиотеки — HoliznaCC0, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (общественное достояние), источник — [Free Music Archive](https://freemusicarchive.org/music/holiznacc0). Название и ссылка на каждый трек есть в Kadr рядом с треком.'] },
      { h: 'Записи', p: [SOVA.ru] },
    ],
  },
  en: {
    title: 'Licenses — Kadr',
    description: 'The models, libraries, fonts, music and recordings Kadr is built on, and their licenses.',
    h1: 'Licenses',
    intro: 'Kadr is built on open models and libraries. Thanks to their authors. Below is everything that reaches your browser, with its license.',
    sections: [
      { h: 'Models (downloaded on first use)', items: MODELS.en },
      { h: 'Libraries', items: LIBRARIES.map(([n, l, u]) => `[${n}](${u}) — ${l}`) },
      { h: 'Source code under MPL-2.0', p: [
        'Mediabunny and SoundTouchJS are distributed under the [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/); their source code is at the links above. When Kadr is built, it changes one line of Mediabunny’s src/target.js: an in-memory buffer grows with plain ArrayBuffers instead of reserving 4 GiB of address space. The change is [scripts/no-reserve.ts](https://github.com/TimofeyS22/Kadr/blob/main/scripts/no-reserve.ts) in Kadr’s open repository.',
      ] },
      { h: 'Fonts', p: [`${FONTS.join(', ')}: [SIL Open Font License 1.1](https://openfontlicense.org), [Fontsource](https://fontsource.org) packages.`] },
      { h: 'Music', p: ['Every library track is by HoliznaCC0, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), from the [Free Music Archive](https://freemusicarchive.org/music/holiznacc0). Kadr shows each track’s title and link next to it.'] },
      { h: 'Recordings', p: [SOVA.en] },
    ],
  },
};
