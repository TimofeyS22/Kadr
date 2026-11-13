import { describe, expect, it } from 'vitest';
import { russianVerdict, wordShares, type RussianReading } from './speechLanguage';

const reading = (text: string, confidence: number, seconds = 20): RussianReading => ({ confidence, seconds, words: text.split(' ') });
const RU = 'ну поверь мне зная адрес дома не проблема узнать и квартиру я же говорю девочки не ссорьтесь но при этом в настройках каталога есть фильтры и это очень удобно когда надо быстро найти то что нужно';
const UK = 'привит усим сегодни я покажу як швидко змонтувати видео на телефони спочатку прибираемо паузи потим додаемо субтитри и музику це дуже просто';
const EN = 'хэй эврибади вэлкам бэк ту зэ чэнэл тудэй ай вонт ту шоу ю хау ай эдит э хол видео он май фон ин эбаут тэн минэтс';

describe('is this Russian speech, by what the Russian model read (docs/20 ADR-С3)', () => {
  it('counts the common Russian words of live speech', () => {
    expect(wordShares(RU.split(' ')).russian).toBeGreaterThan(0.35);
    expect(wordShares(EN.split(' ')).russian).toBeLessThan(0.1);
    expect(wordShares(UK.split(' ')).ukrainian).toBeGreaterThan(0.06);
    expect(wordShares([]).n).toBe(0);
  });

  it('takes clean Russian speech by the letters alone, on the first window', () => {
    expect(russianVerdict('ru-fast', [reading(RU, 0.94)])).toBe('russian');
    expect(russianVerdict('ru', [reading(RU, 0.97)])).toBe('russian');
  });

  // The owner, 2026-11-13: «всегда пишется… 77 МБ». Russian under loud music read at 0.85 by FastConformer and at
  // 0.88 by GigaAM, under the thresholds: every such run loaded Whisper base to ask it what the Russian words said.
  it('takes Russian speech under loud music by its words, without Whisper', () => {
    expect(russianVerdict('ru-fast', [reading(RU, 0.85)])).toBe('russian');
    expect(russianVerdict('ru-fast', [reading(RU, 0.78)])).toBe('russian');
    expect(russianVerdict('ru', [reading(RU, 0.88)])).toBe('russian');
  });

  it('does not take Ukrainian for Russian, however sure the letters are', () => {
    expect(russianVerdict('ru-fast', [reading(UK, 0.79)])).toBe('other');
    expect(russianVerdict('ru', [reading(UK, 0.84)])).toBe('other');
    expect(russianVerdict('ru-fast', [reading(UK, 0.9)])).toBe('other');
  });

  it('sends speech that makes no Russian words to Whisper', () => {
    expect(russianVerdict('ru-fast', [reading(EN, 0.69)])).toBe('other');
    expect(russianVerdict('ru', [reading(EN, 0.83)])).not.toBe('russian');
  });

  it('asks for more when there is too little to tell, and says no to long speech with no letters', () => {
    expect(russianVerdict('ru-fast', [])).toBe('unsure');
    expect(russianVerdict('ru-fast', [reading('ну да', 0.8, 2)])).toBe('unsure');
    expect(russianVerdict('ru-fast', [reading('а', 0.5, 20)])).toBe('other');
  });

  it('weighs windows by their length', () => {
    // A short unsure window and a long clear one: Russian.
    expect(russianVerdict('ru-fast', [reading('ну да вот', 0.6, 2), reading(RU, 0.93, 25)])).toBe('russian');
  });
});
