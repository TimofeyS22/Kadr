// Task pages (docs/08 C): one static page per job people search for, in Russian and English. Every claim here must be
// true of Kadr today — check the changelog in docs/02 before adding one. Task ids match src/ui/tasks.ts (unit-tested).

export type Lang = 'ru' | 'en';
export interface TaskPage {
  task: string;
  slug: Record<Lang, string>;
  /** <title>, ≤ 60 characters. */
  title: Record<Lang, string>;
  /** meta description, ≤ 160 characters. */
  description: Record<Lang, string>;
  h1: Record<Lang, string>;
  intro: Record<Lang, string>;
  steps: Record<Lang, string[]>;
  faq: Record<Lang, [string, string][]>;
}

export const UI: Record<Lang, {
  cta: string; ctaNote: string; how: string; why: string; whyItems: string[]; faq: string; more: string; all: string;
  hubTitle: string; hubDescription: string; hubH1: string; hubIntro: string; open: string; footer: string; other: string;
}> = {
  ru: {
    cta: 'Открыть Kadr', ctaNote: 'Бесплатно, без регистрации и установки',
    how: 'Как это сделать', why: 'Почему Kadr',
    whyItems: [
      'Бесплатно и без водяного знака: экспорт MP4 вплоть до 4K.',
      'Видео не покидает телефон: всё обрабатывается на устройстве, ничего не загружается на сервер.',
      'Работает по ссылке в браузере — iPhone (Safari, iOS 26+) и Android (Chrome). После первого визита работает и без интернета.',
      'Никаких кредитов и подписок за базовые функции, права на ваш контент остаются у вас.',
    ],
    faq: 'Вопросы', more: 'Другие задачи', all: 'Все инструменты',
    hubTitle: 'Kadr — бесплатный видеоредактор в браузере телефона',
    hubDescription: 'Монтаж видео на телефоне прямо в браузере: субтитры, паузы, музыка, скорость, фон, суфлёр. Бесплатно, без водяного знака, видео не покидает телефон.',
    hubH1: 'Видеоредактор, который открывается по ссылке',
    hubIntro: 'Kadr — монтаж коротких роликов прямо в браузере телефона. Ничего не нужно устанавливать, видео обрабатывается на самом устройстве. Выберите задачу:',
    open: 'Открыть', footer: 'Kadr — приватный видеоредактор. Видео обрабатывается на вашем устройстве.', other: 'English',
  },
  en: {
    cta: 'Open Kadr', ctaNote: 'Free, no sign-up, nothing to install',
    how: 'How to do it', why: 'Why Kadr',
    whyItems: [
      'Free with no watermark: MP4 export up to 4K.',
      'Your video never leaves your phone: everything is processed on the device, nothing is uploaded.',
      'Works from a link in the browser — iPhone (Safari, iOS 26+) and Android (Chrome). After the first visit it works offline too.',
      'No credits or subscriptions for the basics, and your content stays yours.',
    ],
    faq: 'Questions', more: 'Other tasks', all: 'All tools',
    hubTitle: 'Kadr — free video editor in your phone’s browser',
    hubDescription: 'Edit videos on your phone right in the browser: captions, pauses, music, speed, background, teleprompter. Free, no watermark, your video stays on your phone.',
    hubH1: 'A video editor that opens from a link',
    hubIntro: 'Kadr edits short videos right in your phone’s browser. Nothing to install, and your video is processed on the device itself. Pick a task:',
    open: 'Open', footer: 'Kadr — a private video editor. Your video is processed on your device.', other: 'Русский',
  },
};

export const PAGES: TaskPage[] = [
  {
    task: 'reel',
    slug: { ru: 'rils-iz-video', en: 'reel-from-talking-video' },
    title: { ru: 'Рилс из видео с речью в 1 тап — бесплатно | Kadr', en: 'Talking-head video to Reel in one tap, free | Kadr' },
    description: {
      ru: 'Выберите видео, где вы говорите: Kadr уберёт паузы и «эээ», добавит субтитры с подсветкой слова, приближения, заголовок и музыку. Бесплатно, на телефоне.',
      en: 'Pick a video of you talking: Kadr cuts pauses and “um”s, adds word-highlight captions, zoom-ins, a title and music. Free, on your phone.',
    },
    h1: { ru: 'Рилс из записи речи в один тап', en: 'Turn a talking video into a Reel in one tap' },
    intro: {
      ru: 'Записали себя на камеру? Kadr сам сделает из этого ролик для Reels, TikTok или Shorts: вырежет паузы и слова-паразиты, добавит субтитры, где подсвечивается произносимое слово, приближения на склейках, заголовок из первой фразы и спокойную музыку, которая тише под голосом. Каждый шаг виден на таймлайне и отменяется.',
      en: 'Recorded yourself talking? Kadr turns it into a Reels, TikTok or Shorts video by itself: it cuts pauses and filler words, adds captions that highlight the spoken word, zoom-ins on the cuts, a title from your first phrase and calm music that dips under your voice. Every step is on the timeline and can be undone.',
    },
    steps: {
      ru: ['Откройте Kadr и нажмите «Рилс в 1 тап».', 'Выберите видео, где вы говорите в камеру.', 'Подождите, пока Kadr распознает речь и смонтирует ролик — прогресс виден на экране.', 'Поправьте, что хочется, и нажмите «Экспорт».'],
      en: ['Open Kadr and tap “Reel in 1 tap”.', 'Pick a video of you talking to the camera.', 'Wait while Kadr recognizes the speech and edits the video — progress is shown on screen.', 'Adjust anything you like and tap “Export”.'],
    },
    faq: {
      ru: [
        ['Нужен ли интернет?', 'Один раз — чтобы скачать модель распознавания речи (около 77 МБ) и трек музыки. Сама речь распознаётся на телефоне и никуда не отправляется.'],
        ['Можно отменить, если что-то вырезалось не так?', 'Да. Кнопка «Отменить всё» возвращает исходное видео, а любой шаг можно поправить на таймлайне.'],
        ['На каких языках работает?', 'Русский, английский, испанский, португальский, немецкий, французский, итальянский, украинский, турецкий, хинди и японский.'],
      ],
      en: [
        ['Do I need the internet?', 'Once — to download the speech model (about 77 MB) and a music track. The speech itself is recognized on your phone and never sent anywhere.'],
        ['Can I undo it if something was cut wrong?', 'Yes. “Undo all” brings back the original video, and every step can be adjusted on the timeline.'],
        ['Which languages work?', 'English, Russian, Spanish, Portuguese, German, French, Italian, Ukrainian, Turkish, Hindi and Japanese.'],
      ],
    },
  },
  {
    task: 'captions',
    slug: { ru: 'subtitry-k-video', en: 'add-captions-to-video' },
    title: { ru: 'Субтитры к видео бесплатно на телефоне | Kadr', en: 'Add captions to video free on your phone | Kadr' },
    description: {
      ru: 'Автоматические субтитры к видео прямо на телефоне: по слову, фразой или с подсветкой слова. Без водяного знака, звук не загружается на сервер.',
      en: 'Automatic captions for your video right on your phone: word by word, as phrases or with the spoken word highlighted. No watermark, audio never uploaded.',
    },
    h1: { ru: 'Субтитры к видео — автоматически и бесплатно', en: 'Add captions to a video — automatically and free' },
    intro: {
      ru: 'Kadr распознаёт речь в вашем видео и превращает её в субтитры. Можно выбрать вид — фраза целиком, по одному слову, подсветка произносимого слова или слова, появляющиеся по мере речи, — и стиль. Текст правится построчно, готовые субтитры сохраняются в .srt.',
      en: 'Kadr recognizes the speech in your video and turns it into captions. Pick the layout — whole phrases, one word at a time, the spoken word highlighted, or words appearing as they are said — and a style. The text is editable line by line, and you can save the captions as .srt.',
    },
    steps: {
      ru: ['Откройте Kadr и добавьте видео.', 'Нажмите «Субтитры», выберите язык, вид и стиль.', 'Нажмите «Создать субтитры» и дождитесь распознавания.', 'Исправьте слова, если нужно, и сохраните видео.'],
      en: ['Open Kadr and add your video.', 'Tap “Captions”, choose the language, layout and style.', 'Tap “Create captions” and wait for the recognition.', 'Fix any words if needed and save the video.'],
    },
    faq: {
      ru: [
        ['Это правда бесплатно?', 'Да, без лимитов по длине и без водяного знака.'],
        ['Куда уходит звук моего видео?', 'Никуда: речь распознаётся моделью Whisper прямо на телефоне. Из сети скачивается только сама модель, один раз.'],
        ['Можно загрузить свои субтитры?', 'Да, Kadr импортирует .srt и .vtt и сохраняет субтитры в .srt.'],
        ['Насколько точно?', 'Есть три модели: быстрая, точная (по умолчанию) и максимально точная. Чем больше модель, тем меньше ошибок, особенно когда в видео играет музыка.'],
      ],
      en: [
        ['Is it really free?', 'Yes — no length limits and no watermark.'],
        ['Where does my video’s audio go?', 'Nowhere: the Whisper model recognizes speech right on your phone. Only the model itself is downloaded, once.'],
        ['Can I upload my own subtitles?', 'Yes, Kadr imports .srt and .vtt and saves captions as .srt.'],
        ['How accurate is it?', 'There are three models: fast, accurate (the default) and most accurate. Bigger models make fewer mistakes, especially with music in the background.'],
      ],
    },
  },
  {
    task: 'pauses',
    slug: { ru: 'ubrat-pauzy-iz-video', en: 'remove-pauses-from-video' },
    title: { ru: 'Убрать паузы из видео автоматически | Kadr', en: 'Remove pauses and silence from video | Kadr' },
    description: {
      ru: 'Kadr находит тишину в видео и вырезает паузы одной кнопкой: можно настроить порог, длину паузы и запас вокруг слов. Бесплатно, на телефоне.',
      en: 'Kadr finds the silence in your video and cuts the pauses with one button: tune the threshold, pause length and padding around words. Free, on your phone.',
    },
    h1: { ru: 'Убрать паузы из видео одной кнопкой', en: 'Remove pauses from a video with one button' },
    intro: {
      ru: 'Длинные паузы убивают удержание. Kadr слушает звук клипа, находит тишину и вырезает её, оставляя немного запаса вокруг слов, чтобы речь не обрывалась. Перед тем как резать, видно, сколько пауз уйдёт и на сколько секунд станет короче ролик.',
      en: 'Long pauses kill retention. Kadr listens to the clip, finds the silence and cuts it, keeping a little padding around words so the speech never sounds clipped. Before cutting you see how many pauses go and how many seconds shorter the video gets.',
    },
    steps: {
      ru: ['Добавьте видео в Kadr и выберите клип.', 'Нажмите «Убрать паузы».', 'При шуме на фоне поднимите уровень тишины, при желании измените самую короткую паузу.', 'Нажмите «Убрать паузы» — всё можно отменить.'],
      en: ['Add your video to Kadr and select the clip.', 'Tap “Remove pauses”.', 'With background noise, raise the silence level; adjust the shortest pause if you like.', 'Tap “Remove pauses” — it can all be undone.'],
    },
    faq: {
      ru: [
        ['А слова-паразиты тоже можно убрать?', 'Да: создайте субтитры и откройте «Монтаж по тексту» — отметьте «эээ» и повторы, и они вырежутся из видео.'],
        ['Не обрежет ли он слова?', 'Вокруг речи оставляется запас тишины, его можно увеличить ползунком «Запас вокруг слов».'],
        ['Это работает с музыкой на фоне?', 'Хуже: музыку сложно отличить от речи по громкости. Лучше убирать паузы до того, как добавить музыку.'],
      ],
      en: [
        ['Can it remove filler words too?', 'Yes: create captions and open “Edit video by text” — mark the “um”s and repeats and they are cut out of the video.'],
        ['Will it clip my words?', 'A little silence is kept around speech; increase it with the “Keep around words” slider.'],
        ['Does it work with background music?', 'Less well: music is hard to tell from speech by loudness. Remove pauses before adding music.'],
      ],
    },
  },
  {
    task: 'speed',
    slug: { ru: 'uskorit-video', en: 'speed-up-video' },
    title: { ru: 'Ускорить видео онлайн на телефоне | Kadr', en: 'Speed up a video online on your phone | Kadr' },
    description: {
      ru: 'Ускорьте или замедлите видео в 1,25, 1,5, 2 раза и больше — голос остаётся естественным, без эффекта «бурундука». Кривые скорости. Бесплатно.',
      en: 'Speed up or slow down a video 1.25×, 1.5×, 2× and more — the voice stays natural, no chipmunk effect. Speed curves too. Free.',
    },
    h1: { ru: 'Ускорить видео без «голоса бурундука»', en: 'Speed up a video without the chipmunk voice' },
    intro: {
      ru: 'В Kadr скорость меняется в один тап: 0,25×, 0,5×, 1,25×, 1,5×, 2×, 4× или любое значение ползунком. По умолчанию голос сохраняет естественную высоту тона — речь звучит быстрее, но не смешно. Для эффектных переходов есть кривые скорости.',
      en: 'In Kadr, speed changes with one tap: 0.25×, 0.5×, 1.25×, 1.5×, 2×, 4× or any value with the slider. By default the voice keeps its natural pitch — the speech gets faster, not funny. For dramatic moments there are speed curves.',
    },
    steps: {
      ru: ['Добавьте видео в Kadr и выберите клип.', 'Нажмите «Скорость».', 'Выберите, например, 1,25× или 1,5×.', 'Сохраните видео — голос останется естественным.'],
      en: ['Add your video to Kadr and select the clip.', 'Tap “Speed”.', 'Pick, say, 1.25× or 1.5×.', 'Save the video — the voice stays natural.'],
    },
    faq: {
      ru: [
        ['Можно ли ускорить только часть видео?', 'Да: разрежьте клип и ускорьте нужный кусок, либо используйте кривую скорости.'],
        ['Почему голос не становится писклявым?', 'Kadr сохраняет высоту тона: звук обрабатывается на устройстве перед сохранением.'],
        ['Можно наоборот замедлить?', 'Да, до 0,1×, в том числе плавно — кривыми скорости.'],
      ],
      en: [
        ['Can I speed up just part of the video?', 'Yes: split the clip and speed up that piece, or use a speed curve.'],
        ['Why doesn’t the voice get squeaky?', 'Kadr keeps the pitch: the sound is processed on the device before saving.'],
        ['Can I slow it down instead?', 'Yes, down to 0.1×, including smoothly with speed curves.'],
      ],
    },
  },
  {
    task: 'music',
    slug: { ru: 'dobavit-muzyku-k-video', en: 'add-music-to-video' },
    title: { ru: 'Музыка для видео без авторских прав | Kadr', en: 'Add copyright-free music to video | Kadr' },
    description: {
      ru: 'Добавьте к видео музыку без авторских прав (CC0): 8 настроений, бит размечен, музыка тише под голос. Можно на YouTube и в рекламе, без указания автора.',
      en: 'Add copyright-free (CC0) music to your video: 8 moods, beats marked, music dips under your voice. Fine on YouTube and in ads, no credit needed.',
    },
    h1: { ru: 'Музыка к видео — без претензий от Content ID', en: 'Music for your video — without Content ID claims' },
    intro: {
      ru: 'В Kadr есть библиотека треков с лицензией CC0 (общественное достояние): их можно использовать где угодно, включая монетизацию и рекламу, без указания автора. Трек подгоняется по длине ролика с затуханием, бит уже размечен — клипы можно нарезать в такт. Для спора с Content ID есть кнопка «Скопировать лицензию».',
      en: 'Kadr has a library of tracks licensed CC0 (public domain): use them anywhere, including monetized videos and ads, with no credit needed. The track is fitted to your video’s length with a fade, and the beat is already marked so you can cut clips on the beat. For a Content ID dispute there is a “Copy license” button.',
    },
    steps: {
      ru: ['Добавьте видео в Kadr.', 'Нажмите «Музыка» и выберите настроение.', 'Прослушайте треки и нажмите «Добавить».', 'Включите «Тише, когда говорят», если в видео есть речь.'],
      en: ['Add your video to Kadr.', 'Tap “Music” and pick a mood.', 'Listen to the tracks and tap “Add”.', 'Turn on “Lower when others speak” if your video has speech.'],
    },
    faq: {
      ru: [
        ['Можно ли использовать музыку на YouTube?', 'Да: треки CC0 не требуют разрешения и указания автора, в том числе в монетизированных роликах.'],
        ['Можно добавить свою музыку?', 'Да, любой аудиофайл с телефона через «Звук».'],
        ['А трендовые звуки TikTok?', 'Их добавляют в самом TikTok. В Kadr можно положить трек-ориентир: под него удобно монтировать, но в сохранённый файл он не попадает.'],
      ],
      en: [
        ['Can I use the music on YouTube?', 'Yes: CC0 tracks need no permission or credit, including in monetized videos.'],
        ['Can I add my own music?', 'Yes, any audio file from your phone via “Audio”.'],
        ['What about trending TikTok sounds?', 'Those are added inside TikTok. In Kadr you can lay down a guide track to edit to — it is left out of the saved file.'],
      ],
    },
  },
  {
    task: 'background',
    slug: { ru: 'ubrat-fon-s-video', en: 'remove-video-background' },
    title: { ru: 'Убрать фон с видео без зелёного экрана | Kadr', en: 'Remove video background, no green screen | Kadr' },
    description: {
      ru: 'Вырежьте человека из видео без зелёного экрана прямо на телефоне. Есть и хромакей для зелёного фона. Бесплатно, видео не уходит на сервер.',
      en: 'Cut a person out of a video without a green screen, right on your phone. Chroma key for green screens too. Free, your video never leaves the device.',
    },
    h1: { ru: 'Убрать фон с видео — без зелёного экрана', en: 'Remove the background from a video — no green screen' },
    intro: {
      ru: 'Kadr находит человека в кадре и убирает всё остальное: можно подложить другое видео, фото или цвет. Маска считается на устройстве и сглаживается между кадрами, чтобы края не дрожали. Если снимали на зелёном фоне, есть классический хромакей.',
      en: 'Kadr finds the person in the shot and removes everything else, so you can put another video, photo or color behind them. The mask is computed on the device and smoothed between frames so the edges don’t flicker. Shot on a green screen? There is a classic chroma key too.',
    },
    steps: {
      ru: ['Добавьте фон (видео или фото) на главную дорожку, а видео с человеком — через «Наложение».', 'Выберите клип с человеком.', 'Нажмите «Вырезать фон».', 'Подвиньте и масштабируйте человека пальцами, затем сохраните.'],
      en: ['Add the background (video or photo) to the main track and the video of the person via “Overlay”.', 'Select the clip with the person.', 'Tap “Cutout”.', 'Move and scale the person with your fingers, then save.'],
    },
    faq: {
      ru: [
        ['Нужен ли зелёный экран?', 'Нет, Kadr находит человека сам. Для зелёного фона есть отдельный хромакей.'],
        ['Работает с любыми объектами?', 'Вырезание фона рассчитано на людей. Для остального подойдёт хромакей или маска.'],
        ['Видео куда-то загружается?', 'Нет, всё считается на телефоне.'],
      ],
      en: [
        ['Do I need a green screen?', 'No, Kadr finds the person by itself. For green screens there is a separate chroma key.'],
        ['Does it work with any object?', 'Cutout is made for people. For anything else use the chroma key or a mask.'],
        ['Is my video uploaded?', 'No, it is all computed on the phone.'],
      ],
    },
  },
  {
    task: 'teleprompter',
    slug: { ru: 'suflyor-dlya-zapisi-video', en: 'teleprompter-for-phone' },
    title: { ru: 'Суфлёр для записи видео на телефон | Kadr', en: 'Teleprompter for recording on your phone | Kadr' },
    description: {
      ru: 'Бесплатный суфлёр в браузере: текст прокручивается поверх камеры, скорость и размер настраиваются, есть проверка скорости. Запись сразу на таймлайн.',
      en: 'A free teleprompter in your browser: text scrolls over the camera, speed and size are adjustable, with a speed test. The recording lands right on the timeline.',
    },
    h1: { ru: 'Суфлёр для съёмки на телефон', en: 'A teleprompter for filming on your phone' },
    intro: {
      ru: 'Вставьте текст — и читайте его, глядя в камеру. Суфлёр прокручивается с выбранной скоростью, размер текста виден сразу при настройке, а кнопка «Проверить скорость» показывает темп до начала записи. Фронтальная камера пишет зеркально, как вы видите себя на экране. Готовая запись сразу попадает на таймлайн.',
      en: 'Paste your script and read it while looking at the camera. The teleprompter scrolls at the speed you choose, the text size changes live as you adjust it, and “Test the speed” shows the pace before you record. The front camera records mirrored, just as you see yourself. The take lands straight on the timeline.',
    },
    steps: {
      ru: ['Откройте Kadr и нажмите «Камера».', 'Нажмите карандаш и вставьте текст.', 'Настройте скорость и размер, нажмите «Проверить скорость».', 'Нажмите запись — после отсчёта 3-2-1 текст поедет.'],
      en: ['Open Kadr and tap “Camera”.', 'Tap the pencil and paste your script.', 'Set the speed and size, tap “Test the speed”.', 'Tap record — after a 3-2-1 countdown the text starts scrolling.'],
    },
    faq: {
      ru: [
        ['Текст сохранится?', 'Да, сценарий и настройки остаются в браузере до следующего раза.'],
        ['Можно потом смонтировать запись?', 'Да, она сразу оказывается на таймлайне: можно убрать паузы, добавить субтитры и музыку.'],
        ['Нужно что-то устанавливать?', 'Нет, суфлёр работает в браузере.'],
      ],
      en: [
        ['Is my script saved?', 'Yes, the script and settings stay in your browser for next time.'],
        ['Can I edit the recording afterwards?', 'Yes, it lands on the timeline right away: remove pauses, add captions and music.'],
        ['Do I need to install anything?', 'No, the teleprompter runs in the browser.'],
      ],
    },
  },
  {
    task: 'denoise',
    slug: { ru: 'ubrat-shum-iz-video', en: 'remove-background-noise-from-video' },
    title: { ru: 'Убрать шум из видео онлайн бесплатно | Kadr', en: 'Remove background noise from video free | Kadr' },
    description: {
      ru: 'Уберите шум на фоне и сделайте голос чище: шумоподавление и «Улучшить голос» прямо на телефоне. Бесплатно, звук никуда не отправляется.',
      en: 'Remove background noise and make your voice clearer: noise reduction and “Enhance voice” right on your phone. Free, your audio never leaves the device.',
    },
    h1: { ru: 'Убрать шум из видео и сделать голос чище', en: 'Remove background noise and clean up your voice' },
    intro: {
      ru: 'Ветер, гул, шум улицы — Kadr подавляет фоновый шум нейросетью прямо на устройстве. «Улучшить голос» дополнительно выравнивает тембр и громкость речи, как в студии. Обработанный звук сохраняется в проекте, его можно выключить в любой момент.',
      en: 'Wind, hum, street noise — Kadr suppresses background noise with a neural network right on the device. “Enhance voice” also evens out the tone and loudness of your speech, studio-style. The processed sound is kept in the project and can be turned off any time.',
    },
    steps: {
      ru: ['Добавьте видео в Kadr и выберите клип.', 'Нажмите «Громкость».', 'Включите «Убрать фоновый шум» или «Улучшить голос».', 'Дождитесь обработки и сохраните видео.'],
      en: ['Add your video to Kadr and select the clip.', 'Tap “Volume”.', 'Turn on “Reduce background noise” or “Enhance voice”.', 'Wait for the processing and save the video.'],
    },
    faq: {
      ru: [
        ['Звук загружается в облако?', 'Нет, шумоподавление работает на телефоне.'],
        ['Можно вернуть исходный звук?', 'Да, просто выключите тумблер.'],
        ['Поможет при музыке на фоне?', 'Шумоподавление рассчитано на шум, а не на музыку: музыку оно может приглушить вместе с ним.'],
      ],
      en: [
        ['Is my audio uploaded to the cloud?', 'No, noise reduction runs on the phone.'],
        ['Can I get the original sound back?', 'Yes, just turn the switch off.'],
        ['Does it help with background music?', 'It is made for noise, not music: it may turn music down along with it.'],
      ],
    },
  },
  {
    task: 'trim',
    slug: { ru: 'obrezat-video', en: 'trim-video' },
    title: { ru: 'Обрезать видео на телефоне онлайн | Kadr', en: 'Trim a video on your phone online | Kadr' },
    description: {
      ru: 'Обрежьте видео по краям, разрежьте на части и уберите лишнее прямо в браузере телефона. Без водяного знака, без установки, видео не уходит на сервер.',
      en: 'Trim a video’s ends, split it into parts and drop what you don’t need, right in your phone’s browser. No watermark, nothing to install, never uploaded.',
    },
    h1: { ru: 'Обрезать видео прямо в браузере телефона', en: 'Trim a video right in your phone’s browser' },
    intro: {
      ru: 'Выберите клип и потяните белые ручки по краям: край идёт за пальцем, а превью показывает кадр, на котором вы остановились. Нужно вырезать середину — разрежьте клип на плейхеде и удалите кусок. Сохранение — в MP4 без водяного знака.',
      en: 'Select a clip and drag the white handles at its edges: the edge follows your finger and the preview shows the frame you stop on. Need to cut out the middle? Split the clip at the playhead and delete the piece. It saves as MP4 with no watermark.',
    },
    steps: {
      ru: ['Откройте Kadr и добавьте видео.', 'Нажмите на клип на таймлайне.', 'Потяните белые ручки по краям или нажмите «Разрезать».', 'Нажмите «Экспорт» и сохраните видео.'],
      en: ['Open Kadr and add your video.', 'Tap the clip on the timeline.', 'Drag the white handles at the edges, or tap “Split”.', 'Tap “Export” and save the video.'],
    },
    faq: {
      ru: [
        ['Качество испортится?', 'Нет, вы выбираете разрешение при сохранении: 720p, 1080p, 2K или 4K.'],
        ['Есть ли ограничение по длине?', 'Нет, ограничивает только память телефона.'],
        ['Нужен аккаунт?', 'Нет, Kadr работает без регистрации.'],
      ],
      en: [
        ['Will the quality drop?', 'No, you choose the resolution when saving: 720p, 1080p, 2K or 4K.'],
        ['Is there a length limit?', 'No, only your phone’s memory.'],
        ['Do I need an account?', 'No, Kadr works without signing up.'],
      ],
    },
  },
  {
    task: 'gif',
    slug: { ru: 'video-v-gif', en: 'video-to-gif' },
    title: { ru: 'Видео в GIF онлайн на телефоне | Kadr', en: 'Video to GIF online on your phone | Kadr' },
    description: {
      ru: 'Превратите видео в зацикленную GIF прямо на телефоне: обрежьте, добавьте текст и сохраните до 30 секунд. Бесплатно, без водяного знака.',
      en: 'Turn a video into a looping GIF right on your phone: trim it, add text and save up to 30 seconds. Free, no watermark.',
    },
    h1: { ru: 'Видео в GIF — с текстом и без водяного знака', en: 'Video to GIF — with text and no watermark' },
    intro: {
      ru: 'Обрежьте нужный момент, добавьте подпись или стикер — и сохраните как GIF: Kadr сделает зацикленную анимацию до 30 секунд. Всё считается на телефоне, файл сразу можно отправить в мессенджер.',
      en: 'Trim the moment you want, add a caption or a sticker — and save it as a GIF: Kadr makes a looping animation of up to 30 seconds. Everything runs on your phone, and the file is ready to send in a messenger.',
    },
    steps: {
      ru: ['Откройте Kadr и добавьте видео.', 'Обрежьте нужный кусок, добавьте текст или стикер.', 'Нажмите «Экспорт» и выберите «GIF».', 'Сохраните файл.'],
      en: ['Open Kadr and add your video.', 'Trim the part you want, add text or a sticker.', 'Tap “Export” and choose “GIF”.', 'Save the file.'],
    },
    faq: {
      ru: [
        ['Какой длины может быть GIF?', 'До 30 секунд — GIF тяжёлый формат, длиннее лучше сохранять в MP4.'],
        ['Можно сохранить кадр как фото?', 'Да, в «Экспорт» есть «Фото» — текущий кадр в JPEG.'],
        ['А только звук?', 'Да, «Аудио» сохраняет звук ролика отдельным файлом.'],
      ],
      en: [
        ['How long can the GIF be?', 'Up to 30 seconds — GIF is a heavy format; save longer clips as MP4.'],
        ['Can I save a frame as a photo?', 'Yes, “Export” has “Photo” — the current frame as a JPEG.'],
        ['What about just the sound?', 'Yes, “Audio” saves the video’s sound as a separate file.'],
      ],
    },
  },
];
