// The question before a speech model download (audit V-181): the first tap on Captions or on the reel took 132–225 MB
// without a word. Now the person sees how much comes and says yes or "not now", in the sheet they are in. A model
// this device already keeps brings no question: one tap, as before.
import { useEffect, useRef, useState } from 'react';
import { Smartphone } from 'lucide-react';
import type { ModelDownload } from '../engine/captions';
import { t } from '../lib/i18n';
import { track } from '../lib/telemetry';
import { Button } from './ck/controls';

/**
 * The browser says the network is a mobile one, or that the person asked to save data (Chromium on Android; Safari
 * and Firefox say nothing, and the question stays as it is).
 */
function onMobileData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection;
  return !!c && (c.saveData === true || c.type === 'cellular');
}

/** One question at a time: `ask` shows it and waits for `answer`. A sheet closed with the question on it is "not now". */
export function useModelAsk(): { asked: ModelDownload | null; ask: (d: ModelDownload) => Promise<boolean>; answer: (yes: boolean) => void } {
  const [asked, setAsked] = useState<ModelDownload | null>(null);
  const waiting = useRef<{ d: ModelDownload; resolve: (yes: boolean) => void } | null>(null);
  const settle = (yes: boolean) => {
    const w = waiting.current;
    if (!w) return;
    waiting.current = null;
    track('speech_model_asked', { model: w.d.model, mb: w.d.mb, why: w.d.why ?? 'first', agreed: yes, mobileData: onMobileData() });
    w.resolve(yes);
  };
  useEffect(() => () => settle(false), []);
  return {
    asked,
    ask: (d) => new Promise<boolean>((resolve) => {
      settle(false); // a question nobody answered gives way to the next one
      waiting.current = { d, resolve };
      setAsked(d);
    }),
    answer: (yes) => { setAsked(null); settle(yes); },
  };
}

/** Why a model is needed in the middle of a run; the first question needs no reason, the person has just asked for it. */
const WHY: Record<NonNullable<ModelDownload['why']>, string> = {
  language: 'This does not sound like Russian speech: another speech model will read it.',
  memory: 'That speech model did not fit in this device’s memory: a smaller one is needed.',
};

/** `yes`: the words of the button that agrees, for the job this sheet does ("Download and make captions"). */
export function ModelAsk({ d, yes, onAnswer }: { d: ModelDownload; yes: string; onAnswer: (yes: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // The sheet was scrolled to the button that started this ("Make the reel" is at its bottom): the question is read
  // from its first word.
  useEffect(() => { ref.current?.closest('.sheet-body')?.scrollTo(0, 0); }, []);
  return (
    <div ref={ref} className="model-ask ck-work ck-ask" role="group" aria-label={t('Speech model download')}>
      <p className="ck-work-label">
        {d.why && `${t(WHY[d.why])} `}
        {t('{mb} MB will be downloaded once; after that captions work offline.', { mb: d.mb })}
      </p>
      {onMobileData() && <p className="model-ask-data ck-alert"><Smartphone aria-hidden /><span>{t('You are on mobile data now.')}</span></p>}
      <div className="ck-work-actions" data-stack>
        <Button variant="primary" size="large" onClick={() => onAnswer(true)}>{yes}</Button>
        <Button variant="plain" onClick={() => onAnswer(false)}>{t('Not now')}</Button>
      </div>
    </div>
  );
}
