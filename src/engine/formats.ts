import { ADTS, FLAC, MATROSKA, MP3, MP4, MPEG_TS, OGG, QTFF, WAVE, WEBM } from 'mediabunny';

/**
 * The containers Kadr reads: everything Mediabunny does but HLS, a playlist of network segments that a local file cannot
 * be. Named one by one because `ALL_FORMATS` brings 30 KB of its parser into the editor's first load (audit V-143).
 */
export const READABLE = [MP4, QTFF, MATROSKA, WEBM, WAVE, OGG, FLAC, MP3, ADTS, MPEG_TS];
