// Built-in music library (docs/05 M1): public-domain tracks by mood, one-tap preview, add under the video.
import { Play, Plus, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MOODS, type LibraryTrack, type Mood } from '../core/music';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/telemetry';
import { addLibraryTrack, loadManifest, musicUrl } from './actions';
import { Chips } from './controls';
import { formatTime } from './format';
import { IconButton } from './ck/controls';
import './catalog.css';

export const MOOD_LABEL: Record<Mood | 'all', string> = {
  all: 'All', lofi: 'Lo-fi', energetic: 'Energetic', phonk: 'Phonk', cinematic: 'Cinematic',
  calm: 'Calm', happy: 'Happy', game: 'Game', electronic: 'Electronic',
};

export function MusicBody() {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [error, setError] = useState('');
  const [mood, setMood] = useState<Mood | 'all'>('all');
  const [playing, setPlaying] = useState<string | null>(null);
  const [heard, setHeard] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadManifest().then((m) => setTracks(m.tracks), (e) => setError(errorMessage(e)));
    return () => { audio.current?.pause(); audio.current = null; };
  }, []);

  const stop = () => { audio.current?.pause(); audio.current = null; setPlaying(null); setHeard(0); };
  const preview = (tr: LibraryTrack) => {
    if (playing === tr.id) { stop(); return; }
    stop();
    player.pause();
    const a = new Audio(musicUrl(tr.file));
    a.onended = () => { setPlaying(null); setHeard(0); };
    a.ontimeupdate = () => setHeard(a.currentTime); // how far the one playing is (DESIGN.md §2.8: state is seen)
    void a.play().catch(() => setPlaying(null));
    audio.current = a;
    setPlaying(tr.id);
  };

  if (error) return <p className="ck-hint">{error}</p>;
  if (!tracks) return <p className="ck-hint">{t('Loading…')}</p>;
  const list = mood === 'all' ? tracks : tracks.filter((x) => x.mood === mood);
  return (
    <>
      <Chips options={['all', ...MOODS] as const} value={mood} scroll label={t('Mood')} render={(m) => t(MOOD_LABEL[m])} onChange={setMood} />
      <ul className="music-list ck-tracks">
        {list.map((tr) => (
          <li key={tr.id} className={`music-row ck-track ${playing === tr.id ? 'on' : ''}`} data-on={playing === tr.id || undefined}>
            <IconButton hook="ck-listen" aria-pressed={playing === tr.id} onClick={() => preview(tr)}
              label={playing === tr.id ? t('Stop {title}', { title: tr.title }) : t('Listen to {name}', { name: tr.title })}>
              {playing === tr.id ? <Square aria-hidden fill="currentColor" /> : <Play aria-hidden fill="currentColor" />}
            </IconButton>
            <div className="music-meta ck-track-meta">
              <b>{tr.title}</b>
              <small>{tr.artist} · {playing === tr.id ? `${formatTime(heard, false)} / ${formatTime(tr.duration, false)}` : formatTime(tr.duration, false)}{tr.bpm ? ` · ${Math.round(tr.bpm)} ${t('BPM')}` : ''}</small>
            </div>
            {/* «+», not a column of «Добавить» boxes that cut the names short (the art director of Ч4 release 5). */}
            <IconButton label={t('Add {name} at the playhead', { name: tr.title })} onClick={() => { stop(); void addLibraryTrack(tr); }}><Plus aria-hidden="true" /></IconButton>
          </li>
        ))}
      </ul>
      <p className="ck-hint">{t('All tracks are public domain (CC0): use them anywhere, even in ads, with no credit. Added tracks work offline.')}</p>
    </>
  );
}
