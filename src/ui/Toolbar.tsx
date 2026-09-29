import {
  Activity, AudioLines, Bell, ScanFace, Captions, CircleDashed, Copy, Crop, Film, Frame, Gauge, Layers, Mic, Move, Music, PersonStanding, Rewind, Scissors,
  SlidersHorizontal, Smile, Snowflake, Sparkles, Trash2, Type, Volume2, WandSparkles, X,
  type LucideIcon,
} from 'lucide-react';
import { findClip } from '../core/timeline';
import { useEditor, type SheetId } from '../state/store';
import {
  addMedia, addText, autoReframe, deleteSelected, detachSelectedAudio, duplicateSelected, freezeFrame, reverseSelected, splitAtPlayhead, toggleCutout,
} from './actions';
import { t } from './i18n';

interface Tool { icon: LucideIcon; label: string; run: () => void; danger?: boolean; on?: boolean }

const sheet = (id: SheetId) => () => useEditor.getState().openSheet(id);

export function Toolbar() {
  const clip = useEditor((s) => (s.project && s.selection ? findClip(s.project, s.selection)?.clip ?? null : null));
  const kind = clip?.kind ?? null;
  const split: Tool = { icon: Scissors, label: t('Split'), run: splitAtPlayhead };
  const dup: Tool = { icon: Copy, label: t('Duplicate'), run: duplicateSelected };
  const del: Tool = { icon: Trash2, label: t('Delete'), run: deleteSelected, danger: true };
  const look: Tool[] = [
    { icon: SlidersHorizontal, label: t('Adjust'), run: sheet('adjust') },
    { icon: Sparkles, label: t('Filters'), run: sheet('filters') },
    { icon: Move, label: t('Transform'), run: sheet('transform') },
  ];
  const crop: Tool = { icon: Crop, label: t('Crop'), run: sheet('crop') };
  const pauses: Tool = { icon: WandSparkles, label: t('Remove pauses'), run: sheet('pauses') };
  const mask: Tool = { icon: CircleDashed, label: t('Mask'), run: sheet('mask'), on: !!(clip && 'mask' in clip && clip.mask) };
  const cutout: Tool = { icon: PersonStanding, label: t('Cutout'), run: () => void toggleCutout(), on: !!(clip && 'removeBg' in clip && clip.removeBg) };
  const sound: Tool[] = [
    { icon: Gauge, label: t('Speed'), run: sheet('speed') },
    { icon: Volume2, label: t('Volume'), run: sheet('volume') },
  ];

  let tools: Tool[];
  switch (kind) {
    case 'video': tools = [split, ...sound, pauses, crop, { icon: ScanFace, label: t('Auto reframe'), run: () => void autoReframe() }, ...look, mask, cutout, { icon: Snowflake, label: t('Freeze'), run: () => void freezeFrame() },
      { icon: Rewind, label: t('Reverse'), run: () => void reverseSelected(), on: !!(clip?.kind === 'video' && clip.reversedFrom) },
      { icon: AudioLines, label: t('Extract audio'), run: detachSelectedAudio }, dup, del]; break;
    case 'image': tools = [split, crop, ...look, mask, cutout, dup, del]; break;
    case 'audio': tools = [split, ...sound, { icon: Activity, label: t('Beat'), run: sheet('beats'), on: !!clip && clip.kind === 'audio' && !!useEditor.getState().project?.assets[clip.assetId]?.beats }, pauses, dup, del]; break;
    case 'text': tools = [{ icon: Type, label: t('Edit text'), run: sheet('text') }, look[2], split, dup, del]; break;
    case 'caption': tools = [{ icon: Captions, label: t('Edit captions'), run: sheet('captionEdit') }, look[2], split, del]; break;
    default: tools = [
      { icon: Film, label: t('Media'), run: () => void addMedia('main') },
      { icon: Layers, label: t('Overlay'), run: () => void addMedia('overlay') },
      { icon: Music, label: t('Audio'), run: () => void addMedia('audio') },
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
