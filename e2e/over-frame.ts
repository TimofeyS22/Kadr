// What lies over the frame of the preview and is not in the file, for tests that set a picture of the preview against
// the export: one list, so a new layer over the frame is hidden everywhere at once. Toasts and first-run tips; the note
// about black bars after the first video (UI-4) stays on the list for a shot taken before it is answered.
import { expect, type Page } from '@playwright/test';

const OVER_FRAME = '.toast, .ck-apptoasts, .ck-coach, .ck-frame-fit';

/** The `style` of a screenshot of the preview: what lies over the frame is hidden; `also` adds a test's own (`.sel-box`). */
export const hideOverFrame = (also = ''): string => `${OVER_FRAME}${also ? `, ${also}` : ''} { visibility: hidden !important; }`;

/**
 * The note about black bars (UI-4) stands in the flow between the frame and the row under it, and the frame is smaller
 * while it is up (SW-U-8): hidden for a shot, it kept its room, and the preview set against the file was a 120 px frame
 * (SW-U-10). A test that compares the preview with the export answers it first, as a person does — Close, which changes
 * nothing in the project — and waits until the frame has taken its room back.
 */
export async function closeFrameFit(page: Page): Promise<void> {
  const note = page.locator('.ck-frame-fit');
  if (!(await note.isVisible())) return;
  await note.locator('.ck-ib').click();
  await expect(note).toHaveCount(0);
  const canvas = page.locator('.preview-canvas');
  let size = '';
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(150);
    const now = await canvas.evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`);
    if (now === size) break;
    size = now;
  }
}
