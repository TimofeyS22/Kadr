// The tasks a link can start with (the task pages, the share target). Apart from ui/tasks.ts so the store needs no UI.
export const TASK_IDS = ['reel', 'captions', 'pauses', 'speed', 'music', 'background', 'teleprompter', 'denoise', 'trim', 'gif'] as const;
export type TaskId = typeof TASK_IDS[number];
