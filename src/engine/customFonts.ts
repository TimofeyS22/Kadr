// Fonts the user adds (docs/05 M3): the file lives in local storage and is registered with the FontFace API,
// so canvas text (preview and export) can use it. One face covers weights 100–900, so bold is never faked.
import type { Project } from '../core/types';
import { getBlob } from '../storage/db';
import { MediaError } from './media';
import { customFamily } from './text';

export const MAX_FONT_BYTES = 15 * 1024 * 1024;
const registered = new Map<string, Promise<void>>();

export function registerFont(id: string, blobId: string): Promise<void> {
  let p = registered.get(id);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(blobId);
      if (!blob) throw new MediaError('The font file is missing from this device');
      const face = new FontFace(customFamily(id), await blob.arrayBuffer(), { weight: '100 900' });
      await face.load();
      document.fonts.add(face);
    })();
    p.catch(() => registered.delete(id));
    registered.set(id, p);
  }
  return p;
}

export const registerProjectFonts = (p: Project): Promise<unknown> =>
  Promise.all(Object.entries(p.fonts ?? {}).map(([id, f]) => registerFont(id, f.blobId).catch(() => undefined)));

/** Throws a clear error unless the file is a font the browser can use. */
export async function validateFont(file: Blob): Promise<void> {
  if (file.size > MAX_FONT_BYTES) throw new MediaError('This font file is too large (over 15 MB)');
  try {
    await new FontFace('Kadr font check', await file.arrayBuffer()).load();
  } catch {
    throw new MediaError('This file is not a font (TTF, OTF, WOFF or WOFF2)');
  }
}
