// Теги файла, поиск обложек и синхронных текстов.
import jsmediatags from 'jsmediatags/dist/jsmediatags.min.js';

/* ---------- теги и имя файла ---------- */

// Старые русские mp3 часто хранят CP1251 под видом Latin-1.
export function fixCyrillic(s) {
  if (!s) return '';
  s = s.replace(/\0/g, '').trim();
  const high = (s.match(/[À-ÿ]/g) || []).length;
  const letters = (s.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  if (high > 1 && high / letters > 0.6 && [...s].every((c) => c.charCodeAt(0) < 256)) {
    return new TextDecoder('windows-1251').decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }
  return s;
}

export function readTags(file) {
  return new Promise((resolve) => {
    const done = (v) => resolve(v);
    const timer = setTimeout(() => done({}), 5000);
    try {
      jsmediatags.read(file, {
        onSuccess: ({ tags }) => {
          clearTimeout(timer);
          let cover = null;
          if (tags.picture) {
            cover = new Blob([new Uint8Array(tags.picture.data)], { type: tags.picture.format });
          }
          done({
            title: fixCyrillic(tags.title),
            artist: fixCyrillic(tags.artist),
            album: fixCyrillic(tags.album),
            cover,
          });
        },
        onError: () => { clearTimeout(timer); done({}); },
      });
    } catch { clearTimeout(timer); done({}); }
  });
}

// пометки изменённой скорости мешают поиску, но подсказывают, что тайминги надо растянуть
const SPEED_TAG = /(?<![\p{L}\p{N}])(super\s+|ultra\s+)?(slowed(\s*(\+|&|and|n)?\s*reverb(ed)?)?|sped\s*up|speed\s*up|nightcore|reverb(ed)?|замедленн?(ая|ый|ое)(\s+версия)?|ускоренн?(ая|ый|ое)(\s+версия)?)(?![\p{L}\p{N}])/giu;
export const changedSpeed = (s) => new RegExp(SPEED_TAG.source, 'iu').test((s || '').replace(/_/g, ' '));

export function cleanName(s) {
  return (s || '')
    .replace(/[([{][^)\]}]*(official|video|audio|lyric|клип|muz|zaycev|\.(ru|net|com|kz|me|org)|kbps|prod)[^)\]}]*[)\]}]/gi, ' ')
    .replace(/\b[\w-]+\.(ru|net|com|kz|me|org)\b/gi, ' ')
    .replace(/\b(128|192|256|320)\s?kbps\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// название для поиска: без «slowed», «sped up» и подобного
export function searchName(s) {
  const out = cleanName(s)
    .replace(SPEED_TAG, ' ')
    .replace(/[([{]\s*[)\]}]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—|]+\s*$/, '')
    .trim();
  return out || cleanName(s);
}

export function parseFileName(name) {
  let s = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ');
  s = cleanName(s).replace(/^\d{1,3}\s*[.)]\s*/, '').replace(/^0\d\s+/, '');
  const m = s.split(/\s+[-–—]\s+/);
  if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() };
  const t = s.split(/[–—-]/);
  if (t.length === 2 && t[0].trim() && t[1].trim()) return { artist: t[0].trim(), title: t[1].trim() };
  return { artist: '', title: s };
}

/* ---------- сравнение названий ---------- */

export function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\b(feat|ft|prod)\b\.?.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return (n / Math.max(A.size, B.size)) * 0.7;
}

/* ---------- сеть ---------- */

let jsonpId = 0;
function jsonp(url, timeout = 9000) {
  return new Promise((resolve, reject) => {
    const cb = `__pv_cb${Date.now()}_${jsonpId++}`;
    const el = document.createElement('script');
    const finish = (fn, v) => {
      clearTimeout(timer);
      window[cb] = () => {};
      el.remove();
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeout);
    window[cb] = (data) => finish(resolve, data);
    el.onerror = () => finish(reject, new Error('network'));
    el.src = `${url}${url.includes('?') ? '&' : '?'}callback=${cb}`;
    document.head.appendChild(el);
  });
}

async function itunes(term, country) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=15&country=${country}`;
  const data = await jsonp(url);
  return (data.results || [])
    .filter((r) => r.artworkUrl100)
    .map((r) => ({
      artist: r.artistName,
      title: r.trackName,
      album: r.collectionName,
      kind: 'album',
      thumb: r.artworkUrl100.replace('100x100bb', '200x200bb'),
      full: r.artworkUrl100.replace('100x100bb', '1200x1200bb'),
    }));
}

async function deezer(term) {
  const data = await jsonp(`https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=15&output=jsonp`);
  const out = [];
  for (const r of data.data || []) {
    if (r.album?.cover_xl) {
      out.push({ artist: r.artist?.name, title: r.title, album: r.album.title, kind: 'album', thumb: r.album.cover_medium, full: r.album.cover_xl });
    }
    // пустой идентификатор в ссылке = у артиста нет фото
    if (r.artist?.picture_xl && !r.artist.picture_xl.includes('/artist//')) {
      out.push({ artist: r.artist.name, title: r.title, album: 'Фото артиста', kind: 'artist', thumb: r.artist.picture_medium, full: r.artist.picture_xl });
    }
  }
  return out;
}

export async function searchCovers(artist, title) {
  title = searchName(title);
  const term = `${artist} ${title}`.trim();
  const jobs = [itunes(term, 'KZ'), itunes(term, 'US'), deezer(term)];
  if (/[а-я]/i.test(term)) jobs.push(itunes(term, 'RU'));
  const res = await Promise.allSettled(jobs);
  const failed = res.every((r) => r.status === 'rejected');
  const all = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const score = (c) => similarity(c.title, title) * 2 + (artist ? similarity(c.artist, artist) * 3 : 0);
  const seen = new Set();
  const albums = [];
  const photos = [];
  for (const c of all.map((c) => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score)) {
    const key = c.kind === 'artist' ? `a:${norm(c.artist)}` : `${norm(c.artist)}|${norm(c.album)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (c.kind === 'artist' ? photos : albums).push(c);
  }
  const goodPhotos = photos.filter((p) => !artist || similarity(p.artist, artist) >= 0.5).slice(0, 2);
  return { list: [...albums.slice(0, 10), ...goodPhotos], failed };
}

export async function searchLyrics(artist, title, duration) {
  const t = searchName(title);
  const base = 'https://lrclib.net/api/search?';
  const queries = [
    new URLSearchParams(artist ? { track_name: t, artist_name: artist } : { q: t }),
    new URLSearchParams({ q: `${artist} ${norm(t)}`.trim() }),
  ];
  const found = new Map();
  let ok = false;
  for (const q of queries) {
    try {
      const r = await fetch(base + q, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      ok = true;
      for (const item of await r.json()) {
        if (item.syncedLyrics || item.plainLyrics) found.set(item.id, item);
      }
    } catch { /* пробуем следующий запрос */ }
    if ([...found.values()].some((i) => i.syncedLyrics && similarity(i.trackName, t) >= 0.7)) break;
  }
  const list = [...found.values()].map((i) => {
    const diff = duration && i.duration ? Math.abs(i.duration - duration) : 30;
    const ts = similarity(i.trackName, t);
    const as = artist ? similarity(i.artistName, artist) : 0.5;
    return {
      artist: i.artistName,
      title: i.trackName,
      album: i.albumName,
      duration: i.duration,
      synced: i.syncedLyrics || '',
      plain: i.plainLyrics || '',
      diff,
      match: ts >= 0.5 && (!artist || as >= 0.4),
      score: (i.syncedLyrics ? 4 : 0) + ts * 5 + as * 5 - Math.min(diff, 30) / 4,
    };
  });
  list.sort((a, b) => b.score - a.score);
  return { list: list.slice(0, 12), failed: !ok };
}
