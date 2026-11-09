// A stored file opened with Mediabunny, whichever way the storage keeps it (audit V-253).
import { BlobSource, CustomSource, Input } from 'mediabunny';
import { READABLE } from './formats';
import type { StoredMedia } from '../storage/chunks';

/**
 * A Blob is read in slices from the disk. A file kept in chunks (a private tab) is asked for the byte ranges the demuxer
 * wants, with the reading pattern of a file: a little around each read, as `BlobSource` does. Dispose the input when
 * done; the reader itself holds nothing.
 */
export const openInput = (media: StoredMedia): Input => new Input({
  formats: READABLE,
  source: media instanceof Blob
    ? new BlobSource(media)
    : new CustomSource({ getSize: () => media.size, read: (start, end) => media.read(start, end), prefetchProfile: 'fileSystem' }),
});
