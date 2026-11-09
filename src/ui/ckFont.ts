// Geologica, the face of the Chetko system (DESIGN.md §3): one variable file per alphabet carries every weight and the
// sharpness axis (SHRP) the "focus pull" of a value is built on. 19 KB (Cyrillic) + 29 KB (Latin). Each file downloads
// when the first letter of its alphabet is drawn, like the faces of fonts.ts. OFL-1.1, listed on the licences page.
import cyrillic from '@fontsource-variable/geologica/files/geologica-cyrillic-shrp-normal.woff2?url';
import latin from '@fontsource-variable/geologica/files/geologica-latin-shrp-normal.woff2?url';

const FACES: [string, string][] = [
  [cyrillic, 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'],
  [latin, 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
];
for (const [url, unicodeRange] of FACES) {
  document.fonts.add(new FontFace('Geologica', `url(${url}) format('woff2')`, { style: 'normal', weight: '100 900', display: 'swap', unicodeRange }));
}
