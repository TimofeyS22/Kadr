// Built-in music library (docs/05 M1): public-domain tracks by mood, one-tap preview, add under the video.
import { Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MOODS, type LibraryTrack, type Mood, type MusicManifest } from '../core/music';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/telemetry';
import { addLibraryTrack, musicUrl } from './actions';
import { Chips } from './controls';
import { formatTime } from './format';

const MOOD_LABEL: Record<Mood | 'all', string> = {
  all: 'All', lofi: 'Lo-fi', energetic: 'Energetic', phonk: 'Phonk', cinematic: 'Cinematic',
  calm: 'Calm', happy: 'Happy', game: 'Game', electronic: 'Electronic',
};

let manifest: Promise<MusicManifest> | null = null;
function loadManifest(): Promise<MusicManifest> {
  manifest ??= fetch(musicUrl('music.json')).then((r) => {
    if (!r.ok) throw new Error('The music library is not available right now');
    return r.json() as Promise<MusicManifest>;
  });
  manifest.catch(() => { manifest = null; });
  return manifest;
}

export function MusicBody() {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [error, setError] = useState('');
  const [mood, setMood] = useState<Mood | 'all'>('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadManifest().then((m) => setTracks(m.tracks), (e) => setError(errorMessage(e)));
    return () => { audio.current?.pause(); audio.current = null; };
  }, []);

  const stop = () => { audio.current?.pause(); audio.current = null; setPlaying(null); };
  const preview = (tr: LibraryTrack) => {
    if (playing === tr.id) { stop(); return; }
    stop();
    player.pause();
    const a = new Audio(musicUrl(tr.file));
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(tr.id);
  };

  if (error) return <p className="hint">{error}</p>;
  if (!tracks) return <p className="hint">{t('Loading…')}</p>;
  const list = mood === 'all' ? tracks : tracks.filter((x) => x.mood === mood);
  return (
    <>
      <Chips options={['all', ...MOODS] as const} value={mood} scroll label={t('Mood')} render={(m) => t(MOOD_LABEL[m])} onChange={setMood} />
      <ul className="music-list">
        {list.map((tr) => (
          <li key={tr.id} className={`music-row ${playing === tr.id ? 'on' : ''}`}>
            <button className="icon-btn" onClick={() => preview(tr)}
              aria-label={playing === tr.id ? t('Stop {title}', { title: tr.title }) : t('Listen to {name}', { name: tr.title })}>
              {playing === tr.id ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <div className="music-meta">
              <b>{tr.title}</b>
              <small>{tr.artist} · {formatTime(tr.duration, false)}{tr.bpm ? ` · ${Math.round(tr.bpm)} ${t('BPM')}` : ''}</small>
            </div>
            <button className="btn" onClick={() => { stop(); void addLibraryTrack(tr); }} aria-label={t('Add {name} at the playhead', { name: tr.title })}>{t('Add track')}</button>
          </li>
        ))}
      </ul>
      <p className="hint">{t('All tracks are public domain (CC0): use them anywhere, even in ads, with no credit. Added tracks work offline.')}</p>
    </>
  );
}
