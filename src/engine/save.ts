// Handing a finished file to the person. Apart from exporter.ts: subtitles and backups are saved without any muxing code.

/** What became of a file offered to the person. */
export type Offered = 'saved' | 'declined' | 'refused';

/**
 * Offers the file from a tap: the share sheet on phones (save to Photos/Files), a download elsewhere. 'declined': the
 * person closed the sheet. 'refused': the browser turned the sheet down without showing it — on an iPhone the first
 * tap on «Save» after an export did nothing and only the second worked (audit V-138). A download there shows nothing
 * either, and the file looked saved, so «Done» let it go without a word: now it stays to be offered on the next tap.
 */
export async function offerFile(blob: Blob, fileName: string): Promise<Offered> {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'saved';
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === 'AbortError') return 'declined';
      if (name === 'NotAllowedError') { console.warn('The share sheet was refused without being shown', e); return 'refused'; }
      // Any other refusal (a file this sheet does not take): the browser's own download.
    }
  }
  downloadFile(blob, fileName);
  return 'saved';
}

/** Offers the file; false when it was not saved (the sheet was closed or refused). */
export async function saveFile(blob: Blob, fileName: string): Promise<boolean> {
  return (await offerFile(blob, fileName)) === 'saved';
}

/** Saves through the browser's downloads, with no share sheet (needs no fresh tap, so it works when an export finishes). */
export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
