// A stored file opened with Mediabunny, whichever way the storage keeps it (audit V-253).
import type { Input } from 'mediabunny';
import { loadMediabunny } from './mediabunny';
import type { StoredMedia } from '../storage/chunks';

/**
 * A Blob is read in slices from the disk. A file kept in chunks (a private tab) is asked for the byte ranges the demuxer
 * wants, with the reading pattern of a file: a little around each read, as `BlobSource` does. Dispose the input when
 * done; the reader itself holds nothing. The library and its readers load with the first file opened (audit V-143).
 */
export async function openInput(media: StoredMedia): Promise<Input> {
  const { BlobSource, CustomSource, Input, READABLE } = await loadMediabunny();
  return new Input({
    formats: READABLE,
    source: media instanceof Blob
      ? new BlobSource(media)
      : new CustomSource({ getSize: () => media.size, read: (start, end) => media.read(start, end), prefetchProfile: 'fileSystem' }),
  });
}
