import { $, h, icon, setIcon, clock, tracksWord, plural, duration, toast, menu, closeMenu, dialog, ask, confirmDialog } from './ui.js';
import { build, compare, search } from './model.js';
import { createPlayer } from './player.js';
import { createStage } from './stage.js';
import { findCovers, sureCover } from './online.js';
import { peaks, draw } from './wave.js';

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
    solo: Boolean(u.solo),
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

// цвет свечения вокруг пластинки по обложке
function glow(hash) {
  const hex = raw.covers[hash]?.color || '#8d4fd0';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hu = 0;
  if (d) hu = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const sat = d ? d / (1 - Math.abs(max + min - 1)) : 0;
  return `hsl(${Math.round(hu * 60)} ${Math.round(Math.min(0.75, sat) * 100)}% 52%)`;
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
    if (kind !== 'state') {
      showUpNext();
      if (route().name === 'queue') render();
    }
    showControls();
    saveUser();
  },
  onSkip: (id) => toast(`Не получилось открыть «${track(id)?.title || 'песню'}»`),
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
  changeCover: (id) => pickCover([id]),
  user: () => user,
  saveUser,
});

let artworkUrl = null;
let wave = { id: null, data: null };
async function showNow() {
  const t = track(player.current());
  paint($('#nowLabel'), coverOf(t), t?.title || '', true);
  $('#deck').style.setProperty('--glow', glow(coverOf(t)));
  $('#nowTitle').textContent = t?.title || 'Ничего не играет';
  $('#nowArtist').textContent = t?.artist || 'Выберите песню';
  $('#nowLike').hidden = !t;
  $('#stageLike').hidden = !t;
  showLike();
  showUpNext();
  document.title = t ? `${t.title} — ${t.artist}` : 'Куплет';
  stage.setTrack(t?.id || null);
  loadWave(t);
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

function loadWave(t) {
  const id = t?.id || null;
  if (id === wave.id) return;
  wave = { id, data: null };
  paintWaves();
  if (!id) return;
  peaks(id, t.duration).then((data) => {
    if (wave.id !== id) return;
    wave.data = data;
    paintWaves();
  });
}

function paintWaves() {
  draw($('#wave'), wave.data, $('#seek').value / 1000);
  draw($('#stageWave'), wave.data, $('#stageSeek').value / 1000);
}

// три ближайшие песни под проигрывателем
function showUpNext() {
  const s = player.state;
  const next = s.list.slice(s.index + 1, s.index + 4);
  $('#upnext').replaceChildren(...(next.length ? [
    h('div', { class: 'uphead' }, h('h2', {}, 'Дальше'), h('button', { class: 'text sub', onclick: () => go('queue') }, 'вся очередь')),
    ...next.map((id, k) => {
      const t = track(id);
      return t ? h('button', { class: 'up', onclick: () => player.jump(s.index + 1 + k) }, art(coverOf(t), t.title),
        h('span', {}, h('strong', {}, t.title), h('small', {}, t.artist))) : null;
    }).filter(Boolean),
  ] : []));
}

function showLike() {
  const on = user.favorites.includes(player.current());
  for (const b of [$('#nowLike'), $('#stageLike')]) {
    setIcon(b, on ? 'heartFull' : 'heart');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
}

function showControls() {
  const s = player.state;
  for (const b of [$('#play'), $('#stagePlay')]) {
    setIcon(b, player.playing ? 'pause' : 'play');
    b.setAttribute('aria-label', player.playing ? 'Пауза' : 'Играть');
  }
  document.body.classList.toggle('playing', player.playing);
  $('#shuffle').classList.toggle('on', s.shuffle);
  $('#shuffle').setAttribute('aria-pressed', s.shuffle);
  $('#repeat').classList.toggle('on', s.repeat !== 'off');
  $('#repeat').classList.toggle('one', s.repeat === 'one');
  $('#repeat').title = `Повтор: ${{ off: 'выключен', all: 'вся очередь', one: 'одна песня' }[s.repeat]} (R)`;
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
    for (const el of [$('#seek'), $('#stageSeek')]) el.value = total ? (now / total) * 1000 : 0;
    $('#time').textContent = clock(now);
    $('#stageTime').textContent = clock(now);
  }
  $('#length').textContent = clock(total);
  $('#stageLength').textContent = clock(total);
  paintWaves();
  // игла идёт от края пластинки к середине, на паузе отведена в сторону
  $('#deck').style.setProperty('--arm', `${player.playing ? 3 + (total ? now / total : 0) * 14 : -10}deg`);
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
  if (['favorites', 'playlists'].includes(route().name)) render();
  else {
    // остальные страницы не перерисовываем, чтобы списки не прыгали под мышкой
    for (const row of view.querySelectorAll('.row[data-id]')) heart(row);
    view.querySelector('.tape.fav')?.closest('.card')?.replaceWith(favoriteCard());
  }
  if (ids.length > 1) toast(add ? 'Добавлено в любимое' : 'Убрано из любимого');
}

function heart(row) {
  const b = row.querySelector('.heart');
  const on = user.favorites.includes(row.dataset.id);
  setIcon(b, on ? 'heartFull' : 'heart');
  b.classList.toggle('on', on);
  b.title = on ? 'Убрать из любимого' : 'В любимое';
}

// на этих страницах видны сами кассеты, поэтому после изменений их нужно перерисовать
const listsChanged = () => { if (['home', 'playlists'].includes(route().name)) render(); };

async function newPlaylist(ids = []) {
  const name = await ask('Новая кассета', `Кассета ${user.playlists.length + 1}`, 'Создать');
  if (!name) return;
  const list = { id: crypto.randomUUID(), name, ids: [...new Set(ids)] };
  user.playlists.push(list);
  saveUser();
  go('playlist', list.id);
}

function addToPlaylist(list, ids) {
  const fresh = [...new Set(ids)].filter((id) => !list.ids.includes(id));
  list.ids.push(...fresh);
  saveUser();
  if (route().name === 'playlist' && route().arg === list.id) render();
  listsChanged();
  toast(fresh.length ? `Записано на «${list.name}»: ${tracksWord(fresh.length)}` : `Уже есть на «${list.name}»`);
}

const playlistItems = (ids) => [
  { label: 'Новая кассета…', icon: 'plus', run: () => newPlaylist(ids) },
  user.playlists.length ? '-' : null,
  ...user.playlists.map((p) => ({ label: p.name, icon: 'tape', run: () => addToPlaylist(p, ids) })),
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
    { label: 'Записать на кассету', icon: 'tape', items: playlistItems(ids) },
    { label: liked ? 'Убрать из любимого' : 'В любимое', icon: liked ? 'heartFull' : 'heart', run: () => toggleLike(ids) },
    '-',
    one?.albumKey && { label: 'К пластинке', icon: 'album', run: () => go('album', one.albumKey) },
    one && { label: 'К исполнителю', icon: 'artist', run: () => go('artist', one.artistKey) },
    { label: 'Найти обложку', icon: 'search', run: () => pickCover(ids) },
    ids.some((id) => user.covers[id]) && { label: 'Вернуть обложку из файла', icon: 'close', run: () => { ids.forEach((id) => delete user.covers[id]); coversChanged(); } },
    one && { label: 'Показать в папке', icon: 'folder', run: () => api.reveal(one.id) },
    '-',
    where.playlist && { label: 'Убрать с кассеты', icon: 'close', run: () => where.remove() },
    where.queue && { label: 'Убрать из очереди', icon: 'close', run: () => where.remove() },
    { label: 'Убрать из библиотеки', icon: 'trash', danger: true, run: () => removeFromLibrary(ids) },
  ], x, y);
}

/* ---------- обложки из интернета ---------- */

function coversChanged() {
  saveUser();
  render();
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
    whole && h('label', { class: 'check' }, whole, `Для всей пластинки «${album.name}»`),
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

let observers = [];

// opts: playlist — объект; queue — номер первой строки в очереди; numbers: 'album'; flat — без названия пластинки;
// source — что включать, если показано только начало списка
function trackList(ids, opts = {}) {
  const queued = opts.queue !== undefined;
  const list = h('div', { class: `tracks${opts.flat ? ' flat' : ''}` });
  const selected = new Set();
  let anchor = 0;
  let shown = 0;

  const row = (id, i) => {
    const t = track(id);
    const glyph = (name, cls) => { const el = icon(name); el.classList.add(cls); return el; };
    const el = h('div', { class: 'row', 'data-id': id, 'data-i': i, draggable: 'true', tabindex: '0' },
      h('button', { class: 'n', 'aria-label': `Играть «${t.title}»`, tabindex: '-1' },
        opts.numbers === 'album' ? h('b', {}, String(t.no || i + 1)) : art(coverOf(t), t.title),
        glyph('play', 'i-play'), glyph('pause', 'i-pause'), h('span', { class: 'eq' }, h('i'), h('i'), h('i'))),
      h('div', { class: 'what' }, h('strong', {}, t.title),
        h('span', { class: 'by' }, h('button', { class: 'text sub artist', tabindex: '-1' }, t.artist),
          !opts.flat && t.album ? [', ', h('button', { class: 'text sub albumlink', tabindex: '-1' }, t.album)] : null)),
      h('span', { class: 'leader', 'aria-hidden': 'true' }),
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
  list.append(body, sentinel);
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
    else play(opts.source || ids, i);
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
    else if (e.target.closest('.albumlink')) go('album', t.albumKey);
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

  // перетаскивание: на кассету в лотке или на новое место в очереди и кассете
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
    // там, где песни переставляют местами, лоток закрывал бы нижние строки
    if (!sortable) showTray();
  });
  const clear = () => body.querySelectorAll('.above, .below').forEach((r) => r.classList.remove('above', 'below'));
  body.addEventListener('dragend', () => { from = null; clear(); hideTray(); });
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
const summary = (ids) => `${tracksWord(ids.length)}${ids.length ? `, ${duration(total(ids))}` : ''}`;
const disc = (hash) => h('span', { class: 'disc', 'aria-hidden': 'true' }, art(hash, '', 'label'));

// пластинка: конверт с обложкой, из которого выглядывает сам диск
const sleeve = (hash, name, full) => h('div', { class: 'sleeve' }, disc(hash), art(hash, name, 'jacket', full));

// кассета: наклейка с названием и окошко с двумя катушками
function tape(name, ids, fav = false) {
  const hash = coverFrom(ids);
  return h('div', { class: `tape${fav ? ' fav' : ''}`, style: fav ? null : `--hue: ${hue(name)}` },
    h('div', { class: 'sticker' }, fav ? h('span', { class: 'mark' }, icon('heartFull')) : hash ? art(hash, name) : null, h('b', {}, name)),
    h('div', { class: 'window', 'aria-hidden': 'true' }, h('i', { class: 'reel' }), h('i', { class: 'reel' })),
  );
}

const arch = (hash, name, full) => art(hash, name, 'arch', full);

const head = (title, meta, actions) => h('header', { class: 'head' },
  h('div', {}, h('h1', {}, title), meta && h('p', { class: 'meta' }, meta)),
  actions && h('div', { class: 'actions' }, actions));

function hero({ kind, title, meta, face, actions }) {
  return h('div', { class: `hero ${kind}` }, face,
    h('div', { class: 'about' }, h('h1', { class: title.length > 28 ? 'long' : '' }, title), meta && h('p', { class: 'meta' }, meta),
      actions && h('div', { class: 'actions' }, actions)));
}

const playButtons = (ids, extra = []) => [
  h('button', { class: 'play big primary', 'aria-label': 'Слушать всё', disabled: !ids.length, onclick: () => play(ids, 0, false) }, icon('play'), 'Слушать'),
  h('button', { disabled: ids.length < 2, onclick: () => play(ids, -1, true) }, icon('shuffle'), 'Вперемешку'),
  ...extra,
];

const more = (items) => h('button', { class: 'icon', title: 'Ещё', 'aria-label': 'Ещё', onclick: (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(items(), r.left, r.bottom + 4);
} }, icon('more'));

function card({ kind, title, sub, face, open, ids, context }) {
  return h('div', { class: `card ${kind}`, oncontextmenu: context && ((e) => { e.preventDefault(); menu(context(), e.clientX, e.clientY); }) },
    h('div', { class: 'face' }, face, ids.length ? h('button', { class: 'play', 'aria-label': `Играть «${title}»`, onclick: () => play(ids, 0, false) }, icon('play')) : null),
    h('button', { class: 'open', onclick: open }, h('strong', {}, title), h('span', {}, sub)));
}
const albumCard = (a) => card({ kind: 'record', title: a.name, sub: a.artist, face: sleeve(coverFrom(a.ids), a.name), ids: a.ids, open: () => go('album', a.key) });
const artistCard = (a) => card({ kind: 'person', title: a.name, sub: tracksWord(a.ids.length), face: arch(coverFrom(a.ids), a.name), ids: a.ids, open: () => go('artist', a.key) });
const tapeCard = (p) => {
  const ids = known(p.ids);
  return card({ kind: 'cassette', title: p.name, sub: tracksWord(ids.length), face: tape(p.name, ids), ids, open: () => go('playlist', p.id), context: () => playlistActions(p) });
};
const favoriteCard = () => {
  const ids = favoriteIds();
  return card({ kind: 'cassette', title: 'Любимые', sub: tracksWord(ids.length), face: tape('Любимые', ids, true), ids, open: () => go('favorites') });
};
const tapes = () => [favoriteCard(), ...user.playlists.map(tapeCard)];

const section = (title, content, aside) => h('section', {},
  h('div', { class: 'shelfhead' }, h('h2', {}, title), aside), content);
const showAll = (run) => h('button', { class: 'text sub', onclick: run }, 'Показать все');

// shelf — один ряд, лишнее прячется; wall — всё сразу
const shelf = (title, cards, all, kind = '') => (cards.length ? section(title, h('div', { class: `grid shelf ${kind}` }, cards), all && showAll(all)) : null);
const wall = (cards, kind) => h('div', { class: `grid ${kind}` }, cards);

const nothing = (title, text, ...actions) => h('div', { class: 'nothing' }, h('h2', {}, title), h('p', {}, text), actions.length ? h('div', { class: 'actions' }, actions) : null);

const welcome = () => h('div', { class: 'welcome' }, sleeve(null, ''), nothing('Здесь будет ваша музыка',
  raw.scanning ? 'Читаю файлы — песни появятся через несколько секунд.' : 'Выберите папку с песнями или перетащите файлы прямо в окно. Программа только читает их и ничего не меняет.',
  h('button', { class: 'primary', onclick: () => add('addFolder') }, icon('folder'), 'Выбрать папку'),
  h('button', { onclick: () => add('addFiles') }, 'Добавить файлы')));

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
    if (!lib.tracks.size) return [head('Полка'), welcome()];
    const albums = [...lib.albums.values()].sort((a, b) => b.added - a.added);
    const newest = allIds('added');
    const recent = known(user.recent);
    const often = Object.keys(user.plays).filter((id) => lib.tracks.has(id) && user.plays[id] > 1).sort((a, b) => user.plays[b] - user.plays[a]).slice(0, 40);
    const short = (title, ids, all) => section(title, trackList(ids.slice(0, 6), { flat: true, source: ids }), all && showAll(all));
    const lists = [
      recent.length ? short('Вы слушали', recent) : null,
      often.length ? short('Часто на повторе', often) : null,
    ].filter(Boolean);
    if (lists.length < 2) lists.push(short('Недавно добавленные', newest.slice(0, 50), () => { user.sort = 'added'; go('tracks'); }));
    return [
      head('Полка', summary(newest), h('button', { class: 'primary', onclick: () => play(allIds('title'), -1, true) }, icon('shuffle'), 'Вперемешку всё')),
      h('div', { class: 'duo' }, lists),
      shelf('Новые пластинки', albums.slice(0, 12).map(albumCard), () => go('albums'), 'records'),
      shelf('Кассеты', tapes(), () => go('playlists'), 'cassettes'),
      shelf('Артисты', [...lib.artists.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, 12).map(artistCard), () => go('artists'), 'people'),
    ];
  },

  search(query) {
    if (!query?.trim()) {
      return [head('Поиск', 'Начните печатать вверху: название песни, артиста или пластинки.'),
        shelf('Артисты', [...lib.artists.values()].sort((a, b) => compare(a.name, b.name)).slice(0, 24).map(artistCard), () => go('artists'), 'people')];
    }
    const found = search(lib, query);
    const ids = found.tracks.map((t) => t.id);
    if (!ids.length && !found.albums.length && !found.artists.length) return [nothing('Ничего не нашлось', `По запросу «${query.trim()}» в вашей музыке ничего нет.`)];
    return [
      shelf('Артисты', found.artists.slice(0, 12).map(artistCard), null, 'people'),
      shelf('Пластинки', found.albums.slice(0, 12).map(albumCard), null, 'records'),
      ids.length ? section('Песни', trackList(ids), h('span', { class: 'sub' }, tracksWord(ids.length))) : null,
    ];
  },

  tracks() {
    const ids = allIds(user.sort);
    const sort = h('select', { 'aria-label': 'Сортировка', onchange: (e) => { user.sort = e.target.value; saveUser(); route().rows = 0; render(); } },
      [['title', 'По названию'], ['artist', 'По артисту'], ['album', 'По пластинке'], ['added', 'Сначала новые'], ['duration', 'По длительности']]
        .map(([v, label]) => h('option', { value: v, selected: v === user.sort }, label)));
    return [
      head('Песни', summary(ids), ids.length ? [...playButtons(ids), sort] : null),
      ids.length ? trackList(ids) : welcome(),
    ];
  },

  albums() {
    const list = [...lib.albums.values()].sort((a, b) => compare(a.name, b.name));
    return [head('Пластинки', list.length ? plural(list.length, 'пластинка', 'пластинки', 'пластинок') : null),
      list.length ? wall(list.map(albumCard), 'records')
        : lib.tracks.size ? nothing('Пластинок нет', 'В тегах ваших файлов не указаны названия альбомов. Все песни есть в разделе «Песни».') : welcome()];
  },

  album(key) {
    const a = lib.albums.get(key);
    if (!a) return gone();
    const cover = coverFrom(a.ids);
    const artist = lib.tracks.get(a.ids[0]);
    return [
      hero({
        kind: 'record', title: a.name, face: sleeve(cover, a.name, true),
        meta: [a.artist === 'Разные исполнители' ? a.artist : h('button', { class: 'text', onclick: () => go('artist', artist.artistKey) }, a.artist), `, ${a.year ? `${a.year}, ` : ''}${summary(a.ids)}`],
        actions: playButtons(a.ids, [more(() => [
          { label: 'Добавить в очередь', icon: 'queue', run: () => { player.enqueue(a.ids); toast('Добавлено в очередь'); } },
          { label: 'Записать на кассету', icon: 'tape', items: playlistItems(a.ids) },
          { label: 'Найти обложку', icon: 'search', run: () => pickCover([a.ids[0]]) },
        ])]),
      }),
      trackList(a.ids, { flat: true, numbers: 'album' }),
    ];
  },

  artists() {
    const list = [...lib.artists.values()].sort((a, b) => compare(a.name, b.name));
    return [head('Артисты', list.length ? plural(list.length, 'артист', 'артиста', 'артистов') : null), list.length ? wall(list.map(artistCard), 'people') : welcome()];
  },

  artist(key) {
    const a = lib.artists.get(key);
    if (!a) return gone();
    const cover = coverFrom(a.ids);
    const albums = [...a.albums].map((k) => lib.albums.get(k)).sort((x, y) => y.year - x.year || compare(x.name, y.name));
    return [
      hero({ kind: 'person', title: a.name, face: arch(cover, a.name, true), meta: summary(a.ids), actions: playButtons(a.ids) }),
      albums.length ? section('Пластинки', wall(albums.map(albumCard), 'records')) : null,
      section('Песни', trackList(a.ids)),
    ];
  },

  playlists() {
    return [
      head('Кассеты', 'Ваши подборки песен', h('button', { class: 'primary', id: 'newList', onclick: () => newPlaylist() }, icon('plus'), 'Новая кассета')),
      wall(tapes(), 'cassettes'),
      user.playlists.length ? null : h('p', { class: 'sub hint' }, 'Чтобы записать песни на кассету, потяните их мышкой или откройте меню песни правой кнопкой.'),
    ];
  },

  favorites() {
    const ids = favoriteIds();
    return [
      hero({ kind: 'cassette', title: 'Любимые', meta: summary(ids), face: tape('Любимые', ids, true), actions: ids.length ? playButtons(ids) : null }),
      ids.length ? trackList(ids) : nothing('Пока пусто', 'Нажмите на сердечко у песни — она появится здесь.'),
    ];
  },

  playlist(id) {
    const p = user.playlists.find((x) => x.id === id);
    if (!p) return gone();
    const ids = known(p.ids);
    return [
      hero({
        kind: 'cassette', title: p.name, meta: summary(ids), face: tape(p.name, ids),
        actions: playButtons(ids, [more(() => playlistActions(p))]),
      }),
      ids.length ? trackList(ids, { playlist: p }) : nothing('На кассете пока пусто', 'Откройте песни, нажмите на нужную правой кнопкой и выберите «Записать на кассету». Или перетащите песни мышкой в появившийся лоток.',
        h('button', { onclick: () => go('tracks') }, 'Открыть песни')),
    ];
  },

  queue() {
    const s = player.state;
    const now = track(player.current());
    if (!now) return [head('Очередь'), nothing('Очередь пуста', 'Включите любую песню — дальше пойдут остальные из того же списка.')];
    const next = s.list.slice(s.index + 1);
    return [
      head('Очередь'),
      section('Сейчас играет', trackList([now.id], { queue: s.index })),
      section('Дальше',
        next.length ? trackList(next, { queue: s.index + 1 }) : h('p', { class: 'sub' }, s.repeat === 'all' ? 'После этой песни очередь начнётся заново.' : 'Это последняя песня в очереди.'),
        next.length ? h('button', { class: 'text sub', onclick: () => player.clearUpcoming() }, 'Очистить') : null),
    ];
  },

  settings() {
    const online = h('input', { type: 'checkbox', checked: user.online, onchange: (e) => { user.online = e.target.checked; saveUser(); } });
    const files = lib.tracks.size;
    return [
      head('Настройки'),
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
      h('p', { class: 'sub foot' }, 'Разработано GwebStudio'),
    ];
  },
};

function gone() {
  return [nothing('Здесь больше пусто', 'Эта страница пропала из библиотеки.', h('button', { onclick: () => go('home') }, 'На полку'))];
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

/* ---------- вкладки и лоток с кассетами ---------- */

function markMenu() {
  const r = route();
  const key = { album: 'albums', artist: 'artists', playlist: 'playlists', favorites: 'playlists' }[r.name] || r.name;
  for (const b of document.querySelectorAll('#top [data-route]')) {
    if (b.dataset.route === key) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  $('#queueBtn').classList.toggle('on', r.name === 'queue');
}

let trayTimer = 0;
// пока песни тянут мышкой, внизу видно, куда их можно положить
function showTray() {
  const chip = (key, label, ic, run) => {
    const el = h('div', { class: 'chip', 'data-list': key }, icon(ic), h('span', {}, label));
    dropTarget(el, (ids) => { hideTray(); run(ids); });
    return el;
  };
  $('#tray').replaceChildren(
    h('p', {}, 'Отпустите на кассете'),
    h('div', { class: 'chips' },
      chip('favorites', 'Любимые', 'heart', (ids) => {
        const fresh = ids.filter((id) => !user.favorites.includes(id));
        if (fresh.length) toggleLike(fresh);
        toast(fresh.length ? `Записано в любимые: ${tracksWord(fresh.length)}` : 'Уже есть в любимых');
      }),
      user.playlists.map((p) => chip(p.id, p.name, 'tape', (ids) => addToPlaylist(p, ids))),
      chip('new', 'Новая кассета', 'plus', newPlaylist)),
  );
  // показываем чуть позже: иначе Chrome сразу отменяет перетаскивание
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => { $('#tray').hidden = false; }, 30);
}

function hideTray() {
  clearTimeout(trayTimer);
  $('#tray').hidden = true;
}
addEventListener('dragend', hideTray);

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
      const name = await ask('Название кассеты', p.name);
      if (!name) return;
      p.name = name;
      saveUser();
      render();
    } },
    '-',
    { label: 'Удалить кассету', icon: 'trash', danger: true, run: async () => {
      if (!await confirmDialog('Удалить кассету?', `«${p.name}» будет удалена. Песни останутся в библиотеке.`, 'Удалить')) return;
      user.playlists = user.playlists.filter((x) => x !== p);
      saveUser();
      if (route().name === 'playlist' && route().arg === p.id) go('playlists');
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
for (const b of document.querySelectorAll('#top [data-route]')) b.onclick = () => go(b.dataset.route);
$('#updatePill').onclick = installUpdate;
$('#addMusic').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  menu([
    { label: 'Папку с музыкой', icon: 'folder', run: () => add('addFolder') },
    { label: 'Отдельные файлы', icon: 'note', run: () => add('addFiles') },
  ], r.right - 224, r.bottom + 6);
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
for (const el of [$('#play'), $('#stagePlay')]) el.onclick = toggle;
for (const el of [$('#prev'), $('#stagePrev')]) el.onclick = () => player.prev();
for (const el of [$('#next'), $('#stageNext')]) el.onclick = () => player.next();
$('#shuffle').onclick = () => player.toggleShuffle();
$('#repeat').onclick = () => player.cycleRepeat();
for (const el of [$('#nowLike'), $('#stageLike')]) el.onclick = () => player.current() && toggleLike([player.current()]);
$('#nowCover').onclick = () => player.current() && stage.toggle();
$('#nowTitle').onclick = () => { const t = track(player.current()); if (t) go(t.albumKey ? 'album' : 'queue', t.albumKey); };
$('#nowArtist').onclick = () => { const t = track(player.current()); if (t) go('artist', t.artistKey); };
$('#lyricsBtn').onclick = () => stage.toggle();
$('#stageClose').onclick = () => stage.toggle(false);
$('#queueBtn').onclick = () => (route().name === 'queue' && !stage.open ? step(-1) : go('queue'));
$('#mute').onclick = () => setVolume(user.volume || 50, !user.muted && audio.volume > 0);
$('#volume').oninput = (e) => setVolume(Number(e.target.value));
for (const [input, label] of [[$('#seek'), $('#time')], [$('#stageSeek'), $('#stageTime')]]) {
  input.addEventListener('input', () => {
    dragging = true;
    label.textContent = clock((input.value / 1000) * (audio.duration || track(player.current())?.duration || 0));
    paintWaves();
  });
  input.addEventListener('change', () => {
    dragging = false;
    player.seek((input.value / 1000) * audio.duration);
    showTime();
  });
}
// волна рисуется заново, когда меняется её размер: окно, разворот с текстом
const waveSize = new ResizeObserver(paintWaves);
for (const el of [$('#wave'), $('#stageWave')]) waveSize.observe(el);
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
