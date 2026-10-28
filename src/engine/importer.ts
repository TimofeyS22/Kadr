import { uid } from '../core/defaults';
import { SNIFF_BYTES, sniffMime } from '../core/sniff';
import type { Asset } from '../core/types';
import { within } from '../lib/limits';
import { putBlob, requestPersistence } from '../storage/db';
import { MediaError, probe } from './media';

export const MAX_FILE_BYTES = 4 * 1024 ** 3;

export { pickFiles } from '../lib/pickFiles';

/** `onSoundLost`: the video is added, but its sound does not decode in this browser (the reason is given). */
export async function importFile(file: File | Blob, name = (file as File).name ?? 'media', onSoundLost?: (reason: string) => void): Promise<Asset> {
  if (file.size > MAX_FILE_BYTES) throw new MediaError('{name} is larger than 4 GB', { name });
  // The first bytes decide when they are known: a photo without an extension, a video renamed to .jpg.
  const sniffed = sniffMime(new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer()));
  const image = sniffed ? sniffed.startsWith('image/') : isImage(file, name);
  // The stored type is what later decoding goes by (thumbnails, frames), so it must agree.
  if (sniffed && image !== file.type.startsWith('image/')) file = new Blob([file], { type: sniffed });
  if (image) file = await toDecodableImage(file);
  const { soundError, ...info } = await probe(file);
  if (soundError) onSoundLost?.(soundError);
  const asset: Asset = { id: uid(), name, mime: file.type, size: file.size, ...info };
  await ensureRoom(file.size, name);
  await putBlob(asset.id, file);
  persistOnce();
  return asset;
}

/** Room kept free beyond the file itself: the project, thumbnails and the browser's own bookkeeping. */
const ROOM_MARGIN = 64 * 2 ** 20;

/**
 * Says before writing when the file will not fit (docs/12 stage 3): a full disk otherwise fails halfway, after the
 * person waited. Where the browser does not say how much room there is, the write itself is the check.
 */
export async function ensureRoom(bytes: number, name: string): Promise<void> {
  const est = await within(navigator.storage?.estimate?.() ?? Promise.resolve(undefined), 2000, () => undefined).catch(() => undefined);
  const free = est?.quota ? est.quota - (est.usage ?? 0) : Infinity;
  if (free < bytes + ROOM_MARGIN) {
    throw new MediaError('Not enough storage on this device for “{name}” ({mb} MB). Delete old projects or free up space, then try again.', { name, mb: Math.ceil(bytes / 1e6) });
  }
}

let persisted = false;
/** Media are in: the browser is asked again to keep this site's data (it may say yes now that the site is used). */
function persistOnce(): void {
  if (persisted) return;
  persisted = true;
  void requestPersistence();
}

/** Imports files one by one; failures are reported per file instead of aborting the batch. */
export async function importFiles(
  files: File[], onError: (name: string, e: unknown) => void, onProgress?: (done: number, total: number) => void,
  onSoundLost?: (name: string, reason: string) => void,
): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const [i, f] of files.entries()) {
    onProgress?.(i, files.length);
    try {
      out.push(await importFile(f, f.name, (reason) => onSoundLost?.(f.name, reason)));
    } catch (e) {
      onError(f.name, e);
    }
  }
  return out;
}

const isImage = (f: Blob, name: string) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|gif)$/i.test(name);

/**
 * Photos the canvas pipeline can't decode directly (e.g. HEIC from iPhone on some browsers) are converted to
 * JPEG through an <img> element, which Safari decodes natively.
 */
async function toDecodableImage(file: Blob): Promise<Blob> {
  try {
    (await createImageBitmap(file)).close();
    return file.type ? file : new Blob([file], { type: 'image/jpeg' });
  } catch { /* fall through to <img> */ }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new MediaError('This image format is not supported'))), 'image/jpeg', 0.92));
  } catch {
    throw new MediaError('This image format is not supported');
  } finally {
    URL.revokeObjectURL(url);
  }
}
