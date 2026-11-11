import { expect, it } from 'vitest';
import { previewWord } from './previewWord';

it('shows the first word of three letters or more, as the person wrote it', () => {
  expect(previewWord('Тёплый день', 'Привет')).toBe('Тёплый');
  expect(previewWord('В Питере летом', 'Привет')).toBe('Питере');
  expect(previewWord('«Мой» день!', 'Привет')).toBe('Мой');
  expect(previewWord('GRWM в Париже', 'Hello')).toBe('GRWM');
  expect(previewWord('Лето\nв городе', 'Привет')).toBe('Лето');
});

it('keeps short texts whole and cuts long words to ten letters', () => {
  expect(previewWord('Я и ты', 'Привет')).toBe('Я и ты');
  expect(previewWord('Достопримечательности', 'Привет')).toBe('Достопримечательности'.slice(0, 10));
  expect(previewWord('🔥 ок 🔥', 'Привет')).toBe('ок');
});

it('stands in a sample where there is nothing of the person\'s', () => {
  expect(previewWord('', 'Привет')).toBe('Привет');
  expect(previewWord('   ', 'Привет')).toBe('Привет');
  expect(previewWord('🔥🔥🔥', 'Привет')).toBe('Привет');
  expect(previewWord('Your text', 'Привет')).toBe('Привет');
  expect(previewWord('— 2026 —', 'Привет')).toBe('Привет');
});
