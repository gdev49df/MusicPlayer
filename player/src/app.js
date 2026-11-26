import { $, h, icon, setIcon, clock, tracksWord, plural, duration, toast, menu, closeMenu, dialog, ask, confirmDialog } from './ui.js';
import { build, compare, search } from './model.js';
import { createPlayer } from './player.js';
import { createStage } from './stage.js';
import { findCovers, sureCover } from './online.js';

const api = window.kuplet;
const audio = $('#audio');
const view = $('#view');

let raw = { folders: [], tracks: [], covers: {} };
let lib = build([]);
let user = null;
let signature = '';

/* ---------- данные пользователя ---------- */

function cleanUser(u) {
  const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
  const arr = (x) => (Array.isArray(x) ? x : []);
  u = obj(u);
  return {
    favorites: arr(u.favorites),
    playlists: arr(u.playlists).filter((p) => p && p.id).map((p) => ({ id: String(p.id), name: String(p.name || 'Плейлист'), ids: arr(p.ids) })),
    plays: obj(u.plays),
    recent: arr(u.recent),
    covers: obj(u.covers),
    offsets: obj(u.offsets),
    online: u.online !== false,
    volume: Number.isFinite(u.volume) ? u.volume : 80,
    muted: Boolean(u.muted),
    sort: String(u.sort || 'title'),
    queue: u.queue || null,
  };
}

let saveTimer = 0;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!user) return;
  user.queue = player.snapshot();
  api.saveUser(user);
}
const saveUser = () => { saveTimer ||= setTimeout(saveNow, 500); };

/* ---------- обложки ---------- */

const track = (id) => lib.tracks.get(id) || null;
const known = (ids) => ids.filter((id) => lib.tracks.has(id));
const coverOf = (t) => (t ? (raw.covers[user.covers[t.id]] ? user.covers[t.id] : t.cover) : null);
const coverFrom = (ids) => {
  for (const id of ids) {
    const c = coverOf(track(id));
    if (c) return c;
  }
  return null;
};
const urlFor = (hash, full) => (hash ? `media://cover/${hash}${full ? '' : '?t'}` : null);

function hue(text) {
  let n = 0;
  for (const c of text) n = (n * 31 + c.codePointAt(0)) % 360;
  return n;
}

// картинка, а без неё — цветная плитка с первой буквой
function art(hash, name = '', cls = '', full = false) {
  const el = h('div', { class: `cover ${cls}` });
  paint(el, hash, name, full);
  return el;
}
function paint(el, hash, name, full) {
  if (!hash && !name) {
    el.style.background = '';
    el.replaceChildren(h('span', {}, '♪'));
  } else if (hash) {
    el.style.background = '';
    el.replaceChildren(h('img', { src: urlFor(hash, full), alt: '', loading: 'lazy', draggable: 'false' }));
  } else {
    const n = hue(name || '♪');
    el.style.background = `linear-gradient(140deg, hsl(${n} 45% 38%), hsl(${(n + 50) % 360} 50% 20%))`;
    el.replaceChildren(h('span', {}, [...name.replace(/[^\p{L}\p{N}]/gu, '')][0]?.toUpperCase() || '♪'));
  }
}

// цвет шапки страницы по обложке
function tint(hash, fallback = '#ff6b4a') {
  const hex = raw.covers[hash]?.color || fallback;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hu = 0;
  if (d) hu = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const sat = d ? d / (1 - Math.abs(max + min - 1)) : 0;
  return `hsl(${Math.round(hu * 60)} ${Math.round(Math.min(0.7, sat) * 100)}% 34%)`;
}

/* ---------- плеер ---------- */

const player = createPlayer(audio, {
  exists: (id) => lib.tracks.has(id),
  onChange(kind) {
    if (!user) return;
    if (kind === 'track') {
      showNow();
      markPlaying();
      autoCover(player.current());
    }
    const id = player.current();
    if (player.playing && id && user.recent[0] !== id) user.recent = [id, ...user.recent.filter((x) => x !== id)].slice(0, 40);
    if (kind !== 'state' && route().name === 'queue') render();
    showControls();
    saveUser();
  },
  onSkip: (id) => toast(`Не получилось открыть «${track(id)?.title || 'трек'}»`),
  onPlayed(id) {
    user.plays[id] = (user.plays[id] || 0) + 1;
    saveUser();
  },
});

const stage = createStage({
  audio,
  getTrack: track,
  coverUrl: (t, full) => urlFor(coverOf(t), full),
  paintCover: (el, t) => paint(el, coverOf(t), t?.title || '', true),
  user: () => user,
  saveUser,
});

let artworkUrl = null;
async function showNow() {
  const t = track(player.current());
  paint($('#nowCover'), coverOf(t), t?.title || '');
  $('#nowTitle').textContent = t?.title || 'Ничего не играет';
  $('#nowArtist').textContent = t?.artist || '';
  $('#nowLike').hidden = !t;
  showLike();
  document.title = t ? `${t.title} — ${t.artist}` : 'Куплет';
  stage.setTrack(t?.id || null);
  showTime();

  const session = navigator.mediaSession;
  if (!t) { session.metadata = null; return; }
  const meta = { title: t.title, artist: t.artist, album: t.album };
  session.metadata = new MediaMetadata(meta);
  const hash = coverOf(t);
  if (!hash) return;
  try {
    const blob = await (await fetch(urlFor(hash))).blob();
    if (player.current() !== t.id) return;
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    artworkUrl = URL.createObjectURL(blob);
    session.metadata = new MediaMetadata({ ...meta, artwork: [{ src: artworkUrl, type: blob.type }] });
  } catch { /* без картинки в системном окошке */ }
}

function showLike() {
  const on = user.favorites.includes(player.current());
  setIcon($('#nowLike'), on ? 'heartFull' : 'heart');
  $('#nowLike').classList.toggle('on', on);
}

function showControls() {
  const s = player.state;
  setIcon($('#play'), player.playing ? 'pause' : 'play');
  $('#play').setAttribute('aria-label', player.playing ? 'Пауза' : 'Играть');
  document.body.classList.toggle('playing', player.playing);
  $('#shuffle').classList.toggle('on', s.shuffle);
  $('#shuffle').setAttribute('aria-pressed', s.shuffle);
  $('#repeat').classList.toggle('on', s.repeat !== 'off');
  $('#repeat').classList.toggle('one', s.repeat === 'one');
  $('#repeat').title = `Повтор: ${{ off: 'выключен', all: 'вся очередь', one: 'один трек' }[s.repeat]} (R)`;
  setIcon($('#mute'), audio.muted || !audio.volume ? 'muted' : 'volume');
  navigator.mediaSession.playbackState = player.current() ? (player.playing ? 'playing' : 'paused') : 'none';
  showTime();
}

let dragging = false;
function range(el) { el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); }
function showTime() {
  const t = track(player.current());
  const total = Number.isFinite(audio.duration) && audio.duration ? audio.duration : t?.duration || 0;
  const now = player.current() ? audio.currentTime : 0;
  if (!dragging) {
    $('#seek').value = total ? (now / total) * 1000 : 0;
    range($('#seek'));
    $('#time').textContent = clock(now);
  }
  $('#length').textContent = clock(total);
  if (total && player.current()) {
    try { navigator.mediaSession.setPositionState({ duration: total, position: Math.min(now, total), playbackRate: 1 }); } catch { /* ещё грузится */ }
  }
}

function setVolume(v, muted = false) {
  user.volume = Math.round(Math.max(0, Math.min(100, v)));
  user.muted = muted;
  // квадрат: тихая часть ползунка регулируется плавнее
  audio.volume = (user.volume / 100) ** 2;
  audio.muted = muted;
  $('#volume').value = muted ? 0 : user.volume;
  range($('#volume'));
  saveUser();
}

/* ---------- действия с треками ---------- */

function play(ids, from = 0, shuffle) {
  player.playList(known(ids), from, shuffle);
}

function toggleLike(ids) {
  const add = ids.some((id) => !user.favorites.includes(id));
  user.favorites = add
    ? [...ids.filter((id) => !user.favorites.includes(id)), ...user.favorites]
    : user.favorites.filter((id) => !ids.includes(id));
  saveUser();
  showLike();
  if (route().name === 'favorites') render();
  else for (const row of view.querySelectorAll('.row[data-id]')) heart(row);
  sidebar();
  if (ids.length > 1) toast(add ? 'Добавлено в любимое' : 'Убрано из любимого');
}

function heart(row) {
  const b = row.querySelector('.heart');
  const on = user.favorites.includes(row.dataset.id);
  setIcon(b, on ? 'heartFull' : 'heart');
  b.classList.toggle('on', on);
  b.title = on ? 'Убрать из любимого' : 'В любимое';
}

async function newPlaylist(ids = []) {
  const name = await ask('Новый плейлист', `Плейлист ${user.playlists.length + 1}`, 'Создать');
  if (!name) return;
  const list = { id: crypto.randomUUID(), name, ids: [...new Set(ids)] };
  user.playlists.push(list);
  saveUser();
  sidebar();
  go('playlist', list.id);
}

function addToPlaylist(list, ids) {
  const fresh = [...new Set(ids)].filter((id) => !list.ids.includes(id));
  list.ids.push(...fresh);
  saveUser();
  sidebar();
  if (route().name === 'playlist' && route().arg === list.id) render();
  toast(fresh.length ? `Добавлено в «${list.name}»: ${tracksWord(fresh.length)}` : `Уже есть в «${list.name}»`);
}

const playlistItems = (ids) => [
  { label: 'Новый плейлист…', icon: 'plus', run: () => newPlaylist(ids) },
  user.playlists.length ? '-' : null,
  ...user.playlists.map((p) => ({ label: p.name, icon: 'list', run: () => addToPlaylist(p, ids) })),
];

async function removeFromLibrary(ids) {
  const what = ids.length === 1 ? `«${track(ids[0])?.title}»` : tracksWord(ids.length);
  if (!await confirmDialog('Убрать из библиотеки?', `${what} пропадёт из программы. Файлы на компьютере останутся.`, 'Убрать')) return;
  await api.remove(ids);
}

function trackMenu(ids, where, x, y) {
  const one = ids.length === 1 ? track(ids[0]) : null;
  const liked = ids.every((id) => user.favorites.includes(id));
  menu([
    one && { label: 'Играть', icon: 'play', run: where.play },
    { label: 'Играть следующим', icon: 'next', run: () => { player.enqueue(ids, true); toast('Будет играть следующим'); } },
    { label: 'Добавить в очередь', icon: 'queue', run: () => { player.enqueue(ids); toast('Добавлено в очередь'); } },
    { label: 'Добавить в плейлист', icon: 'plus', items: playlistItems(ids) },
    { label: liked ? 'Убрать из любимого' : 'В любимое', icon: liked ? 'heartFull' : 'heart', run: () => toggleLike(ids) },
    '-',
    one?.albumKey && { label: 'К альбому', icon: 'album', run: () => go('album', one.albumKey) },
    one && { label: 'К исполнителю', icon: 'artist', run: () => go('artist', one.artistKey) },
    { label: 'Найти обложку', icon: 'search', run: () => pickCover(ids) },
    ids.some((id) => user.covers[id]) && { label: 'Вернуть обложку из файла', icon: 'close', run: () => { ids.forEach((id) => delete user.covers[id]); coversChanged(); } },
    one && { label: 'Показать в папке', icon: 'folder', run: () => api.reveal(one.id) },
    '-',
    where.playlist && { label: 'Убрать из плейлиста', icon: 'close', run: () => where.remove() },
    where.queue && { label: 'Убрать из очереди', icon: 'close', run: () => where.remove() },
    { label: 'Убрать из библиотеки', icon: 'trash', danger: true, run: () => removeFromLibrary(ids) },
  ], x, y);
}

/* ---------- обложки из интернета ---------- */

function coversChanged() {
  saveUser();
  render();
  sidebar();
  showNow();
}

async function applyCover(ids, url) {
  const got = await api.fetchCover(url);
  if (!got) throw new Error('Не картинка');
  raw.covers[got.hash] = got.info;
  for (const id of ids) user.covers[id] = got.hash;
}

const tried = new Set();
async function autoCover(id) {
  const t = track(id);
  if (!t || !user.online || coverOf(t) || tried.has(id)) return;
  tried.add(id);
  try {
    const { list } = await findCovers(t.artist, t.title);
    if (!sureCover(list[0]) || coverOf(track(id))) return;
    await applyCover([id], list[0].full);
    coversChanged();
  } catch { /* останется плитка с буквой */ }
}

async function pickCover(ids) {
  const first = track(ids[0]);
  if (!first) return;
  const album = ids.length === 1 && first.albumKey ? lib.albums.get(first.albumKey) : null;
  const query = h('input', { type: 'text', value: `${first.artist} - ${first.title}`, 'aria-label': 'Что искать' });
  const grid = h('div', { class: 'picker' });
  const whole = album && album.ids.length > 1 ? h('input', { type: 'checkbox', checked: true }) : null;
  let chosen = null;
  let turn = 0;
  const run = async () => {
    const mine = ++turn;
    grid.replaceChildren(h('p', {}, 'Ищу…'));
    const [artist, ...rest] = query.value.split(' - ');
    const { list, failed } = await findCovers(rest.length ? artist : '', rest.length ? rest.join(' - ') : artist);
    if (mine !== turn) return;
    grid.replaceChildren(...(list.length ? list.map((c) => h('button', {
      type: 'submit', value: 'ok', title: `${c.artist} — ${c.album}`, onclick: () => { chosen = c; },
    }, h('img', { src: c.thumb, alt: '' }), h('small', {}, c.album))) : [h('p', {}, failed ? 'Нет связи с сервисами обложек.' : 'Ничего не нашлось.')]));
  };
  query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(); } });
  run();
  const done = await dialog('Обложка', h('div', { class: 'coverpick' },
    h('div', { class: 'inline' }, query, h('button', { type: 'button', onclick: run }, 'Искать')),
    grid,
    whole && h('label', { class: 'check' }, whole, `Для всего альбома «${album.name}»`),
  ), [['Закрыть', 'cancel']]);
  if (!done || !chosen) return;
  try {
    await applyCover(whole?.checked ? album.ids : ids, chosen.full);
    coversChanged();
  } catch {
    toast('Не удалось скачать обложку');
  }
}

/* ---------- список треков ---------- */

const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', year: 'numeric' });
let observers = [];

// opts: playlist — объект; queue — номер первой строки в очереди; numbers: 'album'; flat — без колонок «Альбом» и «Добавлен»
function trackList(ids, opts = {}) {
  const queued = opts.queue !== undefined;
  const list = h('div', { class: `tracks${opts.flat ? ' flat' : ''}` });
  const selected = new Set();
  let anchor = 0;
  let shown = 0;

  const row = (id, i) => {
    const t = track(id);
    const el = h('div', { class: 'row', 'data-id': id, 'data-i': i, draggable: 'true', tabindex: '0' },
      h('button', { class: 'n', 'aria-label': `Играть «${t.title}»`, tabindex: '-1' }, h('b', {}, String(opts.numbers === 'album' ? t.no || i + 1 : i + 1)), icon('play'), icon('pause'), h('span', { class: 'eq' }, h('i'), h('i'), h('i'))),
      h('div', { class: 'what' }, art(coverOf(t), t.title),
        h('div', {}, h('strong', {}, t.title), h('button', { class: 'text sub artist', tabindex: '-1' }, t.artist))),
      !opts.flat && h('div', { class: 'album' }, t.album ? h('button', { class: 'text sub', tabindex: '-1' }, t.album) : null),
      !opts.flat && h('span', { class: 'added' }, date.format(t.added).replace(/\s?г\.$/, '')),
      h('button', { class: 'icon heart', tabindex: '-1', 'aria-label': 'В любимое' }),
      h('span', { class: 'dur' }, t.duration ? clock(t.duration) : '—'),
      h('button', { class: 'icon more', tabindex: '-1', 'aria-label': 'Ещё' }, icon('more')),
    );
    heart(el);
    playingRow(el, queued ? opts.queue + i : null);
    return el;
  };

  const body = h('div', {});
  const sentinel = h('div', { class: 'sentinel' });
  const grow = (count) => {
    const end = Math.min(ids.length, shown + count);
    const part = document.createDocumentFragment();
    for (let i = shown; i < end; i++) part.append(row(ids[i], i));
    body.append(part);
    shown = end;
    if (shown >= ids.length) sentinel.remove();
  };
  list.append(
    h('div', { class: 'row head', 'aria-hidden': 'true' }, h('span', { class: 'n' }, '#'), h('span', {}, 'Название'),
      !opts.flat && h('span', { class: 'album' }, 'Альбом'), !opts.flat && h('span', { class: 'added' }, 'Добавлен'), h('span'), h('span', { class: 'dur' }, icon('clock')), h('span')),
    body, sentinel,
  );
  grow(Math.max(120, route().rows || 0));
  // длинные списки дорисовываются по мере прокрутки
  const io = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting || shown >= ids.length) return;
    grow(150);
    route().rows = shown;
    io.unobserve(sentinel);
    if (shown < ids.length) io.observe(sentinel);
  }, { root: view, rootMargin: '600px' });
  if (shown < ids.length) io.observe(sentinel);
  observers.push(io);

  const mark = () => body.querySelectorAll('.row').forEach((r) => r.classList.toggle('selected', selected.has(Number(r.dataset.i))));
  const start = (i) => {
    if (queued) player.jump(opts.queue + i);
    else play(ids, i);
  };
  const where = (i) => ({
    play: () => start(i),
    playlist: opts.playlist,
    queue: queued,
    remove: () => {
      const picked = [...selected].sort((a, b) => b - a);
      if (queued) picked.forEach((k) => player.removeAt(opts.queue + k));
      else if (opts.playlist) {
        const drop = new Set(picked.map((k) => ids[k]));
        opts.playlist.ids = opts.playlist.ids.filter((id) => !drop.has(id));
        saveUser();
        sidebar();
        render();
      }
    },
  });
  const menuFor = (i, x, y) => {
    if (!selected.has(i)) { selected.clear(); selected.add(i); anchor = i; mark(); }
    trackMenu([...selected].sort((a, b) => a - b).map((k) => ids[k]), where(i), x, y);
  };

  body.addEventListener('click', (e) => {
    const el = e.target.closest('.row');
    if (!el) return;
    const i = Number(el.dataset.i);
    const t = track(ids[i]);
    if (e.target.closest('.n')) {
      if (el.classList.contains('current')) player.toggle(); else start(i);
    } else if (e.target.closest('.heart')) toggleLike([t.id]);
    else if (e.target.closest('.more')) {
      const r = e.target.closest('.more').getBoundingClientRect();
      menuFor(i, r.left - 200, r.bottom + 4);
    } else if (e.target.closest('.artist')) go('artist', t.artistKey);
    else if (e.target.closest('.album button')) go('album', t.albumKey);
    else {
      if (e.shiftKey) {
        selected.clear();
        for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) selected.add(k);
      } else if (e.ctrlKey || e.metaKey) {
        if (!selected.delete(i)) selected.add(i);
        anchor = i;
      } else {
        selected.clear();
        selected.add(i);
        anchor = i;
      }
      mark();
    }
  });
  body.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.row');
    if (el && !e.target.closest('button')) start(Number(el.dataset.i));
  });
  body.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.row');
    if (!el) return;
    e.preventDefault();
    menuFor(Number(el.dataset.i), e.clientX, e.clientY);
  });
  body.addEventListener('keydown', (e) => {
    const el = e.target.closest('.row');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (e.key === 'Enter') { e.preventDefault(); start(i); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? el.nextElementSibling : el.previousElementSibling)?.focus();
    }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      menuFor(i, r.left + 120, r.top + 20);
    }
    if (e.key === 'Delete' && (queued || opts.playlist)) {
      if (!selected.has(i)) { selected.clear(); selected.add(i); }
      where(i).remove();
    }
  });

  // перетаскивание: в плейлист слева или на новое место в очереди и плейлисте
  const sortable = queued || Boolean(opts.playlist);
  let from = null;
  body.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.row');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (!selected.has(i)) { selected.clear(); selected.add(i); anchor = i; mark(); }
    from = i;
    e.dataTransfer.setData('text/x-kuplet', JSON.stringify([...selected].sort((a, b) => a - b).map((k) => ids[k])));
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  const clear = () => body.querySelectorAll('.above, .below').forEach((r) => r.classList.remove('above', 'below'));
  body.addEventListener('dragend', () => { from = null; clear(); });
  body.addEventListener('dragover', (e) => {
    const el = e.target.closest('.row');
    if (!sortable || from === null || !el) return;
    e.preventDefault();
    clear();
    const r = el.getBoundingClientRect();
    el.classList.add(e.clientY < r.top + r.height / 2 ? 'above' : 'below');
  });
  body.addEventListener('drop', (e) => {
    const el = e.target.closest('.row');
    if (!sortable || from === null || !el) return;
    e.preventDefault();
    let to = Number(el.dataset.i) + (el.classList.contains('below') ? 1 : 0);
    if (to > from) to--;
    clear();
    if (to === from) return;
    if (queued) player.move(opts.queue + from, opts.queue + to);
    else {
      const moved = ids[from];
      const next = ids.filter((_, k) => k !== from);
      next.splice(to, 0, moved);
      // треки, которых сейчас нет на диске, остаются в конце
      opts.playlist.ids = [...next, ...opts.playlist.ids.filter((id) => !next.includes(id))];
      saveUser();
      render();
    }
  });
  return list;
}

function playingRow(el, queueIndex) {
  const on = queueIndex === null ? el.dataset.id === player.current() : queueIndex === player.state.index;
  el.classList.toggle('current', on);
}

function markPlaying() {
  const queue = route().name === 'queue';
  if (!queue) for (const el of view.querySelectorAll('.row[data-id]')) playingRow(el, null);
}

/* ---------- части страниц ---------- */

const total = (ids) => ids.reduce((sum, id) => sum + (track(id)?.duration || 0), 0);
const summary = (ids) => `${tracksWord(ids.length)}${ids.length ? ` · ${duration(total(ids))}` : ''}`;

function hero({ kicker, title, meta, cover, color, actions }) {
  view.style.setProperty('--tint', color || tint(null));
  return h('div', { class: 'hero' }, cover,
    h('div', {}, kicker && h('p', { class: 'kicker' }, kicker), h('h1', { class: title.length > 28 ? 'long' : '' }, title), meta && h('p', { class: 'meta' }, meta),
      actions && h('div', { class: 'actions' }, actions)));
}

const playButtons = (ids, extra = []) => [
  h('button', { class: 'play big', title: 'Играть', 'aria-label': 'Играть всё', disabled: !ids.length, onclick: () => play(ids, 0, false) }, icon('play')),
  h('button', { disabled: ids.length < 2, onclick: () => play(ids, -1, true) }, icon('shuffle'), 'Перемешать'),
  ...extra,
];

const more = (items) => h('button', { class: 'icon', title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(items(), r.left, r.bottom + 4);
} }, icon('more'));

function card({ title, sub, cover, round, open, ids }) {
  return h('div', { class: `card${round ? ' round' : ''}` },
    h('div', { class: 'face' }, art(cover, title), h('button', { class: 'play', 'aria-label': `Играть «${title}»`, onclick: () => play(ids, 0, false) }, icon('play'))),
    h('button', { class: 'open', onclick: open }, h('strong', {}, title), h('span', {}, sub)),
    );
}
const albumCard = (a) => card({ title: a.name, sub: a.artist, cover: coverFrom(a.ids), ids: a.ids, open: () => go('album', a.key) });
const artistCard = (a) => card({ title: a.name, sub: tracksWord(a.ids.length), cover: coverFrom(a.ids), round: true, ids: a.ids, open: () => go('artist', a.key) });
function trackCard(id, ids) {
  const t = track(id);
  return card({
    title: t.title, sub: t.artist, cover: coverOf(t), ids: [id, ...ids.filter((x) => x !== id)],
    open: () => play(ids, ids.indexOf(id)),
  });
}

const shelf = (title, cards, all) => (cards.length ? h('section', {},
  h('div', { class: 'shelfhead' }, h('h2', {}, title), all && h('button', { class: 'text sub', onclick: all }, 'Показать все')),
  h('div', { class: 'grid shelf' }, cards)) : null);

const nothing = (title, text, ...actions) => h('div', { class: 'nothing' }, h('h2', {}, title), h('p', {}, text), actions.length ? h('div', { class: 'actions' }, actions) : null);

const welcome = () => nothing('Здесь будет ваша музыка',
  raw.scanning ? 'Читаю файлы — треки появятся через несколько секунд.' : 'Выберите папку с песнями или перетащите файлы прямо в окно. Программа только читает их и ничего не меняет.',
  h('button', { class: 'primary', onclick: () => add('addFolder') }, icon('folder'), 'Выбрать папку'),
  h('button', { onclick: () => add('addFiles') }, 'Добавить файлы'));

const allIds = (sort) => {
  const list = [...lib.tracks.values()];
  const by = {
    title: (a, b) => compare(a.title, b.title),
    artist: (a, b) => compare(a.artist, b.artist) || compare(a.album, b.album) || a.disc - b.disc || a.no - b.no,
    album: (a, b) => compare(a.album || '￿', b.album || '￿') || a.disc - b.disc || a.no - b.no,
    added: (a, b) => b.added - a.added || compare(a.title, b.title),
    duration: (a, b) => a.duration - b.duration,
  };
  return list.sort(by[sort] || by.title).map((t) => t.id);
};

const favoriteIds = () => known(user.favorites);

/* ---------- страницы ---------- */

const pages = {
  home() {
    view.style.setProperty('--tint', tint(coverOf(track(user.recent[0]))));
    const hour = new Date().getHours();
    const hello = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';
    if (!lib.tracks.size) return [h('h1', { class: 'hello' }, hello), welcome()];
    const fav = favoriteIds();
    const albums = [...lib.albums.values()].sort((a, b) => b.added - a.added);
    const newest = allIds('added');
    const tile = (title, cover, ids, open) => h('div', { class: 'tile' },
      h('button', { class: 'open', onclick: open }, cover, h('strong', {}, title)),
      ids.length ? h('button', { class: 'play', 'aria-label': `Играть «${title}»`, onclick: () => play(ids, 0, false) }, icon('play')) : null);
    const tiles = [
      tile('Любимые треки', h('div', { class: 'cover likes' }, icon('heartFull')), fav, () => go('favorites')),
      tile('Все треки', h('div', { class: 'cover all' }, icon('note')), allIds('title'), () => go('tracks')),
      ...user.playlists.slice(0, 4).map((p) => tile(p.name, art(coverFrom(p.ids), p.name), known(p.ids), () => go('playlist', p.id))),
      ...albums.slice(0, Math.max(0, 4 - user.playlists.length)).map((a) => tile(a.name, art(coverFrom(a.ids), a.name), a.ids, () => go('album', a.key))),
    ];
    const recent = known(user.recent);
    const often = Object.keys(user.plays).filter((id) => lib.tracks.has(id) && user.plays[id] > 1).sort((a, b) => user.plays[b] - user.plays[a]).slice(0, 12);
    return [
      h('div', { class: 'hellorow' }, h('h1', { class: 'hello' }, hello),
        h('button', { class: 'primary', onclick: () => play(allIds('title'), -1, true) }, icon('shuffle'), 'Перемешать всё')),
      h('div', { class: 'tiles' }, tiles),
      shelf('Недавно слушали', recent.slice(0, 12).map((id) => trackCard(id, recent))),
      shelf('Часто слушаете', often.map((id) => trackCard(id, often))),
      shelf('Новые альбомы', albums.slice(0, 12).map(albumCard), () => go('albums')),
      shelf('Недавно добавленные', newest.slice(0, 12).map((id) => trackCard(id, newest.slice(0, 50))), () => { user.sort = 'added'; go('tracks'); }),
      shelf('Исполнители', [...lib.artists.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, 12).map(artistCard), () => go('artists')),
    ];
  },

  search(query) {
    view.style.setProperty('--tint', tint(null));
    if (!query?.trim()) {
      return [nothing('Поиск', 'Начните печатать вверху: название песни, исполнителя или альбома.'),
        shelf('Исполнители', [...lib.artists.values()].sort((a, b) => compare(a.name, b.name)).slice(0, 24).map(artistCard), () => go('artists'))];
    }
    const found = search(lib, query);
    const ids = found.tracks.map((t) => t.id);
    if (!ids.length && !found.albums.length && !found.artists.length) return [nothing('Ничего не нашлось', `По запросу «${query.trim()}» в вашей музыке ничего нет.`)];
    return [
      found.artists.length ? shelf('Исполнители', found.artists.slice(0, 12).map(artistCard)) : null,
      found.albums.length ? shelf('Альбомы', found.albums.slice(0, 12).map(albumCard)) : null,
      ids.length ? h('section', {}, h('div', { class: 'shelfhead' }, h('h2', {}, 'Треки'), h('span', { class: 'sub' }, tracksWord(ids.length))), trackList(ids)) : null,
    ];
  },

  tracks() {
    const ids = allIds(user.sort);
    const sort = h('select', { 'aria-label': 'Сортировка', onchange: (e) => { user.sort = e.target.value; saveUser(); route().rows = 0; render(); } },
      [['title', 'По названию'], ['artist', 'По исполнителю'], ['album', 'По альбому'], ['added', 'Сначала новые'], ['duration', 'По длительности']]
        .map(([v, label]) => h('option', { value: v, selected: v === user.sort }, label)));
    return [
      hero({ kicker: 'Библиотека', title: 'Все треки', meta: summary(ids), cover: h('div', { class: 'cover all' }, icon('note')), actions: ids.length ? [...playButtons(ids), sort] : null }),
      ids.length ? trackList(ids) : welcome(),
    ];
  },

  albums() {
    const list = [...lib.albums.values()].sort((a, b) => compare(a.name, b.name));
    view.style.setProperty('--tint', tint(null, '#7a5cff'));
    return [h('h1', { class: 'hello' }, 'Альбомы'),
      list.length ? h('div', { class: 'grid' }, list.map(albumCard))
        : lib.tracks.size ? nothing('Альбомов нет', 'В тегах ваших файлов не указаны названия альбомов. Все песни есть в разделе «Все треки».') : welcome()];
  },

  album(key) {
    const a = lib.albums.get(key);
    if (!a) return gone();
    const cover = coverFrom(a.ids);
    const artist = lib.tracks.get(a.ids[0]);
    return [
      hero({
        kicker: 'Альбом', title: a.name, cover: art(cover, a.name, '', true), color: tint(cover),
        meta: [a.artist === 'Разные исполнители' ? a.artist : h('button', { class: 'text', onclick: () => go('artist', artist.artistKey) }, a.artist), ` · ${a.year ? `${a.year} · ` : ''}${summary(a.ids)}`],
        actions: playButtons(a.ids, [more(() => [
          { label: 'Добавить в очередь', icon: 'queue', run: () => { player.enqueue(a.ids); toast('Добавлено в очередь'); } },
          { label: 'Добавить в плейлист', icon: 'plus', items: playlistItems(a.ids) },
          { label: 'Найти обложку', icon: 'search', run: () => pickCover([a.ids[0]]) },
        ])]),
      }),
      trackList(a.ids, { flat: true, numbers: 'album' }),
    ];
  },

  artists() {
    const list = [...lib.artists.values()].sort((a, b) => compare(a.name, b.name));
    view.style.setProperty('--tint', tint(null, '#2f9e8f'));
    return [h('h1', { class: 'hello' }, 'Исполнители'), list.length ? h('div', { class: 'grid' }, list.map(artistCard)) : welcome()];
  },

  artist(key) {
    const a = lib.artists.get(key);
    if (!a) return gone();
    const cover = coverFrom(a.ids);
    const albums = [...a.albums].map((k) => lib.albums.get(k)).sort((x, y) => y.year - x.year || compare(x.name, y.name));
    return [
      hero({ kicker: 'Исполнитель', title: a.name, cover: art(cover, a.name, 'circle', true), color: tint(cover), meta: summary(a.ids), actions: playButtons(a.ids) }),
      albums.length ? h('section', {}, h('div', { class: 'shelfhead' }, h('h2', {}, 'Альбомы')), h('div', { class: 'grid' }, albums.map(albumCard))) : null,
      h('section', {}, h('div', { class: 'shelfhead' }, h('h2', {}, 'Треки')), trackList(a.ids)),
    ];
  },

  favorites() {
    const ids = favoriteIds();
    return [
      hero({ kicker: 'Плейлист', title: 'Любимые треки', meta: summary(ids), cover: h('div', { class: 'cover likes' }, icon('heartFull')), color: tint(null, '#e0447a'), actions: ids.length ? playButtons(ids) : null }),
      ids.length ? trackList(ids) : nothing('Пока пусто', 'Нажмите на сердечко у песни — она появится здесь.'),
    ];
  },

  playlist(id) {
    const p = user.playlists.find((x) => x.id === id);
    if (!p) return gone();
    const ids = known(p.ids);
    const cover = coverFrom(ids);
    return [
      hero({
        kicker: 'Плейлист', title: p.name, meta: summary(ids), cover: art(cover, p.name, '', true), color: tint(cover),
        actions: playButtons(ids, [more(() => playlistActions(p))]),
      }),
      ids.length ? trackList(ids, { playlist: p }) : nothing('Плейлист пуст', 'Перетащите сюда песни на название плейлиста слева или выберите «Добавить в плейлист» в меню песни.',
        h('button', { onclick: () => go('tracks') }, 'Открыть все треки')),
    ];
  },

  queue() {
    const s = player.state;
    const now = track(player.current());
    view.style.setProperty('--tint', tint(coverOf(now)));
    if (!now) return [h('h1', { class: 'hello' }, 'Очередь'), nothing('Очередь пуста', 'Включите любую песню — дальше пойдут остальные из того же списка.')];
    const next = s.list.slice(s.index + 1);
    return [
      h('h1', { class: 'hello' }, 'Очередь'),
      h('section', {}, h('div', { class: 'shelfhead' }, h('h2', {}, 'Сейчас играет')), trackList([now.id], { queue: s.index })),
      h('section', {}, h('div', { class: 'shelfhead' }, h('h2', {}, 'Дальше'),
        next.length ? h('button', { class: 'text sub', onclick: () => player.clearUpcoming() }, 'Очистить') : null),
      next.length ? trackList(next, { queue: s.index + 1 }) : h('p', { class: 'sub' }, s.repeat === 'all' ? 'После этой песни очередь начнётся заново.' : 'Это последняя песня в очереди.')),
    ];
  },

  settings() {
    view.style.setProperty('--tint', tint(null, '#4c5578'));
    const online = h('input', { type: 'checkbox', checked: user.online, onchange: (e) => { user.online = e.target.checked; saveUser(); } });
    const files = lib.tracks.size;
    return [
      h('h1', { class: 'hello' }, 'Настройки'),
      h('section', { class: 'box' }, h('h2', {}, 'Папки с музыкой'),
        raw.folders.length ? h('ul', { class: 'folders' }, raw.folders.map((f) => h('li', {}, icon('folder'), h('span', {}, f),
          h('button', { onclick: async () => {
            if (await confirmDialog('Убрать папку?', `Песни из «${f}» пропадут из программы. Файлы на компьютере останутся.`, 'Убрать')) await api.removeFolder(f);
          } }, 'Убрать')))) : h('p', { class: 'sub' }, 'Папок пока нет.'),
        h('p', { class: 'sub' }, `В библиотеке: ${tracksWord(files)}. Новые файлы в этих папках появляются сами.`),
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: () => add('addFolder') }, 'Добавить папку'),
          h('button', { onclick: () => add('addFiles') }, 'Добавить файлы'),
          h('button', { onclick: async () => { await api.rescan(); toast('Библиотека проверена'); } }, 'Проверить заново'))),
      h('section', { class: 'box' }, h('h2', {}, 'Интернет'),
        h('label', { class: 'check' }, online, 'Искать недостающие обложки и тексты песен'),
        h('p', { class: 'sub' }, 'В сервисы Apple, Deezer и lrclib уходят только название, исполнитель и длительность песни. Сами файлы никуда не отправляются.')),
      h('section', { class: 'box' }, h('h2', {}, 'Обновления'),
        h('p', { class: 'sub', id: 'updateText' }, updates.text),
        h('div', { class: 'actions' },
          h('button', { id: 'updateCheck', disabled: updates.busy, onclick: () => checkUpdate(false) }, 'Проверить обновления'),
          h('button', { class: 'primary', id: 'updateInstall', hidden: !updates.latest, disabled: updates.busy, onclick: installUpdate }, 'Обновить'))),
      h('section', { class: 'box' }, h('h2', {}, 'Клавиши'),
        h('dl', {}, [
          ['Пробел', 'играть или пауза'], ['← →', 'перемотка на 5 секунд'], ['Ctrl + ← →', 'предыдущая и следующая песня'], ['Ctrl + ↑ ↓', 'громкость'],
          ['S', 'перемешать'], ['R', 'повтор'], ['M', 'выключить звук'], ['L', 'текст песни'], ['Q', 'очередь'], ['Ctrl + F', 'поиск'], ['Alt + ← →', 'назад и вперёд по страницам'],
        ].map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
      h('p', { class: 'sub foot' }, 'Куплет · Разработано GwebStudio'),
    ];
  },
};

function gone() {
  return [nothing('Здесь больше пусто', 'Эта страница пропала из библиотеки.', h('button', { onclick: () => go('home') }, 'На главную'))];
}

/* ---------- переходы ---------- */

const history = [{ name: 'home' }];
let place = 0;
const route = () => history[place];

function render(restore = true) {
  if (!user) return;
  const r = route();
  const top = restore ? view.scrollTop : r.scroll || 0;
  observers.forEach((o) => o.disconnect());
  observers = [];
  view.replaceChildren(...pages[r.name](r.arg).filter(Boolean));
  view.scrollTop = top;
  markMenu();
}

function leave() { route().scroll = view.scrollTop; }

function show() {
  closeMenu();
  stage.toggle(false);
  $('#search').value = route().name === 'search' ? route().arg || '' : '';
  render(false);
  $('#back').disabled = place === 0;
  $('#forward').disabled = place === history.length - 1;
}

function go(name, arg) {
  const r = route();
  if (r.name === name && r.arg === arg) { stage.toggle(false); render(); return; }
  leave();
  history.splice(place + 1, Infinity, { name, arg });
  if (history.length > 50) history.shift();
  place = history.length - 1;
  show();
}

function step(by) {
  if (!history[place + by]) return;
  leave();
  place += by;
  show();
}

/* ---------- левая колонка ---------- */

function sidebar() {
  $('#menu').replaceChildren(...[
    ['home', 'home', 'Главная'], ['tracks', 'note', 'Все треки'], ['albums', 'album', 'Альбомы'], ['artists', 'artist', 'Исполнители'], ['favorites', 'heart', 'Любимое'], ['settings', 'settings', 'Настройки'],
  ].map(([name, ic, label]) => {
    const b = h('button', { 'data-route': name, onclick: () => go(name) }, icon(ic), h('span', {}, label));
    if (name === 'favorites') dropTarget(b, (ids) => { const fresh = ids.filter((id) => !user.favorites.includes(id)); if (fresh.length) toggleLike(fresh); });
    return b;
  }));
  $('#lists').replaceChildren(...(user.playlists.length ? user.playlists.map((p) => {
    const b = h('button', {
      class: 'plist', 'data-route': `playlist:${p.id}`, onclick: () => go('playlist', p.id),
      oncontextmenu: (e) => { e.preventDefault(); menu(playlistActions(p), e.clientX, e.clientY); },
    }, art(coverFrom(p.ids), p.name), h('span', {}, h('strong', {}, p.name), h('small', {}, tracksWord(known(p.ids).length))));
    dropTarget(b, (ids) => addToPlaylist(p, ids));
    return b;
  }) : [h('p', { class: 'sub' }, 'Создайте первый кнопкой «+».')]));
  markMenu();
}

function markMenu() {
  const r = route();
  const key = r.name === 'playlist' ? `playlist:${r.arg}` : r.name === 'album' ? 'albums' : r.name === 'artist' ? 'artists' : r.name;
  document.querySelectorAll('#side [data-route]').forEach((b) => b.classList.toggle('here', b.dataset.route === key));
  $('#queueBtn').classList.toggle('on', r.name === 'queue');
}

function dropTarget(el, run) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/x-kuplet')) return;
    e.preventDefault();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    const data = e.dataTransfer.getData('text/x-kuplet');
    el.classList.remove('over');
    if (!data) return;
    e.preventDefault();
    run(JSON.parse(data));
  });
}

function playlistActions(p) {
  return [
    { label: 'Играть', icon: 'play', run: () => play(p.ids, 0, false) },
    { label: 'Добавить в очередь', icon: 'queue', run: () => { player.enqueue(known(p.ids)); toast('Добавлено в очередь'); } },
    { label: 'Переименовать', icon: 'edit', run: async () => {
      const name = await ask('Название плейлиста', p.name);
      if (!name) return;
      p.name = name;
      saveUser();
      sidebar();
      render();
    } },
    '-',
    { label: 'Удалить плейлист', icon: 'trash', danger: true, run: async () => {
      if (!await confirmDialog('Удалить плейлист?', `«${p.name}» будет удалён. Песни останутся в библиотеке.`, 'Удалить')) return;
      user.playlists = user.playlists.filter((x) => x !== p);
      saveUser();
      sidebar();
      if (route().name === 'playlist' && route().arg === p.id) go('home');
      else render();
    } },
  ];
}

/* ---------- добавление и библиотека ---------- */

async function add(kind, ...args) {
  const ids = await api[kind](...args);
  if (ids.length) {
    // сообщение о новой библиотеке может прийти позже ответа, поэтому берём её сразу
    accept(await api.library());
    toast(`Добавлено: ${tracksWord(ids.length)}`);
  }
  return ids;
}

function accept(data) {
  const next = JSON.stringify([data.folders, data.tracks, data.scanning && !data.tracks.length]);
  raw = { ...data, covers: { ...raw.covers, ...data.covers } };
  const moves = data.moves || {};
  if (Object.keys(moves).length) {
    const map = (id) => moves[id] || id;
    user.favorites = [...new Set(user.favorites.map(map))];
    user.recent = [...new Set(user.recent.map(map))];
    for (const p of user.playlists) p.ids = [...new Set(p.ids.map(map))];
    for (const store of [user.plays, user.covers, user.offsets]) {
      for (const [from, to] of Object.entries(moves)) {
        if (from in store) { store[to] ??= store[from]; delete store[from]; }
      }
    }
    saveUser();
  }
  if (next === signature) return;
  signature = next;
  lib = build(raw.tracks);
  player.sync(moves);
  sidebar();
  render();
  showNow();
  showControls();
}

/* ---------- обновления ---------- */

const updates = { text: '', latest: null, busy: false, version: '' };

function showUpdates() {
  const pill = $('#updatePill');
  pill.hidden = !updates.latest;
  pill.disabled = updates.busy;
  pill.textContent = updates.busy ? updates.text : `Обновить до ${updates.latest}`;
  if (route().name === 'settings') {
    if ($('#updateText')) $('#updateText').textContent = updates.text;
    if ($('#updateCheck')) $('#updateCheck').disabled = updates.busy;
    if ($('#updateInstall')) { $('#updateInstall').hidden = !updates.latest; $('#updateInstall').disabled = updates.busy; }
  }
}

async function checkUpdate(silent) {
  if (updates.busy) return;
  updates.busy = true;
  if (!silent) updates.text = 'Проверяю…';
  showUpdates();
  const r = await api.update.check();
  updates.busy = false;
  if (r.available) {
    updates.latest = r.latest;
    updates.text = `Версия ${updates.version}. Есть новая: ${r.latest}.`;
  } else if (!silent) {
    updates.text = r.error ? `Не получилось проверить: ${r.error}` : `Версия ${updates.version} — самая новая.`;
  }
  showUpdates();
}

async function installUpdate() {
  if (updates.busy) return;
  updates.busy = true;
  updates.text = 'Скачиваю…';
  showUpdates();
  saveNow();
  const r = await api.update.install();
  if (r.error) {
    updates.busy = false;
    updates.text = `Не получилось обновить: ${r.error}`;
    toast(updates.text);
  } else updates.text = 'Устанавливаю и перезапускаю…';
  showUpdates();
}

api.update.onProgress((p) => {
  if (!updates.busy) return;
  updates.text = `Скачиваю… ${Math.round(p)}%`;
  showUpdates();
});

/* ---------- кнопки и клавиши ---------- */

for (const el of document.querySelectorAll('span[data-icon]')) el.replaceWith(icon(el.dataset.icon));
for (const el of document.querySelectorAll('button[data-icon]')) setIcon(el, el.dataset.icon);

$('#back').onclick = () => step(-1);
$('#forward').onclick = () => step(1);
$('#newList').onclick = () => newPlaylist();
$('#updatePill').onclick = installUpdate;
$('#addMusic').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  menu([
    { label: 'Папку с музыкой', icon: 'folder', run: () => add('addFolder') },
    { label: 'Отдельные файлы', icon: 'note', run: () => add('addFiles') },
  ], r.left, r.top - 90);
};
$('#search').addEventListener('input', (e) => {
  const value = e.target.value;
  if (route().name !== 'search') {
    if (!value) return;
    go('search', value);
  } else {
    route().arg = value;
    route().rows = 0;
    stage.toggle(false);
    render();
    view.scrollTop = 0;
  }
});
// Enter включает первую найденную песню
$('#search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const ids = search(lib, e.target.value).tracks.map((t) => t.id);
  if (ids.length) play(ids, 0, false);
});
$('#search').addEventListener('focus', () => { if (route().name !== 'search') go('search', ''); });

const toggle = () => {
  if (!player.toggle()) {
    const ids = allIds('title');
    if (ids.length) play(ids, -1, true);
  }
};
$('#play').onclick = toggle;
$('#prev').onclick = () => player.prev();
$('#next').onclick = () => player.next();
$('#shuffle').onclick = () => player.toggleShuffle();
$('#repeat').onclick = () => player.cycleRepeat();
$('#nowLike').onclick = () => player.current() && toggleLike([player.current()]);
$('#nowCover').onclick = () => player.current() && stage.toggle();
$('#nowTitle').onclick = () => { const t = track(player.current()); if (t) go(t.albumKey ? 'album' : 'queue', t.albumKey); };
$('#nowArtist').onclick = () => { const t = track(player.current()); if (t) go('artist', t.artistKey); };
$('#lyricsBtn').onclick = () => stage.toggle();
$('#stageClose').onclick = () => stage.toggle(false);
$('#queueBtn').onclick = () => (route().name === 'queue' && !stage.open ? step(-1) : go('queue'));
$('#mute').onclick = () => setVolume(user.volume || 50, !user.muted && audio.volume > 0);
$('#volume').oninput = (e) => setVolume(Number(e.target.value));
$('#seek').addEventListener('input', (e) => {
  dragging = true;
  range(e.target);
  $('#time').textContent = clock((e.target.value / 1000) * (audio.duration || track(player.current())?.duration || 0));
});
$('#seek').addEventListener('change', (e) => {
  dragging = false;
  player.seek((e.target.value / 1000) * audio.duration);
  showTime();
});
audio.addEventListener('timeupdate', showTime);

addEventListener('keydown', (e) => {
  if (!user || document.querySelector('dialog[open]')) return;
  const typing = e.target.matches('input:not([type=range]):not([type=checkbox]), textarea, select');
  const ctrl = e.ctrlKey || e.metaKey;
  const done = () => e.preventDefault();
  if (ctrl && (e.code === 'KeyF' || e.code === 'KeyK')) { done(); $('#search').focus(); $('#search').select(); return; }
  if (e.key === 'Escape') {
    if (stage.open) stage.toggle(false);
    else if (e.target.id === 'search') { e.target.blur(); }
    return;
  }
  if (typing) return;
  if (e.altKey) {
    if (e.key === 'ArrowLeft') { done(); step(-1); }
    if (e.key === 'ArrowRight') { done(); step(1); }
    return;
  }
  if (ctrl) {
    if (e.key === 'ArrowLeft') { done(); player.prev(); }
    if (e.key === 'ArrowRight') { done(); player.next(); }
    if (e.key === 'ArrowUp') { done(); setVolume(user.volume + 5); }
    if (e.key === 'ArrowDown') { done(); setVolume(user.volume - 5); }
    return;
  }
  const onRange = e.target.matches('input[type=range]');
  if (e.code === 'Space') { done(); if (!e.repeat) toggle(); } else if (e.key === 'ArrowLeft' && !onRange) { done(); player.seek(audio.currentTime - 5); } else if (e.key === 'ArrowRight' && !onRange) { done(); player.seek(audio.currentTime + 5); } else if (e.code === 'KeyS') player.toggleShuffle();
  else if (e.code === 'KeyR') player.cycleRepeat();
  else if (e.code === 'KeyM') $('#mute').click();
  else if (e.code === 'KeyL') stage.toggle();
  else if (e.code === 'KeyQ') $('#queueBtn').click();
});
// пробел не должен «нажимать» ещё и выбранную кнопку
addEventListener('keyup', (e) => { if (e.code === 'Space' && e.target.matches('button')) e.preventDefault(); });
addEventListener('mouseup', (e) => {
  if (e.button === 3) step(-1);
  if (e.button === 4) step(1);
});

const media = {
  play: () => player.toggle(), pause: () => audio.pause(), previoustrack: () => player.prev(), nexttrack: () => player.next(),
  seekto: (d) => player.seek(d.seekTime), seekbackward: (d) => player.seek(audio.currentTime - (d.seekOffset || 10)), seekforward: (d) => player.seek(audio.currentTime + (d.seekOffset || 10)),
};
for (const [name, fn] of Object.entries(media)) navigator.mediaSession.setActionHandler(name, fn);

// файлы и папки, перетащенные из проводника
let depth = 0;
const outside = (e) => e.dataTransfer?.types.includes('Files') && !document.querySelector('dialog[open]');
addEventListener('dragenter', (e) => { if (outside(e)) { depth++; $('#dropzone').hidden = false; } });
addEventListener('dragleave', (e) => { if (outside(e) && --depth <= 0) { depth = 0; $('#dropzone').hidden = true; } });
addEventListener('dragover', (e) => { if (outside(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
addEventListener('drop', async (e) => {
  depth = 0;
  $('#dropzone').hidden = true;
  if (!outside(e)) return;
  e.preventDefault();
  const paths = [...e.dataTransfer.files].map((f) => api.pathFor(f)).filter(Boolean);
  const ids = await add('addPaths', paths);
  if (!ids.length) toast('Музыки в перетащенном не нашлось');
  else if (!player.playing) play(ids, 0);
});

/* ---------- запуск ---------- */

addEventListener('beforeunload', saveNow);
setInterval(() => { if (player.playing) saveNow(); }, 5000);

async function start() {
  const data = await api.library();
  user = cleanUser(data.user);
  setVolume(user.volume, user.muted);
  const saved = user.queue;
  accept(data);
  player.restore(saved);
  show();
  showNow();
  showControls();
  api.onLibrary(accept);
  api.onProgress((p) => {
    $('#scan').hidden = !p;
    if (!p) return;
    $('#scan span').textContent = `Читаю музыку: ${p.done} из ${p.total}`;
    $('#scan progress').value = p.total ? p.done / p.total : 0;
  });
  updates.version = await api.update.version();
  updates.text = `Версия ${updates.version}.`;
  showUpdates();
  setTimeout(() => checkUpdate(true), 4000);
  window.__kuplet = { ready: true, player, get lib() { return lib; }, get user() { return user; } };
}
start();
