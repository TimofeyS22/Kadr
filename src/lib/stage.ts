// The candidate build at /Kadr/next/ (V-234, V-249): the owner checks a release on the iPhone there before it goes
// live. Same origin as the live site, so the same IndexedDB, OPFS, Cache Storage, localStorage, channels and locks —
// without names of its own, a candidate's schema migration would run on the owner's real projects. Built with
// VITE_STAGE=next, every name in the browser's storage is this stage's own; the live site's names stay as they are.

/** '' on the live site, 'next' on the candidate. */
export const STAGE: string = import.meta.env.VITE_STAGE === 'next' ? 'next' : '';

/** A name in the browser's storage, of this stage: the live site's as it is, the candidate's prefixed. */
export const own = (name: string): string => (STAGE ? `${STAGE}:${name}` : name);

/** The commit the build was made from, shown in the candidate's footer. */
export const BUILD_SHA: string = import.meta.env.VITE_BUILD_SHA ?? '';
