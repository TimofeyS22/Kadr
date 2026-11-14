// Mediabunny, the media library: about 100 KB of gzip, two fifths of the editor's first load. The editor is shown without
// it (audit V-143, CLAUDE.md §5: 250 KB before the editor answers); it comes when a file is first opened, or right after
// the editor is shown (Editor.tsx), whichever is first. Every class of it is taken from here, after an await; the parts
// are named in mediabunnyParts.ts.
type Mediabunny = typeof import('./mediabunnyParts');

let loading: Promise<Mediabunny> | undefined;

/** The library, loaded once. A load that failed (offline, a deploy replaced the site) is tried again when asked again. */
export function loadMediabunny(): Promise<Mediabunny> {
  loading ??= import('./mediabunnyParts').catch((e: unknown) => { loading = undefined; throw e; });
  return loading;
}
