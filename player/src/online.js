// Обложки и тексты из открытых сервисов. Отправляются только название, исполнитель и длительность.
import { changedSpeed, searchLyrics, searchName, similarity, norm } from '../../src/sources.js';
import { parseLrc, toLrc } from '../../src/lyrics.js';
import { UNKNOWN } from './model.js';

export async function findCovers(artist, title) {
  if (artist === UNKNOWN) artist = '';
  const name = searchName(title);
  const term = encodeURIComponent(`${artist} ${name}`.trim());
  const itunes = async (country) => {
    const data = await window.kuplet.json(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=12&country=${country}`);
    return (data.results || []).filter((r) => r.artworkUrl100).map((r) => ({
      artist: r.artistName, title: r.trackName, album: r.collectionName,
      thumb: r.artworkUrl100.replace('100x100bb', '200x200bb'), full: r.artworkUrl100.replace('100x100bb', '1000x1000bb'),
    }));
  };
  const deezer = async () => {
    const data = await window.kuplet.json(`https://api.deezer.com/search?q=${term}&limit=12`);
    return (data.data || []).filter((r) => r.album?.cover_xl).map((r) => ({
      artist: r.artist?.name, title: r.title, album: r.album.title, thumb: r.album.cover_medium, full: r.album.cover_xl,
    }));
  };
  const answers = await Promise.allSettled([itunes('KZ'), itunes('US'), deezer()]);
  const failed = answers.every((a) => a.status === 'rejected');
  const seen = new Set();
  const list = answers.flatMap((a) => (a.status === 'fulfilled' ? a.value : []))
    .map((c) => ({ ...c, titleScore: similarity(c.title, name), artistScore: artist ? similarity(c.artist, artist) : 0 }))
    .sort((a, b) => b.titleScore * 2 + b.artistScore * 3 - (a.titleScore * 2 + a.artistScore * 3))
    .filter((c) => {
      const key = `${norm(c.artist)}|${norm(c.album)}`;
      return !seen.has(key) && seen.add(key);
    });
  return { list: list.slice(0, 12), failed };
}

// годится для установки без вопроса
export const sureCover = (c) => c && c.titleScore >= 0.7 && c.artistScore >= 0.6;

export async function findLyrics(track) {
  const artist = track.artist === UNKNOWN ? '' : track.artist;
  const { list, failed } = await searchLyrics(artist, track.title, track.duration);
  const slowed = changedSpeed(`${track.title} ${track.file}`);
  const variants = list.map((item) => {
    let text = item.synced || item.plain;
    let synced = Boolean(item.synced);
    // slowed / sped up: растягиваем тайминги оригинала под длину этого файла
    const factor = slowed && item.duration && track.duration ? track.duration / item.duration : 1;
    if (synced && Math.abs(factor - 1) > 0.03) text = toLrc(parseLrc(text).map((l) => ({ ...l, time: l.time * factor })));
    return {
      text, synced,
      label: `${item.artist} — ${item.title}${item.duration ? ` · ${Math.floor(item.duration / 60)}:${String(Math.round(item.duration) % 60).padStart(2, '0')}` : ''}${synced ? '' : ' · без таймингов'}`,
      // без вопроса ставим только уверенное совпадение
      sure: item.match && (synced ? slowed || item.diff <= 8 : item.diff <= 15),
    };
  });
  variants.sort((a, b) => (b.sure && b.synced) - (a.sure && a.synced) || b.sure - a.sure);
  return { variants, failed };
}
