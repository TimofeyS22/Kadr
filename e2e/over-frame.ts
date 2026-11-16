// What lies over the frame of the preview and is not in the file, for tests that set a picture of the preview against
// the export: one list, so a new layer over the frame is hidden everywhere at once. Toasts, first-run tips, and the note
// about black bars after the first video (UI-4), which stands on the bottom bar it speaks of.
const OVER_FRAME = '.toast, .ck-apptoasts, .ck-coach, .ck-frame-fit';

/** The `style` of a screenshot of the preview: what lies over the frame is hidden; `also` adds a test's own (`.sel-box`). */
export const hideOverFrame = (also = ''): string => `${OVER_FRAME}${also ? `, ${also}` : ''} { visibility: hidden !important; }`;
