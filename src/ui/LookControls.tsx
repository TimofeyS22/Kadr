// What the colour and effect sheets share: hold to see the clip without its look, and give the look to every piece.
import { useEffect } from 'react';
import { applyLookToTrack, findClip, type LookPart } from '../core/timeline';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { useEditor } from '../state/store';
import type { LookClip } from './lookTiles';

function BeforeAfter({ clip }: { clip: LookClip }) {
  const hold = (on: boolean) => player.showOriginal(on ? clip.id : null);
  useEffect(() => () => player.showOriginal(null), []);
  // On the window: the finger may slide off the button before it lifts.
  const press = () => {
    hold(true);
    const release = () => {
      hold(false);
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
    };
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
  };
  return (
    <button className="btn compare" aria-label={t('Hold to see the clip without this look')}
      onPointerDown={press}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); hold(true); } }}
      onKeyUp={() => hold(false)} onBlur={() => hold(false)} onContextMenu={(e) => e.preventDefault()}>
      {t('Before / after')}
    </button>
  );
}

function ApplyToAll({ clip, parts }: { clip: LookClip; parts: readonly LookPart[] }) {
  const pieces = useEditor((s) => (s.project ? findClip(s.project, clip.id)?.track.clips.filter((c) => c.kind === 'video' || c.kind === 'image').length ?? 0 : 0));
  if (pieces < 2) return null;
  const apply = () => {
    const { commit, toast } = useEditor.getState();
    let changed = 0;
    commit((d) => { changed = applyLookToTrack(d, clip.id, parts); });
    toast(t('Applied to all pieces: {n}', { n: changed + 1 }), 'info');
  };
  return <button className="btn primary" onClick={apply}>{t('Apply to all pieces ({n})', { n: pieces })}</button>;
}

/** Top of the sheet, so both stay in reach above the tiles. */
export function LookActions({ clip, parts }: { clip: LookClip; parts: readonly LookPart[] }) {
  return (
    <div className="look-actions">
      <BeforeAfter clip={clip} />
      <ApplyToAll clip={clip} parts={parts} />
    </div>
  );
}
