// Tasks people come for (docs/08 C): deep links #/start/<task> from the task pages, the home "Reel in 1 tap" card
// and the Android share target all go through here — media in, a vertical project out, the right tool open.
import { produce } from 'immer';
import { createAudioClip, createImageClip, createProject, createVideoClip } from '../core/defaults';
import { insertMain, mainTrack, placeClip } from '../core/timeline';
import type { Asset, Project } from '../core/types';
import { t } from '../lib/i18n';
import { track } from '../lib/telemetry';
import { editor, useEditor, type SheetId } from '../state/store';
import { saveProject } from '../storage/db';

export const TASK_IDS = ['reel', 'captions', 'pauses', 'speed', 'music', 'background', 'teleprompter', 'denoise', 'trim', 'gif'] as const;
export type TaskId = typeof TASK_IDS[number];

interface TaskSpec {
  /** Banner title on the home screen (translation key). */
  title: string;
  /** Media to pick first; null = starts with an empty project. */
  accept: string | null;
  /** What opens once the project is ready. `clip`: the first main clip gets selected first (clip tools). */
  sheet?: SheetId; clip?: boolean; auto?: boolean;
  /** A hint for tools that live on the clip itself (trim handles, background removal). */
  hint?: string;
}

export const TASKS: Record<TaskId, TaskSpec> = {
  reel: { title: 'Turn a talking video into a reel', accept: 'video/*', sheet: 'reel', auto: true },
  captions: { title: 'Add captions to a video', accept: 'video/*,audio/*', sheet: 'captions', auto: true },
  pauses: { title: 'Remove pauses from a video', accept: 'video/*,audio/*', sheet: 'pauses', clip: true },
  speed: { title: 'Speed up a video', accept: 'video/*', sheet: 'speed', clip: true },
  music: { title: 'Add music to a video', accept: 'video/*,image/*', sheet: 'music' },
  background: { title: 'Remove the background from a video', accept: 'video/*,image/*', clip: true, hint: 'Tap “Cutout” in the tools below: the person stays, the background goes.' },
  teleprompter: { title: 'Record with a teleprompter', accept: null, sheet: 'camera' },
  denoise: { title: 'Remove background noise', accept: 'video/*,audio/*', sheet: 'volume', clip: true },
  trim: { title: 'Trim a video', accept: 'video/*', clip: true, hint: 'Drag the white handles at the clip’s edges to trim it.' },
  gif: { title: 'Turn a video into a GIF', accept: 'video/*', sheet: 'export', hint: 'Choose “GIF” and save.' },
};

export const isTask = (s: string | undefined): s is TaskId => !!s && (TASK_IDS as readonly string[]).includes(s);

/** A new vertical project with the files on the timeline: pictures on the main track in order, sound below. */
export function projectFromAssets(name: string, assets: Asset[]): Project {
  const p = createProject(name, '9:16');
  p.assets = Object.fromEntries(assets.map((a) => [a.id, a]));
  return produce(p, (d) => {
    for (const a of assets) {
      if (a.kind === 'audio') { if (a.hasAudio) placeClip(d, createAudioClip(a, 0)); continue; }
      insertMain(d, a.kind === 'image' ? createImageClip(a) : createVideoClip(a), Infinity);
    }
  });
}

/** Saves the project and opens it with the task's tool waiting (the editor runs `runStartTask` once it loads). */
export async function openWithTask(p: Project, task: TaskId | null): Promise<void> {
  await saveProject(p);
  useEditor.setState({ startTask: task });
  location.hash = `#/p/${p.id}`;
}

/** Called by the editor right after a project opened from a task. */
export function runStartTask(task: TaskId): void {
  const spec = TASKS[task];
  const s = editor();
  if (spec.clip) {
    const first = s.project && mainTrack(s.project).clips[0];
    if (first) s.select(first.id);
  }
  if (spec.sheet) {
    useEditor.setState({ startAuto: !!spec.auto });
    s.openSheet(spec.sheet);
  }
  if (spec.hint) s.toast(t(spec.hint), 'info', 6000);
  track('task_opened', { task });
}
