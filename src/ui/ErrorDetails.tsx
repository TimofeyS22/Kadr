// "Details" of an error the person saw (docs/12 stage 4): what support needs to find the fault — version, device,
// where and what kind of error — and a button that copies it. No file names or text of the person's (errorLog.ts).
import { useState } from 'react';
import { reportText, type ErrorEntry } from '../lib/errorLog';
import { t } from '../lib/i18n';

export function ErrorDetails({ entry }: { entry: ErrorEntry }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const text = reportText(entry);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="error-details">
      <pre aria-label={t('Error details')}>{text}</pre>
      <button className="btn" onClick={() => void copy()}>{copied ? t('Copied') : t('Copy for support')}</button>
      {copied === false && <p className="hint">{t('Copying is not allowed here: select the text above and copy it.')}</p>}
      <p className="hint">{t('Nothing is sent by itself. File names and your text are not in it.')}</p>
    </div>
  );
}
