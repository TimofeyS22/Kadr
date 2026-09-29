import { uid } from '../core/defaults';
import type { Asset } from '../core/types';
import { putBlob } from '../storage/db';
import { MediaError, probe } from './media';

export const MAX_FILE_BYTES = 4 * 1024 ** 3;

/** Opens the system file picker. Must be called from a user gesture. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

export async function importFile(file: File | Blob, name = (file as File).name ?? 'media'): Promise<Asset> {
  if (file.size > MAX_FILE_BYTES) throw new MediaError(`${name} is larger than 4 GB`);
  const info = await probe(file);
  const asset: Asset = { id: uid(), name, mime: file.type, size: file.size, ...info };
  await putBlob(asset.id, file);
  return asset;
}

/** Imports files one by one; failures are reported per file instead of aborting the batch. */
export async function importFiles(files: File[], onError: (name: string, e: unknown) => void): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const f of files) {
    try {
      out.push(await importFile(f));
    } catch (e) {
      onError(f.name, e);
    }
  }
  return out;
}
