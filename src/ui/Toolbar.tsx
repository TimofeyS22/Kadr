import {
  Activity, ArrowRightToLine, AudioLines, Bell, Check, CopyCheck, EyeOff, Zap, ScanFace, Captions, CircleDashed, Copy, Crop, Film, Frame, Gauge, Layers, Mic, Move, Music, PersonStanding, Rewind, Scissors,
  SlidersHorizontal, Smile, Snowflake, Sparkles, Trash2, Type, Video, Volume2, WandSparkles, X,
  type LucideIcon,
} from 'lucide-react';
import { findClip } from '../core/timeline';
import { useEditor, type SheetId } from '../state/store';
import {
  addMedia, addText, autoReframe, deleteMulti, deleteSelected, detachSelectedAudio, duplicateMulti, duplicateSelected, freezeFrame, multiToPlayhead, reverseSelected,
  splitAtPlayhead, toggleCutout,
} from './actions';
import { t } from '../lib/i18n';

interface Tool { icon: LucideIcon; label: string; run: () => void; danger?: boolean; on?: boolean }

const sheet = (id: SheetId) => () => useEditor.getState().openSheet(id);

export function Toolbar() {
  const clip = useEditor((s) => (s.project && s.selection ? findClip(s.project, s.selection)?.clip ?? null : null));
  const kind = clip?.kind ?? null;
  const multi = useEditor((s) => s.multi);
  if (multi) {
    const off = !multi.length;
    return (
      <nav className="toolbar multi" aria-label={t('Tools')}>
        <button className="tool on" onClick={() => useEditor.getState().setMulti(null)} aria-label={t('Finish selecting')}>
          <Check size={22} /><span>{t('Done')}</span>
        </button>
        <span className="multi-count" role="status">{t('{n} selected', { n: multi.length })}</span>
        <button className="tool danger" disabled={off} onClick={deleteMulti}><Trash2 size={22} /><span>{t('Delete')}</span></button>
        <button className="tool" disabled={off} onClick={duplicateMulti}><Copy size={22} /><span>{t('Duplicate')}</span></button>
        <button className="tool" disabled={off} onClick={multiToPlayhead}><ArrowRightToLine size={22} /><span>{t('To playhead')}</span></button>
      </nav>
    );
  }
  const split: Tool = { icon: Scissors, label: t('Split'), run: splitAtPlayhead };
  const dup: Tool = { icon: Copy, label: t('Duplicate'), run: duplicateSelected };
  const del: Tool = { icon: Trash2, label: t('Delete'), run: deleteSelected, danger: true };
  const pick: Tool = { icon: CopyCheck, label: t('Select several'), run: () => { const s = useEditor.getState(); s.setMulti(s.selection ? [s.selection] : []); } };
  const look: Tool[] = [
    { icon: SlidersHorizontal, label: t('Adjust'), run: sheet('adjust') },
    { icon: Sparkles, label: t('Filters'), run: sheet('filters') },
    { icon: Move, label: t('Transform'), run: sheet('transform') },
  ];
  const crop: Tool = { icon: Crop, label: t('Crop'), run: sheet('crop') };
  const pauses: Tool = { icon: WandSparkles, label: t('Remove pauses'), run: sheet('pauses') };
  const mask: Tool = { icon: CircleDashed, label: t('Mask'), run: sheet('mask'), on: !!(clip && 'mask' in clip && clip.mask) };
  const fx: Tool = { icon: Zap, label: t('Effects'), run: sheet('effects'), on: !!(clip && 'effect' in clip && clip.effect) };
  const hide: Tool = { icon: EyeOff, label: t('Hide faces'), run: sheet('privacy'), on: !!(clip && 'privacy' in clip && clip.privacy && (clip.privacy.faces || clip.privacy.areas.length)) };
  const cutout: Tool = { icon: PersonStanding, label: t('Cutout'), run: () => void toggleCutout(), on: !!(clip && 'removeBg' in clip && clip.removeBg) };
  const sound: Tool[] = [
    { icon: Gauge, label: t('Speed'), run: sheet('speed') },
    { icon: Volume2, label: t('Volume'), run: sheet('volume') },
  ];

  let tools: Tool[];
  switch (kind) {
    case 'video': tools = [split, ...sound, pauses, crop, { icon: ScanFace, label: t('Auto reframe'), run: () => void autoReframe() }, ...look, fx, mask, hide, cutout, { icon: Snowflake, label: t('Freeze'), run: () => void freezeFrame() },
      { icon: Rewind, label: t('Reverse'), run: () => void reverseSelected(), on: !!(clip?.kind === 'video' && clip.reversedFrom) },
      { icon: AudioLines, label: t('Extract audio'), run: detachSelectedAudio }, pick, dup, del]; break;
    case 'image': tools = [split, crop, ...look, fx, mask, hide, cutout, pick, dup, del]; break;
    case 'audio': tools = [split, ...sound, { icon: Activity, label: t('Beat'), run: sheet('beats'), on: !!clip && clip.kind === 'audio' && !!useEditor.getState().project?.assets[clip.assetId]?.beats }, pauses, pick, dup, del]; break;
    case 'text': tools = [{ icon: Type, label: t('Edit text'), run: sheet('text') }, look[2], split, pick, dup, del]; break;
    case 'caption': tools = [{ icon: Captions, label: t('Edit captions'), run: sheet('captionEdit') }, look[2], split, pick, del]; break;
    default: tools = [
      { icon: Film, label: t('Media'), run: () => void addMedia('main') },
      { icon: Layers, label: t('Overlay'), run: () => void addMedia('overlay') },
      { icon: Music, label: t('Audio'), run: () => void addMedia('audio') },
      { icon: Video, label: t('Camera'), run: sheet('camera') },
      { icon: Mic, label: t('Record'), run: sheet('voiceover') },
      { icon: Type, label: t('Text'), run: addText },
      { icon: Captions, label: t('Captions'), run: sheet('captions') },
      { icon: Smile, label: t('Stickers'), run: sheet('stickers') },
      { icon: Bell, label: t('Sounds'), run: sheet('sfx') },
      { icon: Frame, label: t('Canvas'), run: sheet('canvas') },
    ];
  }

  return (
    <nav className="toolbar" aria-label={t('Tools')}>
      {kind && (
        <button className="tool" onClick={() => useEditor.getState().select(null)} aria-label={t('Close tools')}>
          <X size={22} /><span>{t('Back')}</span>
        </button>
      )}
      {tools.map((t) => (
        <button key={t.label} className={`tool ${t.danger ? 'danger' : ''} ${t.on ? 'on' : ''}`} aria-pressed={t.on} onClick={t.run}>
          <t.icon size={22} /><span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
