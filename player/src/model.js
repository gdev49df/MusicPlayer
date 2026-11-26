// Из сырых тегов — треки, альбомы, исполнители и поиск.
import { cleanName, fixCyrillic, parseFileName } from '../../src/sources.js';

const order = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
export const compare = (a, b) => order.compare(a, b);
export const fold = (s) => (s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
// для поиска: казахские буквы находятся и с русской раскладки
const KAZ = { ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и' };
const plain = (s) => fold(s).replace(/[әғқңөұүһі]/g, (c) => KAZ[c]);

export const UNKNOWN = 'Неизвестный исполнитель';
const mainArtist = (s) => s.split(/\s*(?:;|\s(?:feat\.?|ft\.?)\s)\s*/i)[0].trim() || s;

export function build(raw) {
  const tracks = new Map();
  for (const r of raw) {
    const guess = parseFileName(r.file);
    const title = cleanName(fixCyrillic(r.title)) || guess.title || r.file;
    const artist = cleanName(fixCyrillic(r.artist)) || guess.artist || UNKNOWN;
    const album = cleanName(fixCyrillic(r.album));
    const albumArtist = cleanName(fixCyrillic(r.albumArtist));
    tracks.set(r.id, {
      ...r, title, artist, album, albumArtist,
      main: mainArtist(albumArtist && !/^(various|разные)/i.test(albumArtist) ? albumArtist : artist),
      search: plain(`${title} ${artist} ${album} ${r.file}`),
    });
  }

  const albums = new Map();
  for (const t of tracks.values()) {
    if (!t.album) continue;
    // без «исполнителя альбома» одноимённые альбомы различаются по папке
    const key = `${fold(t.album)}|${t.albumArtist ? fold(t.albumArtist) : t.dir}`;
    t.albumKey = key;
    if (!albums.has(key)) albums.set(key, { key, name: t.album, ids: [], year: 0, added: 0 });
    const a = albums.get(key);
    a.ids.push(t.id);
    a.year ||= t.year;
    a.added = Math.max(a.added, t.added);
  }
  for (const a of albums.values()) {
    const list = a.ids.map((id) => tracks.get(id)).sort((x, y) => x.disc - y.disc || x.no - y.no || compare(x.file, y.file));
    a.ids = list.map((t) => t.id);
    const names = new Set(list.map((t) => t.albumArtist || t.main));
    a.artist = names.size === 1 ? [...names][0] : 'Разные исполнители';
    a.cover = list.find((t) => t.cover)?.cover || null;
  }

  const artists = new Map();
  for (const t of tracks.values()) {
    const key = fold(t.main);
    t.artistKey = key;
    if (!artists.has(key)) artists.set(key, { key, name: t.main, ids: [], albums: new Set() });
    const a = artists.get(key);
    a.ids.push(t.id);
    if (t.albumKey) a.albums.add(t.albumKey);
  }
  for (const a of artists.values()) {
    a.ids.sort((x, y) => compare(tracks.get(x).title, tracks.get(y).title));
    a.cover = a.ids.map((id) => tracks.get(id)).find((t) => t.cover)?.cover || null;
  }

  return { tracks, albums, artists };
}

// все слова запроса должны найтись; совпадения в начале названия выше
export function search(lib, query) {
  const q = plain(query);
  const words = q.split(' ').filter(Boolean);
  if (!words.length) return { tracks: [], albums: [], artists: [] };
  const has = (text) => words.every((w) => text.includes(w));
  const rank = (name) => (name === q ? 3 : name.startsWith(q) ? 2 : name.includes(q) ? 1 : 0);
  const pick = (list, text, name) => list.filter((x) => has(text(x)))
    .sort((a, b) => rank(plain(name(b))) - rank(plain(name(a))) || compare(name(a), name(b)));
  return {
    tracks: pick([...lib.tracks.values()], (t) => t.search, (t) => t.title),
    albums: pick([...lib.albums.values()], (a) => plain(`${a.name} ${a.artist}`), (a) => a.name),
    artists: pick([...lib.artists.values()], (a) => plain(a.name), (a) => a.name),
  };
}
