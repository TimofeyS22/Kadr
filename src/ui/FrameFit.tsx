import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ASPECTS } from '../core/defaults';
import type { AspectId, Project } from '../core/types';
import { t } from '../lib/i18n';
import { useEditor } from '../state/store';
import { editClip } from './actions';
import { Button, IconButton } from './ck/controls';

/** Shapes closer than this are one shape: no bars worth a word (the art director, UI-4). */
const NEAR = 0.03;
const KEY = (id: string) => `kadr.frameFit.v1.${id}`;

export interface Fit {
  clipId: string;
  /** The picture's own shape against the frame's: wider leaves bars above and below, narrower at the sides. */
  wider: boolean;
  /** The crop that fills the frame from the centre of the picture. */
  fill: { x: number; y: number; w: number; h: number };
  /** One of the five formats the picture already has, if any. */
  format: AspectId | null;
}

function fitOf(p: Project): Fit | null {
  if (p.settings.background.mode === 'blur') return null; // a blurred copy fills the bars already
  const first = p.tracks.find((tr) => tr.kind === 'main')?.clips[0];
  if (!first || (first.kind !== 'video' && first.kind !== 'image') || first.crop) return null;
  const asset = p.assets[first.assetId];
  if (!asset?.width || !asset.height) return null;
  const shape = asset.width / asset.height, frame = p.settings.width / p.settings.height;
  if (Math.abs(shape / frame - 1) <= NEAR) return null;
  const w = frame < shape ? frame / shape : 1, h = frame < shape ? 1 : shape / frame;
  const format = (Object.keys(ASPECTS) as AspectId[]).find((a) => Math.abs(ASPECTS[a][0] / ASPECTS[a][1] / shape - 1) <= NEAR) ?? null;
  return { clipId: first.id, wider: shape > frame, fill: { x: (1 - w) / 2, y: (1 - h) / 2, w, h }, format };
}

const hasMain = (p: Project) => p.tracks.some((tr) => tr.kind === 'main' && tr.clips.length > 0);

/**
 * Black bars by default (UI-4, rule Ж10): once per project, after the first piece of the main row whose shape is not the
 * frame's, say what the bars are and offer the two ways out that already exist — fill the frame (a crop from the centre,
 * undone in one tap) or the format the video has. It applies nothing by itself. Never for a project opened with pieces
 * already in it, under a sheet or long work, with a blurred background, or once the shapes agree.
 */
export function useFrameFit(waiting = false): { fit: Fit; close: () => void } | null {
  const project = useEditor((s) => s.project);
  const blocked = useEditor((s) => s.sheet !== null || s.busy !== null) || waiting;
  const [said, setSaid] = useState<{ id: string; open: boolean } | null>(null);
  // Decided once per project as it opens: empty and never asked, or not at all.
  useEffect(() => {
    if (!project || said?.id === project.id) return;
    let asked = false;
    try { asked = localStorage.getItem(KEY(project.id)) !== null; } catch { /* private mode: it may be said again */ }
    setSaid({ id: project.id, open: !asked && !hasMain(project) });
  }, [project, said]);
  const open = !!project && said?.id === project.id && said.open;
  const fit = open ? fitOf(project) : null;
  const shown = fit && !blocked ? fit : null;
  useEffect(() => {
    if (shown && project) try { localStorage.setItem(KEY(project.id), '1'); } catch { /* ignore */ }
  }, [shown, project]);
  // Done for this project once its first piece has the frame's shape: it came so, was filled, or gave the format.
  useEffect(() => {
    if (project && open && hasMain(project) && !fitOf(project)) setSaid({ id: project.id, open: false });
  }, [project, open]);
  if (!shown || !project) return null;
  return { fit: shown, close: () => setSaid({ id: project.id, open: false }) };
}

export function FrameFitNote({ fit, close }: { fit: Fit; close: () => void }) {
  const commit = useEditor((s) => s.commit);
  const toast = useEditor((s) => s.toast);
  const fill = () => {
    editClip(fit.clipId, (c) => { if (c.kind === 'video' || c.kind === 'image') c.crop = fit.fill; });
    toast(t('Cropped from the centre. To move it: Crop or Auto reframe.'), 'info');
  };
  const format = () => commit((d) => {
    if (!fit.format) return;
    const [width, height] = ASPECTS[fit.format];
    Object.assign(d.settings, { aspect: fit.format, width, height });
  });
  // One row (SW-U-11): the frame is what the answer is about, and in a card of 136 px it was 126 px wide on a 667 px
  // screen. A raised strip says it is a message, not a row of controls; the answers and the close keep together and go
  // under the words when the row is too narrow (a large text size). The format carries its own shape, so «16:9» reads as
  // something to tap; the white answer comes last, under the thumb and away from Play (the art director). The whole
  // sentence is read first by a screen reader; each answer's name holds its word (WCAG 2.5.3).
  const shape = fit.format ? ASPECTS[fit.format] : null;
  const k = shape ? 16 / Math.max(shape[0], shape[1]) : 0;
  return (
    <div className="ck ck-frame-fit" role="note">
      <span className="ck-sr">{fit.wider ? t('The video is wider than the frame: black bars above and below.') : t('The video is narrower than the frame: black bars at the sides.')}</span>
      <span className="ck-frame-fit-what" aria-hidden>{t('Black bars')}</span>
      <div className="ck-frame-fit-answers">
        {fit.format && shape && (
          <Button aria-label={t('Frame format {format}', { format: fit.format })} onClick={format}
            icon={<span className="ck-frame-fit-shape" style={{ width: `${shape[0] * k}px`, height: `${shape[1] * k}px` }} aria-hidden />}>
            {fit.format}
          </Button>
        )}
        <Button variant="primary" aria-label={t('Crop to fill the frame')} onClick={fill}>{t('Crop to fill')}</Button>
        <IconButton label={t('Close')} onClick={close}><X aria-hidden /></IconButton>
      </div>
    </div>
  );
}
