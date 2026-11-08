// Handing a finished file to the person. Apart from exporter.ts: subtitles and backups are saved without any muxing code.

/** Opens the share sheet on phones (save to Photos/Files) or downloads on desktop. Call from a user gesture. */
/** Offers the file to the person; false when they turned the share sheet down. */
export async function saveFile(blob: Blob, fileName: string): Promise<boolean> {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  downloadFile(blob, fileName);
  return true;
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
