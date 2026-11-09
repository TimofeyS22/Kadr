// Shown once on an iPhone before the first pick from Photos (owner, 2026-11-10: "videos from the gallery load very
// slowly"). The wait is the iPhone's: its picker re-encodes HEVC to H.264 before a site gets the file, 30–93 s for a
// 20 s 4K clip, against ~3 s for the original (reports/Долгая загрузка видео на iPhone.md). Kadr's own part, measured on
// an iPhone 15, is 0.2–0.7 s for files of 65–191 MB (scripts/l5-import.mjs). A site cannot change the picker's format;
// the person can, once, and the iPhone remembers. The advice used to come as a toast after the slow pick had happened.
import { t } from '../lib/i18n';
import { pickAfterFormatCard } from './actions';

export function IosFormatBody() {
  return (
    <>
      <p className="hint lead">{t('An iPhone re-encodes a video from Photos before a site gets it: up to a minute and a half for 20 seconds of 4K, and the quality drops. The iPhone does this, not Kadr. Ask it for originals once:')}</p>
      <p className="steps">{t('In the Photos window: ⋯ → Options → Format: Current')}</p>
      <button className="btn primary big" onClick={() => void pickAfterFormatCard()}>{t('Choose from Photos')}</button>
      <p className="hint">{t('The iPhone remembers the choice, and videos then arrive in seconds. Cannot find it? Save the video to Files and pick it from there: that way it also arrives untouched.')}</p>
    </>
  );
}
