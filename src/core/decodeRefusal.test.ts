import { describe, expect, it } from 'vitest';
import { RU } from '../lib/locale-ru';
import { MIN_VIDEO_SIDE, PLAIN_CONFIG, cannotDecode, tooSmall } from './decodeRefusal';

describe('why a video does not go in (S-1-8, S-1-9)', () => {
  it('a codec the device plays in its ordinary settings: this file\'s size or profile is the reason, with no other browser to try', () => {
    const r = cannotDecode({ codec: 'avc', width: 8192, height: 4320, codecWorks: true, ios: true });
    expect(r.message).not.toMatch(/Chrome|Safari|browser/);
    expect(r.vars).toMatchObject({ width: 8192, height: 4320, codec: 'avc' });
  });

  it('a codec the device does not play at all: on an iPhone no other browser is offered, elsewhere it is', () => {
    expect(cannotDecode({ codec: 'av1', width: 1920, height: 1080, codecWorks: false, ios: true }).message).not.toMatch(/Chrome|Safari/);
    expect(cannotDecode({ codec: 'av1', width: 1920, height: 1080, codecWorks: false, ios: false }).message).toMatch(/Chrome or Safari/);
    expect(cannotDecode({ codec: 'hevc', width: 3840, height: 2160, codecWorks: false, ios: true }).message).toMatch(/Most Compatible/);
  });

  it('a video smaller than a macroblock is refused before it goes in; an ordinary one is not', () => {
    expect(tooSmall(2, 2)?.vars).toEqual({ width: 2, height: 2, min: MIN_VIDEO_SIDE });
    expect(tooSmall(1920, 8)).not.toBeNull();
    expect(tooSmall(MIN_VIDEO_SIDE, MIN_VIDEO_SIDE)).toBeNull();
    expect(tooSmall(1080, 1920)).toBeNull();
  });

  it('every reason is translated, and every codec has an ordinary setting to compare with', () => {
    const all = [cannotDecode({ codec: 'avc', width: 1, height: 1, codecWorks: true, ios: false }), cannotDecode({ codec: 'avc', width: 1, height: 1, codecWorks: false, ios: true }),
      cannotDecode({ codec: 'avc', width: 1, height: 1, codecWorks: false, ios: false }), cannotDecode({ codec: 'hevc', width: 1, height: 1, codecWorks: false, ios: false }), tooSmall(1, 1)!];
    for (const r of all) expect(RU[r.message], r.message).toBeTruthy();
    expect(Object.keys(PLAIN_CONFIG)).toEqual(['avc', 'hevc', 'vp9', 'av1', 'vp8']);
  });
});
