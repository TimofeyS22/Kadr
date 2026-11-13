// Is this Russian speech? Answered by the Russian model itself, from what it read (docs/20 ADR-С3).
//
// A Russian CTC model reads any speech with Russian letters. On Russian speech it is sure of its letters and the words
// are words; on other speech it is less sure and writes letters that make no Russian words. Before docs/20 one number
// decided, on one stretch of speech: the mean confidence of the longest window against a threshold. Russian under loud
// music fell under it (0.85 against 0.88), and every such run loaded Whisper base to ask it — "77 MB" on the screen
// in every run, two more model starts, and Whisper's own mistakes about the language on a noisy window.
// Now the evidence is the confidence, the pace of letters and the words themselves, over up to three windows.

export interface RussianReading {
  /** Mean probability of the letters the model chose, 0..1. */
  confidence: number;
  /** Length of the window, seconds. */
  seconds: number;
  /** The words it read. */
  words: string[];
}
export type RussianVerdict = 'russian' | 'other' | 'unsure';

/**
 * At least this sure, reading at least `letters` a second: Russian by the letters alone. Measured on the eval set:
 * - GigaAM (docs/10 §2): Russian 0.96–0.99, under music 0.88; Ukrainian 0.84, English 0.82–0.84, Spanish 0.92 with
 *   almost no letters.
 * - FastConformer (2026-10-29): Russian 0.925–0.96, under music 0.85; Ukrainian 0.79, German 0.68, English 0.69,
 *   Italian 0.59, Spanish 0.55. Russian reads 7–12 letters/s.
 */
const SURE: Record<'ru' | 'ru-fast', { confidence: number; letters: number }> = {
  ru: { confidence: 0.93, letters: 5 },
  'ru-fast': { confidence: 0.88, letters: 5 },
};
/**
 * Less sure than SURE, down to this: Russian if the words say so (`RUSSIAN_WORDS` of them at least, and almost none
 * that only Ukrainian has). Under it the letters are guesses, and the speech goes to Whisper.
 */
const WITH_WORDS: Record<'ru' | 'ru-fast', number> = { ru: 0.8, 'ru-fast': 0.74 };
/** Share of the words read that are among the commonest Russian words: 0.35–0.5 in Russian speech (see the test). */
const RUSSIAN_WORDS = 0.22;
/** Share of words only Ukrainian has, as a Russian model spells them: above this the speech is not Russian. */
const UKRAINIAN_WORDS = 0.06;
/** Fewer words than this say nothing about a language. */
const MIN_WORDS = 6;

// The commonest words of spoken Russian (function words, and what video talk is made of). One in three to one in two
// words of any Russian speech is here; a word read from speech in another language almost never is.
const RUSSIAN = new Set((
  'и в не на я что он с это как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему ' +
  'теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они ' +
  'тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет тогда кто этот того потому этого ' +
  'какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть ' +
  'после над больше тот через эти нас про всего них какая много разве три эту моя хорошо свою этой перед иногда лучше чуть том нельзя ' +
  'такой им более всегда конечно всю между очень просто привет сегодня давайте спасибо пожалуйста вообще типа короче значит почему ' +
  'который которая которые которого было будут будем можем хочу хочешь хотите знаю знаешь знаете говорю говорит сказал сказала ' +
  'делать сделать нужно должен должна такое такая такие этих свой свои своя наш наша наши ваш ваша ваши тебе себя меня всем всё ещё её'
).split(' '));
// Words Ukrainian has and Russian does not, as a model with Russian letters writes them (і → и, є → е, ї → и).
const UKRAINIAN = new Set((
  'це як але або дуже зараз також який яка яки тому треба вони вона його вже чи ось якщо привит сьогодни сегодни що щоб шо шоб ще вид ' +
  'буде був була були коли хто бо навить тильки дякую будь ласка мени тоби нам вам цей ця ци цього усим всим додаемо прибираемо потим спочатку'
).split(' '));

const normal = (w: string) => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');

/** Shares of the words read that are common Russian words, and that only Ukrainian has. */
export function wordShares(words: readonly string[]): { n: number; russian: number; ukrainian: number } {
  const w = words.map(normal).filter(Boolean);
  if (!w.length) return { n: 0, russian: 0, ukrainian: 0 };
  // Words both languages have (на, не, в, до…) count for Russian only when they are not in the Ukrainian list.
  return { n: w.length, russian: w.filter((x) => RUSSIAN.has(x)).length / w.length, ukrainian: w.filter((x) => UKRAINIAN.has(x) && !RUSSIAN.has(x)).length / w.length };
}

/**
 * What the readings so far say. `russian` and `other` end the question; `unsure` asks for one more window (the caller
 * stops after three, and then `unsure` means Whisper is asked). Weighted by the seconds of each window.
 */
export function russianVerdict(model: 'ru' | 'ru-fast', readings: readonly RussianReading[]): RussianVerdict {
  const seconds = readings.reduce((n, r) => n + r.seconds, 0);
  if (!readings.length || seconds <= 0) return 'unsure';
  const confidence = readings.reduce((n, r) => n + r.confidence * r.seconds, 0) / seconds;
  const all = readings.flatMap((r) => r.words);
  const letters = all.reduce((n, w) => n + normal(w).length, 0) / seconds;
  const shares = wordShares(all);
  const sure = SURE[model];
  if (shares.n >= MIN_WORDS && shares.ukrainian > UKRAINIAN_WORDS) return 'other';
  if (confidence >= sure.confidence && letters >= sure.letters) return 'russian';
  if (shares.n < MIN_WORDS) return letters < 2 && seconds >= 8 ? 'other' : 'unsure';
  if (confidence >= WITH_WORDS[model] && letters >= sure.letters * 0.6 && shares.russian >= RUSSIAN_WORDS) return 'russian';
  if (confidence < WITH_WORDS[model] && shares.russian < RUSSIAN_WORDS / 2) return 'other';
  return 'unsure';
}
