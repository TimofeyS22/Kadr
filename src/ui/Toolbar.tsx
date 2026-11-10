import {
  Activity, ArrowRightToLine, TrianglesCenterlineDashedVertical, Pipette, AudioLines, Bell, Check, Clapperboard, CopyCheck, Disc3, EyeOff, Zap, ScanFace, Captions, CircleDashed, Copy, Crop, Film, Frame, Gauge, Layers, Layers3, Mic, Move, Music, PersonStanding, Rewind, Scissors,
  LayoutGrid, SlidersHorizontal, Smile, Snowflake, Sparkles, Trash2, Type, Video, Volume2, WandSparkles, X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { findClip } from '../core/timeline';
import { useEditor, type SheetId } from '../state/store';
import {
  addMedia, addText, autoReframe, deleteMulti, deleteSelected, detachSelectedAudio, duplicateMulti, duplicateSelected, freezeFrame, multiToPlayhead, reverseSelected,
  splitAtPlayhead, startCaptions, toggleCutout, toggleFlip,
} from './actions';
import { t } from '../lib/i18n';
// Chetko, stage Ч4 release 3 (docs/17): the ribbon of the system. The order, the names and the groups are those of 1.7.1;
// `toolbar`, `tool` and `tool-back` stay as hooks for the tests and the iPhone scripts.
import { Ribbon, Tool as ToolButton } from './ck/controls';
import { Sheet } from './ck/Sheet';

/** `on`: the tool has changed the piece (said as «изменено»). `pressed`: the tool is itself a switch, one tap turns it on and off. */
interface Tool { icon: LucideIcon; label: string; run: () => void; danger?: boolean; on?: boolean; pressed?: boolean }

const button = (x: Tool, run = x.run, hook: string | undefined = 'tool') => (
  <ToolButton key={x.label} hook={hook} icon={<x.icon aria-hidden />} label={x.label} danger={x.danger} on={x.on} onNote={t('changed')} pressed={x.pressed} onClick={run} />
);

const sheet = (id: SheetId) => () => useEditor.getState().openSheet(id);

export function Toolbar() {
  const [all, setAll] = useState(false);
  const clip = useEditor((s) => (s.project && s.selection ? findClip(s.project, s.selection)?.clip ?? null : null));
  const kind = clip?.kind ?? null;
  const multi = useEditor((s) => s.multi);
  const project = useEditor((s) => s.project);
  if (multi) {
    const live = project ? multi.filter((id) => findClip(project, id)) : []; // undo may have removed some
    const off = !live.length;
    return (
      <Ribbon label={t('Tools')} hook="toolbar multi"
        start={<ToolButton hook="tool" icon={<Check aria-hidden />} label={t('Done')} aria-label={t('Done: finish selecting')} onClick={() => useEditor.getState().setMulti(null)} />}>
        <span className="ck-editor-count" role="status">{t('{n} selected', { n: live.length })}</span>
        <div className="ck-ribbon-group">
          <ToolButton hook="tool" icon={<Trash2 aria-hidden />} label={t('Delete')} danger disabled={off} onClick={deleteMulti} />
          <ToolButton hook="tool" icon={<Copy aria-hidden />} label={t('Duplicate')} disabled={off} onClick={duplicateMulti} />
          <ToolButton hook="tool" icon={<ArrowRightToLine aria-hidden />} label={t('To playhead')} disabled={off} onClick={multiToPlayhead} />
        </div>
      </Ribbon>
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
  // Layers (v1.6) for clips over the main video: what is drawn over what.
  const onTop = !!(clip && project && findClip(project, clip.id)?.track.kind === 'overlay');
  const layers: Tool[] = onTop ? [{ icon: Layers3, label: t('Layers'), run: sheet('layers') }] : [];
  const pauses: Tool = { icon: WandSparkles, label: t('Remove pauses'), run: sheet('pauses') };
  const mask: Tool = { icon: CircleDashed, label: t('Mask'), run: sheet('mask'), on: !!(clip && 'mask' in clip && clip.mask) };
  const fx: Tool = { icon: Zap, label: t('Effects'), run: sheet('effects'), on: !!(clip && 'effect' in clip && clip.effect) };
  const hide: Tool = { icon: EyeOff, label: t('Hide faces'), run: sheet('privacy'), on: !!(clip && 'privacy' in clip && clip.privacy && (clip.privacy.faces || clip.privacy.areas.length)) };
  const cutout: Tool = { icon: PersonStanding, label: t('Cutout'), run: () => void toggleCutout(), pressed: !!(clip && 'removeBg' in clip && clip.removeBg) };
  const mirror: Tool = { icon: TrianglesCenterlineDashedVertical, label: t('Mirror'), run: () => toggleFlip('x'), pressed: !!(clip && 'flipX' in clip && clip.flipX) };
  // Next to Cutout, where people look for it (it used to sit at the bottom of Transform, docs/09 Q3).
  const chroma: Tool = { icon: Pipette, label: t('Chroma key'), run: sheet('chroma'), on: !!(clip && 'chroma' in clip && clip.chroma.enabled) };
  // One tap: captions for the whole timeline, every video (v1.3); existing captions open for editing.
  const captions: Tool = { icon: Captions, label: t('Captions'), run: startCaptions };
  const sound: Tool[] = [
    { icon: Gauge, label: t('Speed'), run: sheet('speed') },
    { icon: Volume2, label: t('Volume'), run: sheet('volume') },
    { icon: AudioLines, label: t('Voice'), run: sheet('voice'), on: !!(clip && 'voice' in clip && clip.voice) },
  ];

  const autoReframeTool: Tool = { icon: ScanFace, label: t('Auto reframe'), run: () => void autoReframe() };
  const freeze: Tool = { icon: Snowflake, label: t('Freeze'), run: () => void freezeFrame() };
  const reverse: Tool = { icon: Rewind, label: t('Reverse'), run: () => void reverseSelected(), on: !!(clip?.kind === 'video' && clip.reversedFrom) };
  const extract: Tool = { icon: AudioLines, label: t('Extract audio'), run: detachSelectedAudio };
  const beat: Tool = { icon: Activity, label: t('Beat'), run: sheet('beats'), on: !!clip && clip.kind === 'audio' && !!useEditor.getState().project?.assets[clip.assetId]?.beats };
  const [adjust, filters, transform] = look;

  // In groups, what is used most first: the first screen of a phone holds five tools (audit V-165).
  let groups: Tool[][];
  switch (kind) {
    case 'video': groups = [[split, dup, del], [...sound, captions, pauses], [crop, mirror, transform, ...layers, adjust, filters, fx], [mask, hide, cutout, chroma, autoReframeTool], [freeze, reverse, extract, pick]]; break;
    case 'image': groups = [[split, dup, del], [crop, mirror, transform, ...layers, adjust, filters, fx], [mask, hide, cutout, chroma, pick]]; break;
    case 'audio': groups = [[split, dup, del], [...sound, beat, captions, pauses, pick]]; break;
    case 'text': groups = [[{ icon: Type, label: t('Edit text'), run: sheet('text') }, transform, ...layers], [split, dup, del, pick]]; break;
    case 'caption': groups = [[{ icon: Captions, label: t('Edit captions'), run: sheet('captionEdit') }, transform, ...layers], [split, del, pick]]; break;
    default: groups = [
      [
        { icon: Clapperboard, label: t('Reel in 1 tap'), run: sheet('reel') },
        { icon: Film, label: t('Media'), run: () => void addMedia('main') },
        captions,
        { icon: Type, label: t('Text'), run: addText },
        { icon: Disc3, label: t('Music'), run: sheet('music') },
      ],
      [
        { icon: Layers, label: t('Overlay'), run: () => void addMedia('overlay') },
        { icon: Smile, label: t('Stickers'), run: sheet('stickers') },
        { icon: Bell, label: t('Sounds'), run: sheet('sfx') },
        { icon: Music, label: t('Audio'), run: () => void addMedia('audio') },
      ],
      [
        { icon: Video, label: t('Camera'), run: sheet('camera') },
        { icon: Mic, label: t('Record'), run: sheet('voiceover') },
        { icon: Frame, label: t('Canvas'), run: sheet('canvas') },
      ],
    ];
  }

  // «Все»: the whole panel with names, a sheet away (audit UI-5: 23 tools in one row, four of them in sight). A tool
  // runs in the same tap that chose it, so a file picker it opens still counts as the person's own act.
  const fromAll = (x: Tool) => () => { setAll(false); x.run(); };
  return (
    <>
      <Ribbon label={t('Tools')} hook="toolbar"
        start={kind ? <ToolButton hook="tool tool-back" icon={<X aria-hidden />} label={t('Back')} aria-label={t('Back: close tools')} onClick={() => useEditor.getState().select(null)} /> : undefined}
        end={<ToolButton icon={<LayoutGrid aria-hidden />} label={t('All')} aria-label={t('All tools')} aria-haspopup="dialog" onClick={() => setAll(true)} />}>
        {groups.map((group, i) => <div className="ck-ribbon-group" key={i}>{group.map((x) => button(x))}</div>)}
      </Ribbon>
      <Sheet open={all} title={t('All tools')} closeLabel={t('Close')} closeIcon={<X aria-hidden />} onClose={() => setAll(false)}>
        {/* Built only while open: a closed copy of every tool would answer to the same names as the ribbon. */}
        {all && (
          <div className="ck-editor-all">
            {groups.map((group, i) => <div className="ck-toolgrid" key={i}>{group.map((x) => button(x, fromAll(x), undefined))}</div>)}
          </div>
        )}
      </Sheet>
    </>
  );
}
