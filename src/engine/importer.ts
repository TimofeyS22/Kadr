import { uid } from '../core/defaults';
import type { Asset } from '../core/types';
import { putBlob } from '../storage/db';
import { MediaError, probe } from './media';

export const MAX_FILE_BYTES = 4 * 1024 ** 3;

/** Opens the system file picker. Must be called from a user gesture. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    // Attached to the document: iOS Safari does not reliably fire `change` on detached file inputs.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(input);
    const done = (files: File[]) => { input.remove(); resolve(files); };
    input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    input.click();
  });
}

export async function importFile(file: File | Blob, name = (file as File).name ?? 'media'): Promise<Asset> {
  if (file.size > MAX_FILE_BYTES) throw new MediaError('{name} is larger than 4 GB', { name });
  if (isImage(file, name)) file = await toDecodableImage(file);
  const info = await probe(file);
  const asset: Asset = { id: uid(), name, mime: file.type, size: file.size, ...info };
  await putBlob(asset.id, file);
  return asset;
}

/** Imports files one by one; failures are reported per file instead of aborting the batch. */
export async function importFiles(files: File[], onError: (name: string, e: unknown) => void, onProgress?: (done: number, total: number) => void): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const [i, f] of files.entries()) {
    onProgress?.(i, files.length);
    try {
      out.push(await importFile(f));
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
