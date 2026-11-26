import { Renderer, fmt } from './render.js';
import { parseNotices } from './deck.js';
import { parseLrc, buildTimeline, toLrc } from './lyrics.js';
import { readTags, parseFileName, searchCovers, searchLyrics } from './sources.js';
import { exportVideo } from './export.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const view = $('view');
const g = view.getContext('2d', { alpha: false });
const wave = $('wave');
const renderer = new Renderer();

const state = {
  buffer: null, duration: 0, from: 0, to: 0, parsed: [], offset: 0,
  tags: {}, loadId: 0, searchId: 0, coverId: 0,
  stopAt: null, tap: null, exporting: false, url: null, resultUrl: null, result: null,
};

const status = (id, text, bad = false) => {
  $(id).textContent = text;
  $(id).classList.toggle('bad', bad);
};

/* ---------- загрузка трека ---------- */

async function loadTrack(file) {
  const id = ++state.loadId;
  state.allowNoText = false;
  state.searchId++;
  state.coverId++;
  exitTap();
  audio.pause();
  $('fileName').textContent = 'Читаю файл…';
  $('play').disabled = $('export').disabled = $('search').disabled = true;
  let buffer;
  try {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    if (id !== state.loadId) return;
    $('fileName').textContent = 'Выбрать песню';
    status('lyricStatus', `Не получилось прочитать «${file.name}». Попробуйте MP3, M4A или WAV.`, true);
    state.buffer = null;
    return;
  }
  const tags = await readTags(file);
  if (id !== state.loadId) return;

  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  audio.src = state.url;
  Object.assign(state, { buffer, duration: buffer.duration, parsed: [], offset: 0, tags });
  $('offset').value = 0;
  $('offsetOut').textContent = '0.0 с';
  $('lrc').value = '';
  $('variants').hidden = true;
  $('covers').textContent = '';
  renderer.setCover(null);
  renderer.duration = buffer.duration;
  renderer.envelope = envelope(buffer);
  renderer.emptyText = '';
  renderer.setLyrics([]);
  buildPeaks();
  setFragment(0, Math.min(30, buffer.duration));

  const guess = parseFileName(file.name);
  $('artist').value = tags.artist || guess.artist;
  $('title').value = tags.title || guess.title;
  updateMeta();
  $('fileName').textContent = file.name;
  $('play').disabled = $('export').disabled = $('search').disabled = false;
  $('result').hidden = true;
  status('exportStatus', '');

  if (tags.cover) addCover({ blob: tags.cover, label: 'из файла' }, true);
  search();
}

function envelope(buffer, rate = 30) {
  const d = buffer.getChannelData(0);
  const step = Math.floor(buffer.sampleRate / rate);
  const data = new Float32Array(Math.ceil(d.length / step));
  let max = 1e-6;
  for (let i = 0; i < data.length; i++) {
    let sum = 0, n = 0;
    for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j += 4) { sum += d[j] * d[j]; n++; }
    data[i] = Math.sqrt(sum / (n || 1));
    max = Math.max(max, data[i]);
  }
  for (let i = 0; i < data.length; i++) data[i] = (data[i] / max) ** 2;
  return { data, rate };
}

function updateMeta() {
  renderer.meta = { artist: $('artist').value.trim(), title: $('title').value.trim() };
}

/* ---------- поиск ---------- */

async function search() {
  if (!state.buffer) return;
  const id = ++state.searchId;
  const artist = $('artist').value.trim();
  const title = $('title').value.trim();
  if (!title) { status('lyricStatus', 'Впишите название песни и нажмите «Найти».', true); return; }
  status('coverStatus', 'Ищу обложку…');
  status('lyricStatus', 'Ищу текст…');
  $('covers').querySelectorAll('[data-found]').forEach((e) => e.remove());

  searchCovers(artist, title).then(({ list, failed }) => {
    if (id !== state.searchId) return;
    if (!list.length) {
      status('coverStatus', failed ? 'Нет связи с сервисами обложек. Проверьте интернет или загрузите свою картинку.' : 'Обложка не нашлась. Уточните название или загрузите свою.', true);
      return;
    }
    status('coverStatus', 'Нажмите на картинку, чтобы выбрать другую.');
    const buttons = list.map((c) => addCover({ ...c, found: true, label: c.kind === 'artist' ? 'артист' : '' }, false));
    // сами ставим лучшую, только если она действительно похожа на трек
    if (!state.tags.cover && !$('covers').querySelector('[aria-pressed=true]')) {
      if (list[0].score >= (artist ? 2.5 : 1.4)) buttons[0].click();
      else status('coverStatus', 'Точного совпадения нет — выберите картинку вручную.');
    }
  });

  const { list, failed } = await searchLyrics(artist, title, state.duration);
  if (id !== state.searchId) return;
  const select = $('variants');
  select.textContent = '';
  if (!list.length) {
    select.hidden = true;
    status('lyricStatus', failed ? 'Нет связи с базой текстов. Проверьте интернет или вставьте текст вручную.' : 'Текст не нашёлся. Вставьте его ниже и разметьте в такт.', true);
    $('editorBox').open = true;
    return;
  }
  for (const v of list) {
    const o = document.createElement('option');
    o.textContent = `${v.synced ? '⏱' : '📄'} ${v.artist} — ${v.title}${v.duration ? ` (${fmt(v.duration)})` : ''}`;
    select.append(o);
  }
  select.hidden = false;
  select.onchange = () => useVariant(list[select.selectedIndex]);
  if (list[0].match) useVariant(list[0]);
  else {
    select.selectedIndex = -1;
    status('lyricStatus', 'Есть только похожие песни. Выберите вариант из списка или вставьте свой текст.', true);
  }
}

function useVariant(v) {
  $('offset').value = 0;
  state.offset = 0;
  $('offsetOut').textContent = '0.0 с';
  if (v.synced) {
    $('lrc').value = v.synced;
    applyLyrics(parseLrc(v.synced));
    const diff = Math.round(v.diff);
    if (v.duration && diff > 3) status('lyricStatus', `Текст найден, но эта версия отличается по длине на ${diff} с. Проверьте синхронность и подвиньте сдвиг.`, true);
    else status('lyricStatus', 'Синхронный текст найден.');
  } else {
    $('lrc').value = v.plain;
    applyLyrics([]);
    $('editorBox').open = true;
    status('lyricStatus', 'Нашёлся текст без таймингов. Нажмите «Разметить в такт».', true);
  }
}

function applyLyrics(parsed) {
  state.parsed = parsed;
  renderer.setLyrics(buildTimeline(parsed, state.duration, state.offset));
  // фрагмент по умолчанию начинаем незадолго до первой строки
  const first = renderer.items.find((i) => !i.dots);
  if (first && state.from === 0 && state.to < state.duration) {
    const from = Math.max(0, first.time - 2);
    setFragment(from, from + (state.to - state.from));
  }
  if (audio.paused && first) audio.currentTime = state.from;
}

/* ---------- обложки ---------- */

async function loadImage(src) {
  if (src instanceof Blob) return createImageBitmap(src);
  const r = await fetch(src, { mode: 'cors', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(r.status);
  return createImageBitmap(await r.blob());
}

function addCover(c, select) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  const thumbUrl = c.blob ? URL.createObjectURL(c.blob) : c.thumb;
  img.src = thumbUrl;
  img.alt = c.blob ? `Обложка ${c.label}` : `${c.artist} — ${c.album}`;
  b.title = img.alt;
  b.append(img);
  if (c.found) b.dataset.found = '1';
  if (c.label) { const s = document.createElement('small'); s.textContent = c.label; b.append(s); }
  b.onclick = async () => {
    const id = ++state.coverId;
    try {
      const bitmap = await loadImage(c.blob || c.full);
      if (id !== state.coverId) return;
      renderer.setCover(bitmap);
      if (renderer.autoAccent) $('accent').value = `#${renderer.accentRgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      $('covers').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    } catch {
      status('coverStatus', 'Эта картинка не загрузилась, выберите другую.', true);
    }
  };
  $('covers').append(b);
  if (select) b.click();
  return b;
}

/* ---------- шкала и фрагмент ---------- */

let peaks = [];
function buildPeaks() {
  const e = renderer.envelope.data;
  peaks = Array.from({ length: 160 }, (_, i) => {
    const a = Math.floor((i * e.length) / 160), b = Math.max(a + 1, Math.floor(((i + 1) * e.length) / 160));
    let s = 0;
    for (let j = a; j < b; j++) s += Math.sqrt(e[j] || 0);
    return s / (b - a);
  });
}

function setFragment(from, to) {
  const d = state.duration;
  const len = Math.min(d, Math.max(3, to - from));
  from = Math.max(0, Math.min(from, d - len));
  state.from = from;
  state.to = from + len;
  renderer.clip = { from: state.from, to: state.to };
  $('range').textContent = `видео: ${fmt(from)}–${fmt(from + len)} (${Math.round(len)} с)`;
  $('total').textContent = fmt(d);
}

function drawWave() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(wave.clientWidth * dpr), h = Math.round(44 * dpr);
  if (!w) return;
  if (wave.width !== w || wave.height !== h) { wave.width = w; wave.height = h; }
  const c = wave.getContext('2d');
  c.clearRect(0, 0, w, h);
  const d = state.duration;
  const n = peaks.length;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * d;
    const inside = t >= state.from && t <= state.to;
    c.fillStyle = inside ? (t <= audio.currentTime ? '#ff6b4a' : '#f2f1ee') : '#4a4e59';
    const bh = Math.max(2 * dpr, peaks[i] * h * 0.9);
    c.fillRect((i * w) / n, (h - bh) / 2, Math.max(1, w / n - dpr), bh);
  }
  if (!d) return;
  c.fillStyle = '#ff6b4a';
  for (const t of [state.from, state.to]) c.fillRect(Math.min(w - 4 * dpr, Math.max(0, (t / d) * w - 2 * dpr)), 0, 4 * dpr, h);
  c.fillStyle = '#fff';
  c.fillRect((audio.currentTime / d) * w, 0, dpr, h);
}

let drag = null;
const waveTime = (e) => {
  const r = wave.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * state.duration;
};
wave.addEventListener('pointerdown', (e) => {
  if (!state.buffer || state.tap) return;
  const t = waveTime(e);
  const near = (12 / wave.clientWidth) * state.duration;
  if (Math.abs(t - state.from) < near && Math.abs(t - state.from) <= Math.abs(t - state.to)) drag = 'from';
  else if (Math.abs(t - state.to) < near) drag = 'to';
  else { drag = 'seek'; state.stopAt = null; audio.currentTime = t; }
  wave.setPointerCapture(e.pointerId);
});
wave.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const t = waveTime(e);
  if (drag === 'from') { setFragment(Math.min(t, state.to - 3), state.to); audio.currentTime = state.from; }
  else if (drag === 'to') setFragment(state.from, Math.max(t, state.from + 3));
  else audio.currentTime = t;
});
['pointerup', 'pointercancel'].forEach((n) => wave.addEventListener(n, () => { drag = null; }));

$('fragment').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !state.buffer || state.tap) return;
  if (b.dataset.len !== undefined) {
    const len = Number(b.dataset.len) || state.duration;
    setFragment(state.from, state.from + len);
    audio.currentTime = state.from;
  } else if (b.id === 'fromHere') {
    const len = state.to - state.from;
    setFragment(audio.currentTime, audio.currentTime + (len >= state.duration - 0.1 ? 30 : len));
  } else {
    audio.currentTime = state.from;
    state.stopAt = state.to;
    audio.play();
  }
});

/* ---------- воспроизведение ---------- */

function toggle() {
  if (!state.buffer || state.exporting) return;
  state.stopAt = null;
  if (audio.paused) audio.play(); else audio.pause();
}
$('play').onclick = toggle;
view.onclick = () => { if (!state.tap) toggle(); };
audio.onplay = () => { $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Пауза'); };
audio.onpause = () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Играть'); };

// currentTime обновляется ступеньками — сглаживаем по часам браузера
let clock = { media: 0, wall: 0 };
function mediaTime(now) {
  const m = audio.currentTime;
  if (audio.paused || audio.seeking) { clock = { media: m, wall: now }; return m; }
  const guess = clock.media + (now - clock.wall) / 1000;
  if (Math.abs(guess - m) > 0.08) { clock = { media: m, wall: now }; return m; }
  return guess;
}

function frame(now) {
  if (!state.exporting) {
    const t = mediaTime(now);
    if (state.stopAt != null && t >= state.stopAt) { audio.pause(); state.stopAt = null; }
    syncCardVideo(t);
    renderer.draw(g, state.buffer ? t : 2.2, { guides: $('guides').checked });
    $('now').textContent = fmt(t);
    drawWave();
  }
  requestAnimationFrame(frame);
}

/* ---------- разметка в такт ---------- */

function startTap() {
  const lines = $('lrc').value.split(/\r?\n/).map((l) => l.replace(/\[[^\]]*\]|<[\d:.,]+>/g, '').trim()).filter(Boolean);
  if (!state.buffer) return status('lyricStatus', 'Сначала загрузите песню.', true);
  if (!lines.length) return status('lyricStatus', 'Сначала вставьте текст построчно.', true);
  state.tap = { lines, done: [], i: 0, before: state.parsed };
  state.offset = 0;
  state.stopAt = null;
  $('offset').value = 0;
  $('offsetOut').textContent = '0.0 с';
  $('tap').hidden = false;
  $('editorBox').hidden = $('offsetRow').hidden = true;
  $('variants').disabled = true;
  audio.currentTime = 0;
  audio.play();
  tapRefresh();
  $('tapMark').focus();
}

function tapRefresh() {
  const s = state.tap;
  $('tapPrev').textContent = s.i ? s.lines[s.i - 1] : '';
  $('tapNext').textContent = s.lines[s.i] ?? 'Все строки отмечены';
  $('tapMark').disabled = s.i >= s.lines.length;
  renderer.setLyrics(buildTimeline(s.done, state.duration));
}

function tapMark(gap = false) {
  const s = state.tap;
  if (!s || (!gap && s.i >= s.lines.length) || (gap && !s.done.length)) return;
  s.done.push({ time: Math.max(0, audio.currentTime - 0.08), text: gap ? '' : s.lines[s.i] });
  if (!gap) s.i++;
  if (audio.paused) audio.play();
  tapRefresh();
}

function tapUndo() {
  const s = state.tap;
  const last = s?.done.pop();
  if (!last) return;
  if (last.text) s.i--;
  audio.currentTime = Math.max(0, last.time - 3);
  tapRefresh();
}

function exitTap(save = false) {
  const s = state.tap;
  if (!s) return;
  state.tap = null;
  audio.pause();
  $('tap').hidden = true;
  $('editorBox').hidden = $('offsetRow').hidden = false;
  $('variants').disabled = false;
  if (save && s.done.length) {
    const rest = s.lines.slice(s.i);
    $('lrc').value = [toLrc(s.done), ...rest].join('\n');
    applyLyrics(s.done);
    status('lyricStatus', rest.length ? `Размечено строк: ${s.i}. Осталось без тайминга: ${rest.length}.` : 'Текст размечен.', rest.length > 0);
  } else renderer.setLyrics(buildTimeline(s.before, state.duration));
}

$('tapStart').onclick = startTap;
$('tapMark').onclick = () => tapMark();
$('tapGap').onclick = () => tapMark(true);
$('tapUndo').onclick = tapUndo;
$('tapDone').onclick = () => exitTap(true);
$('tapCancel').onclick = () => exitTap(false);

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || state.exporting) return;
  if (state.tap) { e.preventDefault(); if (!e.repeat) tapMark(); return; }
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY|A|VIDEO)$/.test(e.target.tagName)) return;
  e.preventDefault();
  toggle();
});
// чтобы пробел во время разметки не нажимал кнопку второй раз
document.addEventListener('keyup', (e) => { if (state.tap && e.code === 'Space') e.preventDefault(); });

/* ---------- элементы управления ---------- */

$('file').onchange = (e) => { if (e.target.files[0]) loadTrack(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragover', 'drop'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
document.addEventListener('dragover', () => drop.classList.add('over'));
['dragleave', 'drop'].forEach((n) => document.addEventListener(n, () => drop.classList.remove('over')));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files[0];
  if (!f || state.exporting) return;
  if (f.type.startsWith('image/')) addCover({ blob: f, label: 'своя' }, true);
  else if (/\.(lrc|txt)$/i.test(f.name)) openLrc(f);
  else loadTrack(f);
});

$('searchForm').onsubmit = (e) => { e.preventDefault(); updateMeta(); search(); };
$('artist').oninput = $('title').oninput = updateMeta;
$('coverFile').onchange = (e) => { if (e.target.files[0]) addCover({ blob: e.target.files[0], label: 'своя' }, true); e.target.value = ''; };

$('offset').oninput = (e) => {
  state.offset = Number(e.target.value);
  $('offsetOut').textContent = `${state.offset > 0 ? '+' : ''}${state.offset.toFixed(1)} с`;
  renderer.setLyrics(buildTimeline(state.parsed, state.duration, state.offset));
};

function applyText() {
  const parsed = parseLrc($('lrc').value);
  if (!parsed.some((l) => l.text)) return status('lyricStatus', 'В тексте нет таймингов. Нажмите «Разметить в такт».', true);
  state.offset = 0;
  $('offset').value = 0;
  $('offsetOut').textContent = '0.0 с';
  applyLyrics(parsed);
  status('lyricStatus', 'Текст применён.');
}
$('applyLrc').onclick = applyText;
async function openLrc(file) {
  const bytes = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('windows-1251').decode(bytes); }
  $('lrc').value = text;
  $('editorBox').open = true;
  applyText();
}
$('lrcFile').onchange = (e) => { if (e.target.files[0]) openLrc(e.target.files[0]); e.target.value = ''; };

$('layouts').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $('layouts').querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  renderer.setStyle({ layout: b.dataset.layout });
  syncView();
};
$('scale').oninput = (e) => renderer.setStyle({ scale: Number(e.target.value) });
for (const key of ['karaoke', 'blur', 'motion', 'progress']) $(key).onchange = (e) => renderer.setStyle({ [key]: e.target.checked });
$('nick').oninput = (e) => renderer.setStyle({ nick: e.target.value.trim() });

/* ---------- стиль «Панель» ---------- */

function syncView() {
  const { layout } = renderer.style;
  view.width = renderer.width;
  view.height = renderer.height;
  const wide = renderer.width > renderer.height;
  document.body.classList.toggle('wide', wide);
  $('deckOptions').hidden = !layout.startsWith('deck');
  $('widgetOptions').hidden = layout !== 'deck';
  $('progressRow').hidden = layout.startsWith('deck');
  $('guidesRow').hidden = wide;
  $('export').textContent = `Создать видео ${renderer.width}×${renderer.height}`;
}

for (const key of ['clock', 'date', 'leftTitle', 'leftValue', 'leftCaption', 'rightTitle']) {
  $(key).oninput = (e) => { renderer.deck[key] = e.target.value.trim(); };
}
for (const key of ['mono', 'rain']) $(key).onchange = (e) => { renderer.deck[key] = e.target.checked; };
$('notices').oninput = (e) => {
  renderer.deck.notices = parseNotices(e.target.value);
  const typed = e.target.value.split('\n').filter((l) => l.trim()).length;
  const bad = typed - renderer.deck.notices.length;
  status('noticeStatus', bad ? `Не распознано строк: ${bad}. Формат: 0:08 Имя: текст` : '', bad > 0);
};
$('autoAccent').onchange = (e) => { renderer.autoAccent = e.target.checked; renderer.updateAccent(); };
$('accent').oninput = (e) => {
  $('autoAccent').checked = false;
  Object.assign(renderer, { autoAccent: false, customAccent: e.target.value });
  renderer.updateAccent();
};

let cardUrl = null;
let cardId = 0;
function clearCard() {
  cardId++;
  renderer.cardMedia?.pause?.();
  renderer.cardMedia = null;
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = null;
  $('cardClear').hidden = true;
}
async function setCard(file) {
  clearCard();
  const id = cardId;
  try {
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      const v = document.createElement('video');
      cardUrl = URL.createObjectURL(file);
      Object.assign(v, { muted: true, loop: true, playsInline: true, preload: 'auto' });
      await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = reject; v.src = cardUrl; });
      if (id !== cardId) return;
      if (!v.videoWidth) throw new Error('no video');
      renderer.cardMedia = v;
    } else {
      const bitmap = await createImageBitmap(file);
      if (id !== cardId) return;
      renderer.cardMedia = bitmap;
    }
    $('cardClear').hidden = false;
    status('cardStatus', '');
  } catch {
    status('cardStatus', 'Этот файл не открылся. Подойдут JPG, PNG, MP4 (H.264) или WebM.', true);
  }
}
$('cardFile').onchange = (e) => { if (e.target.files[0]) setCard(e.target.files[0]); e.target.value = ''; };
$('cardClear').onclick = clearCard;

function syncCardVideo(t) {
  const v = renderer.cardMedia;
  if (!v?.duration) return;
  const at = t % v.duration;
  const off = Math.abs(v.currentTime - at);
  if (audio.paused) {
    if (!v.paused) v.pause();
    if (off > 0.05 && !v.seeking) v.currentTime = at;
  } else {
    if (v.paused) v.play().catch(() => {});
    if (off > 0.35 && !v.seeking) v.currentTime = at;
  }
}

/* ---------- экспорт ---------- */

let abort = null;
$('export').onclick = async () => {
  if (!state.buffer || state.exporting) return;
  exitTap();
  if (!renderer.items.length && !state.allowNoText) {
    state.allowNoText = true;
    status('exportStatus', 'Текста пока нет. Нажмите кнопку ещё раз, чтобы сделать видео только с обложкой.', true);
    return;
  }
  audio.pause();
  renderer.cardMedia?.pause?.();
  $('busyView').width = renderer.width / 4;
  $('busyView').height = renderer.height / 4;
  state.exporting = true;
  abort = new AbortController();
  $('bar').value = 0;
  $('busyText').textContent = '0%';
  $('busy').showModal();
  status('exportStatus', '');
  const small = $('busyView').getContext('2d');
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* не критично */ }
  try {
    const res = await exportVideo({
      renderer, buffer: state.buffer, from: state.from, to: state.to, fps: Number($('fps').value), signal: abort.signal,
      onProgress: (p, canvas) => {
        $('bar').value = p;
        $('busyText').textContent = p >= 1 ? 'Сохраняю файл…' : `${Math.round(p * 100)}%`;
        small.drawImage(canvas, 0, 0, $('busyView').width, $('busyView').height);
      },
    });
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(res.blob);
    const base = `${renderer.meta.artist} - ${renderer.meta.title}`.replace(/[\\/:*?"<>|]+/g, '').replace(/^[ -]+|[ -]+$/g, '') || 'video';
    const name = `${base}.${res.ext}`;
    state.result = new File([res.blob], name, { type: res.blob.type });
    $('resultVideo').src = state.resultUrl;
    $('download').href = state.resultUrl;
    $('download').download = name;
    $('share').hidden = !navigator.canShare?.({ files: [state.result] });
    $('result').hidden = false;
    status('exportStatus', `Готово: ${(res.blob.size / 1048576).toFixed(1)} МБ. ${res.note}`);
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    console.error(e);
    status('exportStatus', e.name === 'AbortError' ? 'Экспорт отменён.' : `Видео не собралось: ${e.message}`, e.name !== 'AbortError');
  } finally {
    lock?.release().catch(() => {});
    state.exporting = false;
    $('busy').close();
  }
};
$('cancel').onclick = () => abort?.abort();
$('busy').addEventListener('cancel', (e) => { e.preventDefault(); abort?.abort(); });
$('share').onclick = () => navigator.share({ files: [state.result] }).catch(() => {});
$('resultVideo').onplay = () => audio.pause();

/* ---------- обновления (только в программе) ---------- */

if (window.updater) {
  const say = (text) => { $('updStatus').textContent = text; };
  $('updates').hidden = false;
  window.updater.version().then((v) => { $('appVersion').textContent = `версия ${v}`; });
  $('updCheck').onclick = async () => {
    $('updCheck').disabled = true;
    $('updInstall').hidden = true;
    say('Проверяю…');
    const r = await window.updater.check();
    $('updCheck').disabled = false;
    if (r.error) say(`Не получилось: ${r.error}`);
    else if (!r.available) say('У вас последняя версия.');
    else {
      say('Вышло обновление.');
      $('updInstall').textContent = `Обновить до ${r.latest}`;
      $('updInstall').hidden = false;
    }
  };
  window.updater.onProgress((p) => say(`Скачиваю… ${Math.round(p)}%`));
  $('updInstall').onclick = async () => {
    if (state.exporting) return;
    $('updInstall').disabled = $('updCheck').disabled = $('export').disabled = true;
    say('Скачиваю…');
    const r = await window.updater.install();
    if (r.error) {
      say(`Не получилось обновить: ${r.error}`);
      $('updInstall').disabled = $('updCheck').disabled = false;
      $('export').disabled = !state.buffer;
    } else say('Устанавливаю, программа сейчас перезапустится…');
  };
}

const today = new Date();
renderer.deck.date = `${today.toLocaleDateString('ru', { weekday: 'short' }).replace(/^./, (c) => c.toUpperCase())} ${today.toLocaleDateString('ru', { day: 'numeric', month: 'short' }).replace('.', '')}`;
$('date').value = renderer.deck.date;
syncView();
document.fonts.load('800 80px "Inter Variable"', 'AaЯяӘә').finally(() => { renderer.dirty = true; });
document.fonts.ready.then(() => { renderer.dirty = true; });
requestAnimationFrame(frame);
window.__pripev = { renderer, state };
