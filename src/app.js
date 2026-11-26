import { Renderer, fmt } from './render.js';
import { parseNotices } from './deck.js';
import { parseLrc, buildTimeline, retime, toLrc, distribute, tokens } from './lyrics.js';
import { readTags, parseFileName, searchCovers, searchLyrics, changedSpeed } from './sources.js';
import { processTrack, analyse, toWav, fadeGain, createMonitor, RATE } from './audio.js';
import { createEditor } from './editor.js';
import { dbGet, dbSet, dbClear, packProject, unpackProject, THEMES, loadPresets, savePresets, FILE_KEYS } from './project.js';
import { exportVideo } from './export.js';

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const view = $('view');
const g = view.getContext('2d', { alpha: false });
const wave = $('wave');
const renderer = new Renderer();
const monitor = createMonitor(audio);

const state = {
  original: null, buffer: null, duration: 0, speed: 1, from: 0, to: 0, fragmentTouched: false,
  mode: 'auto', lines: { auto: [], own: [] }, timing: { auto: { offset: 0, stretch: 100 }, own: { offset: 0, stretch: 100 } },
  variant: null, textApplied: '', tags: {},
  audioFile: null, coverBlob: null, cardBlob: null,
  loadId: 0, searchId: 0, coverId: 0, soundId: 0, processing: false, restoring: false,
  stopAt: null, tap: null, exporting: false, url: null, resultUrl: null, result: null,
};

const status = (id, text, bad = false) => {
  $(id).textContent = text;
  $(id).classList.toggle('bad', bad);
};

let uid = 1;
const withIds = (list) => list.map((l) => ({ text: '', ...l, id: uid++ }));

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const baseName = () => `${renderer.meta.artist} - ${renderer.meta.title}`.replace(/[\\/:*?"<>|]+/g, '').replace(/^[ -]+|[ -]+$/g, '') || 'pripev';

/* ---------- настройки: поле на экране ⇄ плеер ---------- */

const bool = (el) => el.type === 'checkbox';
const read = (id) => (bool($(id)) ? $(id).checked : $(id).value);
const number = (id) => Number($(id).value);

const apply = {};
for (const key of ['karaoke', 'blur', 'motion', 'progress']) apply[key] = (v) => renderer.setStyle({ [key]: v });
apply.scale = (v) => renderer.setStyle({ scale: Number(v) });
apply.nick = (v) => renderer.setStyle({ nick: v.trim() });
for (const key of ['effect', 'bgMode', 'widgetMode', 'mono', 'intro']) apply[key] = (v) => { renderer.deck[key] = v; };
for (const key of ['clock', 'date', 'leftTitle', 'leftValue', 'leftCaption', 'rightTitle']) apply[key] = (v) => { renderer.deck[key] = v.trim(); };
for (const key of ['strength', 'pulse']) apply[key] = (v) => { renderer.deck[key] = Number(v) / 100; };
apply.barVolume = (v) => { renderer.deck.volume = Number(v) / 100; };
apply.volume = () => {};
for (const id of ['lbPlaying', 'lbNow', 'lbState', 'lbWord', 'lbLyrics', 'lbLive', 'lbPause', 'lbMessage', 'lbMsgTime']) {
  const key = id[2].toLowerCase() + id.slice(3);
  apply[id] = (v) => { renderer.deck.labels[key] = v.trim(); };
}
for (const id of ['shStatus', 'shIsland', 'shMedia', 'shPlayer', 'shEq', 'shRing', 'shHeader']) {
  const key = id[2].toLowerCase() + id.slice(3);
  apply[id] = (v) => { renderer.deck.show[key] = v; renderer.dirty = true; };
}
apply.notices = (v) => {
  renderer.deck.notices = parseNotices(v);
  const bad = v.split('\n').filter((l) => l.trim()).length - renderer.deck.notices.length;
  status('noticeStatus', bad ? `Не распознано строк: ${bad}. Формат: 0:08 Имя: текст` : '', bad > 0);
};
apply.accent = (v) => { renderer.customAccent = v; renderer.updateAccent(); };
apply.autoAccent = (v) => { renderer.autoAccent = v; renderer.updateAccent(); syncAccent(); };
for (const key of ['speed', 'reverb', 'bass']) apply[key] = () => { markSound(); scheduleSound(); };
apply.fadeIn = apply.fadeOut = apply.fps = () => {};
for (const key of ['offset', 'stretch']) {
  apply[key] = (v) => { state.timing[state.mode][key] = Number(v); refreshLyrics(); };
}
apply.artist = apply.title = () => updateMeta();

const SAVED = Object.keys(apply);
const SOUND = ['volume', 'barVolume', 'fadeIn', 'fadeOut', 'speed', 'reverb', 'bass'];
const LOOK = SAVED.filter((k) => !['artist', 'title', 'offset', 'stretch', 'notices', 'fps', 'nick', 'clock', 'date', 'leftValue', ...SOUND].includes(k));

function showValue(id) {
  const out = document.querySelector(`output[for="${id}"]`);
  if (!out) return;
  const v = Number($(id).value);
  const sign = id === 'offset' && v > 0 ? '+' : '';
  out.textContent = `${sign}${id === 'speed' || id === 'scale' ? v.toFixed(2) : v}${$(id).dataset.unit || ''}`;
}

function writeControl(id, value) {
  if (bool($(id))) $(id).checked = Boolean(value); else $(id).value = value;
  showValue(id);
}
function setControl(id, value) {
  writeControl(id, value);
  apply[id](read(id));
}

for (const id of SAVED) {
  showValue(id);
  $(id).addEventListener('input', () => {
    if (id === 'accent') { writeControl('autoAccent', false); renderer.autoAccent = false; }
    showValue(id);
    apply[id](read(id));
    scheduleSave();
  });
}

function syncAccent() {
  if (renderer.autoAccent) $('accent').value = `#${renderer.accentRgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function updateMeta() {
  renderer.meta = { artist: $('artist').value.trim(), title: $('title').value.trim() };
}

/* ---------- вкладки ---------- */

function openTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== name; });
  document.querySelector('.pages').scrollTop = 0;
}
document.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) openTab(b.dataset.tab); };

/* ---------- загрузка трека ---------- */

function setReady() {
  const ready = Boolean(state.buffer) && !state.processing;
  $('play').disabled = $('export').disabled = !ready;
  $('search').disabled = !state.original;
}

async function loadTrack(file, saved = null) {
  const id = ++state.loadId;
  state.searchId++;
  state.soundId++;
  clearTimeout(soundTimer);
  exitTap();
  audio.pause();
  $('fileName').textContent = 'Читаю файл…';
  state.processing = true;
  setReady();
  let original, tags = {};
  try {
    const ctx = new OfflineAudioContext(2, 1, RATE);
    original = await ctx.decodeAudioData(await file.arrayBuffer());
    if (!saved) tags = await readTags(file);
  } catch {
    if (id !== state.loadId) return;
    state.processing = false;
    setReady();
    $('fileName').textContent = state.audioFile?.name || 'Выбрать песню';
    status('exportStatus', `Не получилось прочитать «${file.name}». Попробуйте MP3, M4A или WAV.`, true);
    return;
  }
  if (id !== state.loadId) return;
  Object.assign(state, {
    original, buffer: null, audioFile: file, tags, variant: null, textApplied: '', allowNoText: false,
    lines: { auto: [], own: [] }, timing: { auto: { offset: 0, stretch: 100 }, own: { offset: 0, stretch: 100 } },
    fragmentTouched: false,
  });
  $('fileName').textContent = file.name;
  $('variants').hidden = $('fit').hidden = true;
  $('lrc').value = '';
  status('exportStatus', '');
  status('ownStatus', '');
  $('showResult').hidden = true;
  renderer.emptyText = '';

  if (!saved) {
    state.coverId++;
    state.coverBlob = null;
    $('covers').textContent = '';
    renderer.setCover(null);
    const guess = parseFileName(file.name);
    writeControl('artist', tags.artist || guess.artist);
    writeControl('title', tags.title || guess.title);
    // эффекты прошлого трека не переносим: новый файл может быть уже замедлен
    writeControl('speed', 1);
    writeControl('reverb', 0);
    writeControl('bass', 0);
    markSound();
    setMode('auto', false);
    putFile('audio', file);
    putFile('cover', null);
  }
  updateMeta();
  syncTiming();
  if (!(await applySound()) || id !== state.loadId) return;

  if (saved) return;
  if (tags.cover) addCover({ blob: tags.cover, label: 'из файла' }, true);
  scheduleSave();
  search();
}

/* ---------- звук ---------- */

let soundTimer = null;
function scheduleSound() {
  clearTimeout(soundTimer);
  if (!state.original || state.restoring) return;
  state.processing = true;
  setReady();
  status('soundStatus', 'Обрабатываю звук…');
  soundTimer = setTimeout(applySound, 450);
}

// заново собирает звук с эффектами; предпросмотр и экспорт берут один и тот же результат
async function applySound() {
  const id = ++state.soundId;
  const params = { speed: number('speed'), reverb: number('reverb') / 100, bass: number('bass') };
  state.processing = true;
  setReady();
  status('soundStatus', 'Обрабатываю звук…');
  let buffer, sound, wav;
  try {
    await new Promise((r) => setTimeout(r, 30));
    buffer = await processTrack(state.original, params);
    if (id !== state.soundId) return false;
    sound = analyse(buffer);
    wav = toWav(buffer);
  } catch (e) {
    console.error(e);
    if (id !== state.soundId) return false;
    state.processing = false;
    setReady();
    status('soundStatus', `Звук не обработался: ${e.message}`, true);
    return false;
  }
  const first = !state.buffer;
  const ratio = state.speed / params.speed;
  const position = first ? 0 : audio.currentTime * ratio;
  const playing = !first && !audio.paused;
  exitTap();
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(wav);
  await new Promise((resolve) => {
    audio.addEventListener('loadedmetadata', resolve, { once: true });
    audio.src = state.url;
  });
  if (id !== state.soundId) return false;
  Object.assign(state, { buffer, duration: buffer.duration, speed: params.speed, processing: false });
  renderer.duration = buffer.duration;
  renderer.sound = sound;
  buildPeaks();
  if (first) setFragment(0, Math.min(30, buffer.duration));
  else setFragment(state.from * ratio, state.to * ratio);
  audio.currentTime = first ? state.from : Math.min(position, buffer.duration - 0.05);
  if (playing) audio.play();
  refreshLyrics();
  setReady();
  status('soundStatus', '');
  scheduleSave();
  return true;
}

// подсвечивает готовый вариант, который совпадает с ползунками
function markSound() {
  const now = [number('speed'), number('reverb'), number('bass')].join(',');
  $('soundPresets').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sound === now)));
}

$('soundPresets').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.dataset.sound.split(',').forEach((v, i) => writeControl(['speed', 'reverb', 'bass'][i], v));
  markSound();
  scheduleSound();
  scheduleSave();
};

/* ---------- текст ---------- */

const editor = createEditor($('lines'), {
  text: (id, text) => editLine(id, { text }),
  label: (id, label) => editLine(id, { label }),
  time: (id, seconds) => { editLine(id, { time: seconds * state.speed, words: null }, true); },
  now: (id) => { editLine(id, { time: audio.currentTime * state.speed, words: null }, true); },
  del: (id) => {
    bake();
    state.lines[state.mode] = state.lines[state.mode].filter((l) => l.id !== id);
    refreshLyrics();
    scheduleSave();
  },
  play: (id) => {
    const line = finalLines().find((l) => l.id === id);
    if (!line || !state.buffer) return;
    state.stopAt = null;
    audio.currentTime = Math.max(0, line.time - 0.3);
    audio.play();
  },
});

const timingOf = (mode = state.mode) => ({
  offset: state.timing[mode].offset, stretch: state.timing[mode].stretch / 100, speed: state.speed,
});
let finalCache = [];
const finalLines = (mode = state.mode) => retime(state.lines[mode], timingOf(mode));

function refreshLyrics(redrawEditor = true) {
  if (state.tap) return;
  finalCache = finalLines();
  const { stretch, speed } = timingOf();
  renderer.setLyrics(buildTimeline(finalCache, state.duration, stretch / speed));
  if (redrawEditor) editor.render(finalCache.map((l) => ({ id: l.id, time: l.time, text: l.text, label: l.label })));
  autoFragment();
}

// пока фрагмент не выбирали руками, начинаем незадолго до первой строки
function autoFragment() {
  if (state.fragmentTouched || !state.buffer || !audio.paused) return;
  const first = renderer.items.find((i) => !i.dots);
  if (!first) return;
  const from = Math.max(0, first.time - 2);
  if (Math.abs(from - state.from) < 0.05) return;
  setFragment(from, from + (state.to - state.from));
  audio.currentTime = state.from;
}

// вносит сдвиг и растяжение в сами строки, чтобы дальше править точные тайминги
function bake() {
  const t = state.timing[state.mode];
  if (t.offset === 0 && t.stretch === 100) return;
  state.lines[state.mode] = retime(state.lines[state.mode], { offset: t.offset, stretch: t.stretch / 100, speed: 1 });
  state.timing[state.mode] = { offset: 0, stretch: 100 };
  syncTiming();
}

function syncTiming() {
  writeControl('offset', state.timing[state.mode].offset);
  writeControl('stretch', state.timing[state.mode].stretch);
}

function editLine(id, change, reorder = false) {
  bake();
  const list = state.lines[state.mode];
  Object.assign(list.find((l) => l.id === id), change);
  if (reorder) list.sort((a, b) => a.time - b.time);
  refreshLyrics(reorder);
  scheduleSave();
}

function addLine(focus) {
  if (!state.buffer) return;
  bake();
  const [line] = withIds([{ time: audio.currentTime * state.speed, words: null }]);
  const list = state.lines[state.mode];
  list.push(line);
  list.sort((a, b) => a.time - b.time);
  refreshLyrics();
  editor.highlight(line.id);
  if (focus) editor.focus(line.id);
  scheduleSave();
}
$('addLine').onclick = () => addLine(true);
$('addGap').onclick = () => addLine(false);

function setMode(mode, refresh = true) {
  state.mode = mode;
  $('lyricMode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('autoBox').hidden = mode !== 'auto';
  $('ownBox').hidden = mode !== 'own';
  syncTiming();
  if (refresh) refreshLyrics();
}
$('lyricMode').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || state.tap) return;
  setMode(b.dataset.mode);
  scheduleSave();
};

// готовые строки (во времени того, что звучит) становятся «своим текстом»
function setOwn(lines) {
  state.lines.own = withIds(lines.map((l) => ({ ...l, time: l.time * state.speed, words: l.words?.map((w) => ({ ...w, start: w.start * state.speed, end: w.end == null ? null : w.end * state.speed })) || null })));
  state.timing.own = { offset: 0, stretch: 100 };
  state.textApplied = $('lrc').value;
  setMode('own');
  scheduleSave();
}

function applyText() {
  if (!state.buffer) return status('ownStatus', 'Сначала загрузите песню.', true);
  const raw = $('lrc').value;
  const parsed = parseLrc(raw);
  if (parsed.some((l) => l.text)) {
    setOwn(parsed);
    return status('ownStatus', 'Текст применён.');
  }
  const texts = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!texts.length) return status('ownStatus', 'Напишите текст в поле выше.', true);
  const at = audio.currentTime;
  setOwn(distribute(texts, at > 0.5 && at < state.duration - 10 ? at : Math.min(1, state.from), state.duration - 0.5));
  status('ownStatus', 'Строки расставлены равномерно. Нажмите «Разметить в такт» или поправьте время у строк.');
}
$('applyLrc').onclick = applyText;

$('copyAuto').onclick = () => {
  if (!state.lines.auto.length) return status('ownStatus', 'Найденного текста пока нет.', true);
  const lines = finalLines('auto');
  $('lrc').value = toLrc(lines);
  setOwn(lines);
  status('ownStatus', 'Найденный текст скопирован — правьте как нужно.');
};

async function openLrc(file) {
  const bytes = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { text = new TextDecoder('windows-1251').decode(bytes); }
  $('lrc').value = text;
  setMode('own');
  openTab('text');
  applyText();
}
$('lrcFile').onchange = (e) => { if (e.target.files[0]) openLrc(e.target.files[0]); e.target.value = ''; };
$('saveLrc').onclick = () => {
  const lines = finalLines();
  if (!lines.length) return;
  download(new Blob([toLrc(lines)], { type: 'text/plain' }), `${baseName()}.lrc`);
};

/* ---------- автоматический поиск ---------- */

async function search() {
  if (!state.original) return;
  const id = ++state.searchId;
  const artist = $('artist').value.trim();
  const title = $('title').value.trim();
  if (!title) { status('lyricStatus', 'Впишите название песни на вкладке «Трек».', true); return; }
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
    if (!state.tags.cover && !state.coverBlob) {
      if (list[0].score >= (artist ? 2.5 : 1.4)) buttons[0].click();
      else status('coverStatus', 'Точного совпадения нет — выберите картинку вручную.');
    }
  });

  const length = state.original.duration;
  const { list, failed } = await searchLyrics(artist, title, length);
  if (id !== state.searchId) return;
  const select = $('variants');
  select.textContent = '';
  if (!list.length) {
    select.hidden = true;
    status('lyricStatus', failed ? 'Нет связи с базой текстов. Проверьте интернет или переключитесь на «Свой текст».' : 'В базе этой песни нет. Переключитесь на «Свой текст».', true);
    return;
  }
  for (const v of list) {
    select.append(new Option(`${v.synced ? '⏱' : '📄'} ${v.artist} — ${v.title}${v.duration ? ` (${fmt(v.duration)})` : ''}`));
  }
  select.hidden = false;
  select.onchange = () => useVariant(list[select.selectedIndex]);
  const best = list[0];
  // совсем другая длина — скорее всего другая версия или другая песня
  if (best.match && (best.diff <= 45 || speedRatio(best))) useVariant(best);
  else {
    select.selectedIndex = -1;
    status('lyricStatus', 'Точного совпадения нет. Выберите вариант из списка или переключитесь на «Свой текст».', true);
  }
}

// для slowed/sped up версий тайминги оригинала растягиваются под длину файла
function speedRatio(v) {
  if (!v.duration || !(changedSpeed($('title').value) || changedSpeed(state.audioFile?.name))) return null;
  const ratio = state.original.duration / v.duration;
  return ratio > 0.65 && ratio < 1.55 && Math.abs(state.original.duration - v.duration) > 3 ? ratio : null;
}

function useVariant(v) {
  state.variant = { duration: v.duration };
  state.timing.auto = { offset: 0, stretch: 100 };
  $('fit').hidden = true;
  const diff = v.duration ? Math.round(Math.abs(v.duration - state.original.duration)) : 0;
  if (v.synced) {
    state.lines.auto = withIds(parseLrc(v.synced));
    const ratio = speedRatio(v);
    if (ratio) {
      state.timing.auto.stretch = Math.round(ratio * 200) / 2;
      status('lyricStatus', `Текст найден, тайминги растянуты под изменённую скорость (${state.timing.auto.stretch}%). Проверьте на слух.`);
    } else if (diff > 3) {
      $('fit').hidden = false;
      status('lyricStatus', `Текст найден, но эта версия отличается по длине на ${diff} с. Проверьте синхронность.`, true);
    } else status('lyricStatus', 'Синхронный текст найден.');
  } else {
    const texts = v.plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    state.lines.auto = withIds(distribute(texts, 1, state.original.duration - 1));
    status('lyricStatus', 'Нашёлся текст без таймингов: строки расставлены равномерно. Нажмите «Разметить в такт».', true);
  }
  syncTiming();
  if (state.mode === 'auto') refreshLyrics();
  scheduleSave();
}

$('fit').onclick = () => {
  if (!state.variant?.duration) return;
  const stretch = Math.max(50, Math.min(200, Math.round((state.original.duration / state.variant.duration) * 200) / 2));
  setControl('stretch', stretch);
  status('lyricStatus', `Тайминги растянуты до ${stretch}%. Если не совпало, верните 100% и поправьте сдвиг.`);
  scheduleSave();
};
$('refind').onclick = () => search();

/* ---------- обложки и карточка ---------- */

function putFile(key, file) {
  dbSet(key, file).catch(() => status('projectStatus', 'Автосохранение не сработало: возможно, мало места на диске.', true));
}

function addCover(c, select) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  const img = document.createElement('img');
  img.src = c.blob ? URL.createObjectURL(c.blob) : c.thumb;
  img.alt = c.blob ? `Обложка ${c.label}` : `${c.artist} — ${c.album}`;
  b.title = img.alt;
  b.append(img);
  if (c.found) b.dataset.found = '1';
  if (c.label) { const s = document.createElement('small'); s.textContent = c.label; b.append(s); }
  b.onclick = async () => {
    const id = ++state.coverId;
    try {
      let blob = c.blob;
      if (!blob) {
        const r = await fetch(c.full, { mode: 'cors', signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(r.status);
        blob = await r.blob();
      }
      const bitmap = await createImageBitmap(blob);
      if (id !== state.coverId) return;
      renderer.setCover(bitmap);
      syncAccent();
      state.coverBlob = blob;
      putFile('cover', blob);
      $('covers').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    } catch {
      status('coverStatus', 'Эта картинка не загрузилась, выберите другую.', true);
    }
  };
  $('covers').append(b);
  if (select) b.click();
  return b;
}

let cardUrl = null;
let cardId = 0;
function clearCard() {
  cardId++;
  renderer.cardMedia?.pause?.();
  renderer.cardMedia = null;
  state.cardBlob = null;
  if (cardUrl) URL.revokeObjectURL(cardUrl);
  cardUrl = null;
  $('cardClear').hidden = true;
}
async function setCard(file) {
  clearCard();
  const id = cardId;
  try {
    let media;
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name || '')) {
      media = document.createElement('video');
      cardUrl = URL.createObjectURL(file);
      Object.assign(media, { muted: true, loop: true, playsInline: true, preload: 'auto' });
      await new Promise((resolve, reject) => { media.onloadeddata = resolve; media.onerror = reject; media.src = cardUrl; });
      if (!media.videoWidth) throw new Error('no video');
    } else media = await createImageBitmap(file);
    if (id !== cardId) return;
    renderer.cardMedia = media;
    state.cardBlob = file;
    putFile('card', file);
    $('cardClear').hidden = false;
    status('cardStatus', '');
  } catch {
    status('cardStatus', 'Этот файл не открылся. Подойдут JPG, PNG, MP4 (H.264) или WebM.', true);
  }
}
$('cardFile').onchange = (e) => { if (e.target.files[0]) setCard(e.target.files[0]); e.target.value = ''; };
$('cardClear').onclick = () => { clearCard(); putFile('card', null); };

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

/* ---------- шкала и фрагмент ---------- */

let peaks = [];
function buildPeaks() {
  const e = renderer.sound.level;
  peaks = Array.from({ length: 160 }, (_, i) => {
    const a = Math.floor((i * e.length) / 160), b = Math.max(a + 1, Math.floor(((i + 1) * e.length) / 160));
    let s = 0;
    for (let j = a; j < b; j++) s += e[j] || 0;
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
function userFragment(from, to) {
  state.fragmentTouched = true;
  setFragment(from, to);
  scheduleSave();
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
    c.beginPath();
    c.roundRect((i * w) / n, (h - bh) / 2, Math.max(1, w / n - dpr), bh, dpr);
    c.fill();
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
  if (drag === 'from') { userFragment(Math.min(t, state.to - 3), state.to); audio.currentTime = state.from; }
  else if (drag === 'to') userFragment(state.from, Math.max(t, state.from + 3));
  else audio.currentTime = t;
});
['pointerup', 'pointercancel'].forEach((n) => wave.addEventListener(n, () => { drag = null; }));

$('fragment').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !state.buffer || state.tap || state.processing) return;
  if (b.dataset.len !== undefined) {
    const len = Number(b.dataset.len) || state.duration;
    userFragment(state.from, state.from + len);
    audio.currentTime = state.from;
  } else if (b.id === 'fromHere') {
    const len = state.to - state.from;
    userFragment(audio.currentTime, audio.currentTime + (len >= state.duration - 0.1 ? 30 : len));
  } else {
    audio.currentTime = state.from;
    state.stopAt = state.to;
    audio.play();
  }
});

/* ---------- воспроизведение ---------- */

function toggle() {
  if (!state.buffer || state.exporting || state.processing) return;
  state.stopAt = null;
  if (audio.paused) audio.play(); else audio.pause();
}
$('play').onclick = toggle;
view.onclick = () => { if (!state.tap) toggle(); };
audio.onplay = () => { monitor.resume(); $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Пауза'); };
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
    // в предпросмотре слышно ту же громкость и затухания, что будут в видео
    const fade = state.stopAt != null ? fadeGain(t, state.from, state.to, number('fadeIn'), number('fadeOut')) : 1;
    monitor.set((number('volume') / 100) * fade);
    syncCardVideo(t);
    renderer.introOn = !audio.paused;
    renderer.draw(g, state.buffer ? t : 2.2, { guides: $('guides').checked });
    $('now').textContent = fmt(t);
    drawWave();
    if (!state.tap) {
      let current = null;
      for (const l of finalCache) { if (l.time > t + 0.05) break; current = l.id; }
      if (!audio.paused) editor.highlight(current);
    }
  }
  requestAnimationFrame(frame);
}

/* ---------- разметка в такт ---------- */

function startTap() {
  if (!state.buffer || state.processing) return;
  const typed = $('lrc').value;
  const fresh = state.mode === 'own' && typed.trim() && typed !== state.textApplied;
  let source = fresh ? [] : state.lines[state.mode].filter((l) => tokens(l.text).length).map((l) => ({ text: l.text, label: l.label }));
  if (!source.length) {
    source = typed.split(/\r?\n/).map((l) => ({ text: l.replace(/\[[^\]]*\]|<[\d:.,]+>/g, '').trim() })).filter((l) => l.text);
    if (source.length) setMode('own', false);
  }
  if (!source.length) {
    setMode('own');
    return status('ownStatus', 'Сначала напишите или вставьте текст.', true);
  }
  state.tap = { lines: source, done: [], i: 0 };
  state.stopAt = null;
  $('tap').hidden = false;
  $('editorBox').hidden = $('syncBox').hidden = $('ownBox').hidden = $('autoBox').hidden = true;
  audio.currentTime = 0;
  audio.play();
  tapRefresh();
  $('tapMark').focus();
}

function tapRefresh() {
  const s = state.tap;
  const clean = (l) => (l ? tokens(l.text).map((w) => w.text).join(' ') : '');
  $('tapPrev').textContent = clean(s.lines[s.i - 1]);
  $('tapNext').textContent = clean(s.lines[s.i]) || 'Все строки отмечены';
  $('tapMark').disabled = s.i >= s.lines.length;
  renderer.setLyrics(buildTimeline(s.done, state.duration));
}

function tapMark(gap = false) {
  const s = state.tap;
  if (!s || (!gap && s.i >= s.lines.length) || (gap && !s.done.length)) return;
  s.done.push({ ...(gap ? { text: '' } : s.lines[s.i]), time: Math.max(0, audio.currentTime - 0.08), words: null });
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
  $('editorBox').hidden = $('syncBox').hidden = false;
  if (save && s.done.length) {
    const last = s.done[s.done.length - 1].time;
    const rest = s.lines.slice(s.i).map((l, i) => ({ ...l, time: last + 3 * (i + 1), words: null }));
    const lines = withIds([...s.done, ...rest].map((l) => ({ ...l, time: l.time * state.speed })));
    state.lines[state.mode] = lines;
    state.timing[state.mode] = { offset: 0, stretch: 100 };
    if (state.mode === 'own') {
      $('lrc').value = toLrc([...s.done, ...rest]);
      state.textApplied = $('lrc').value;
    }
    status(state.mode === 'own' ? 'ownStatus' : 'lyricStatus', rest.length ? `Размечено строк: ${s.i}. Остальным (${rest.length}) время поставлено приблизительно.` : 'Текст размечен.', rest.length > 0);
    scheduleSave();
  }
  setMode(state.mode);
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

/* ---------- файлы ---------- */

$('file').onchange = (e) => { if (e.target.files[0]) loadTrack(e.target.files[0]); e.target.value = ''; };
const drop = $('drop');
['dragover', 'drop'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
document.addEventListener('dragover', () => drop.classList.add('over'));
['dragleave', 'drop'].forEach((n) => document.addEventListener(n, () => drop.classList.remove('over')));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files[0];
  if (!f || state.exporting) return;
  if (f.type.startsWith('image/')) addCover({ blob: f, label: 'своя' }, true);
  else if (f.type.startsWith('video/') && state.original) setCard(f);
  else if (/\.(lrc|txt)$/i.test(f.name)) openLrc(f);
  else if (/\.pripev$/i.test(f.name)) openProjectFile(f);
  else loadTrack(f);
});

$('searchForm').onsubmit = (e) => { e.preventDefault(); updateMeta(); search(); };
$('coverFile').onchange = (e) => { if (e.target.files[0]) addCover({ blob: e.target.files[0], label: 'своя' }, true); e.target.value = ''; };

/* ---------- стиль и темы ---------- */

function syncView() {
  const { layout } = renderer.style;
  view.width = renderer.width;
  view.height = renderer.height;
  const wide = renderer.width > renderer.height;
  const deck = layout.startsWith('deck');
  document.body.classList.toggle('landscape', wide);
  document.querySelectorAll('.deck-only').forEach((e) => { e.hidden = !deck; });
  $('progressRow').hidden = deck;
  $('guidesRow').hidden = wide;
  $('export').textContent = `Создать видео ${renderer.width}×${renderer.height}`;
}

function setLayout(layout) {
  const b = $('layouts').querySelector(`[data-layout="${layout}"]`);
  if (!b) return;
  $('layouts').querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  renderer.setStyle({ layout });
  syncView();
}
$('layouts').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setLayout(b.dataset.layout);
  scheduleSave();
};

function applyTheme(theme) {
  if (theme.layout) setLayout(theme.layout);
  // порядок важен: галочка «из обложки» применяется после цвета
  const keys = Object.keys(theme.controls).sort((a, b) => (a === 'autoAccent') - (b === 'autoAccent'));
  for (const key of keys) if (apply[key]) setControl(key, theme.controls[key]);
  scheduleSave();
}

function themeButton(theme) {
  const b = document.createElement('button');
  b.type = 'button';
  if (theme.controls.accent && !theme.controls.autoAccent) {
    const dot = document.createElement('i');
    dot.style.background = theme.controls.accent;
    b.append(dot);
  }
  b.append(theme.name);
  b.onclick = () => applyTheme(theme);
  return b;
}
$('themes').append(...THEMES.map(themeButton));

function drawPresets() {
  const list = loadPresets();
  $('presets').textContent = '';
  list.forEach((p, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'preset';
    const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕', title: `Удалить тему «${p.name}»` });
    remove.onclick = () => { list.splice(i, 1); savePresets(list); drawPresets(); };
    wrap.append(themeButton(p), remove);
    $('presets').append(wrap);
  });
}
$('presetSave').onclick = () => {
  const list = loadPresets();
  const name = $('presetName').value.trim() || `Моя тема ${list.length + 1}`;
  const theme = { name, layout: renderer.style.layout, controls: Object.fromEntries(LOOK.map((k) => [k, read(k)])) };
  const at = list.findIndex((p) => p.name === name);
  if (at >= 0) list[at] = theme; else list.push(theme);
  if (savePresets(list)) $('presetName').value = '';
  drawPresets();
};

/* ---------- проект ---------- */

function snapshot() {
  return {
    v: 1,
    layout: renderer.style.layout,
    controls: Object.fromEntries(SAVED.map((k) => [k, read(k)])),
    mode: state.mode, lines: state.lines, timing: state.timing, variant: state.variant, textApplied: state.textApplied, ownText: $('lrc').value,
    // фрагмент — во времени выбранной скорости, даже если звук ещё обрабатывается
    from: (state.from * state.speed) / number('speed'), to: (state.to * state.speed) / number('speed'), fragmentTouched: state.fragmentTouched,
  };
}

let saveTimer = null;
function scheduleSave() {
  if (state.restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (state.restoring) return;
  await dbSet('doc', snapshot()).catch(() => status('projectStatus', 'Автосохранение не сработало.', true));
}
$('lrc').addEventListener('input', scheduleSave);
// последние правки перед закрытием окна
window.addEventListener('beforeunload', () => { if (state.audioFile) saveNow(); });

async function restore(doc, files) {
  state.restoring = true;
  try {
    state.loadId++;
    state.searchId++;
    state.soundId++;
    state.coverId++;
    clearTimeout(soundTimer);
    exitTap();
    audio.pause();
    state.original = state.buffer = null;
    setLayout(doc.layout);
    const keys = Object.keys(doc.controls || {}).sort((a, b) => (a === 'autoAccent') - (b === 'autoAccent'));
    for (const key of keys) if (apply[key] && !['offset', 'stretch'].includes(key)) setControl(key, doc.controls[key]);
    clearCard();
    if (files.card) await setCard(files.card);
    $('covers').textContent = '';
    state.coverBlob = null;
    renderer.setCover(null);
    if (files.audio) {
      await loadTrack(files.audio, doc);
      // пока восстанавливали, могли выбрать другую песню
      if (!state.buffer || state.audioFile !== files.audio) return;
      const lines = { auto: withIds(doc.lines?.auto || []), own: withIds(doc.lines?.own || []) };
      Object.assign(state, { lines, timing: doc.timing || state.timing, variant: doc.variant, textApplied: doc.textApplied || '', fragmentTouched: true });
      $('lrc').value = doc.ownText || '';
      $('fit').hidden = true;
      setMode(doc.mode === 'own' ? 'own' : 'auto');
      setFragment(doc.from, doc.to);
      state.fragmentTouched = Boolean(doc.fragmentTouched);
      audio.currentTime = state.from;
      status('lyricStatus', lines.auto.length ? 'Текст из сохранённого проекта.' : 'Нажмите «Искать ещё раз», чтобы найти текст.');
      status('coverStatus', files.cover ? '' : 'Нажмите «Найти обложку и текст», чтобы выбрать обложку.');
      if (files.cover) addCover({ blob: files.cover, label: 'из проекта' }, true);
    } else {
      state.audioFile = null;
      setReady();
    }
  } finally {
    state.restoring = false;
  }
}

$('saveProject').onclick = () => {
  if (!state.audioFile) return status('projectStatus', 'Сначала загрузите песню.', true);
  const blob = packProject(snapshot(), { audio: state.audioFile, cover: state.coverBlob, card: state.cardBlob });
  download(blob, `${baseName()}.pripev`);
  status('projectStatus', '');
};

async function openProjectFile(file) {
  try {
    const { doc, files } = await unpackProject(file);
    status('projectStatus', 'Открываю проект…');
    await restore(doc, files);
    await Promise.all(FILE_KEYS.map((k) => dbSet(k, files[k] || null)));
    await saveNow();
    status('projectStatus', `Открыт проект «${file.name}».`);
  } catch (e) {
    status('projectStatus', `Проект не открылся: ${e.message}`, true);
    openTab('project');
  }
}
$('openProject').onchange = (e) => { if (e.target.files[0]) openProjectFile(e.target.files[0]); e.target.value = ''; };

let sure = null;
$('newProject').onclick = async () => {
  if (!sure) {
    $('newProject').textContent = 'Точно начать заново? Нажмите ещё раз';
    sure = setTimeout(() => { sure = null; $('newProject').textContent = 'Новый проект'; }, 4000);
    return;
  }
  state.restoring = true;
  clearTimeout(saveTimer);
  await dbClear().catch(() => {});
  location.reload();
};

/* ---------- экспорт ---------- */

let abort = null;
$('export').onclick = async () => {
  if (!state.buffer || state.exporting || state.processing) return;
  exitTap();
  if (!renderer.items.length && !state.allowNoText) {
    state.allowNoText = true;
    status('exportStatus', 'Текста пока нет. Нажмите кнопку ещё раз, чтобы сделать видео без него.', true);
    return;
  }
  audio.pause();
  renderer.cardMedia?.pause?.();
  $('busyView').width = renderer.width / 4;
  $('busyView').height = renderer.height / 4;
  state.exporting = true;
  renderer.introOn = true;
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
      renderer, buffer: state.buffer, from: state.from, to: state.to, fps: number('fps'), signal: abort.signal,
      sound: { volume: number('volume') / 100, fadeIn: number('fadeIn'), fadeOut: number('fadeOut') },
      onProgress: (p, canvas) => {
        $('bar').value = p;
        $('busyText').textContent = p >= 1 ? 'Сохраняю файл…' : `${Math.round(p * 100)}%`;
        small.drawImage(canvas, 0, 0, $('busyView').width, $('busyView').height);
      },
    });
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(res.blob);
    const name = `${baseName()}.${res.ext}`;
    state.result = new File([res.blob], name, { type: res.blob.type });
    $('resultVideo').src = state.resultUrl;
    $('download').href = state.resultUrl;
    $('download').download = name;
    $('share').hidden = !navigator.canShare?.({ files: [state.result] });
    $('showResult').hidden = false;
    status('exportStatus', `Готово: ${(res.blob.size / 1048576).toFixed(1)} МБ. ${res.note}`);
    $('busy').close();
    $('done').showModal();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
    status('exportStatus', e.name === 'AbortError' ? 'Экспорт отменён.' : `Видео не собралось: ${e.message}`, e.name !== 'AbortError');
  } finally {
    lock?.release().catch(() => {});
    state.exporting = false;
    if ($('busy').open) $('busy').close();
  }
};
$('cancel').onclick = () => abort?.abort();
$('busy').addEventListener('cancel', (e) => { e.preventDefault(); abort?.abort(); });
$('share').onclick = () => navigator.share({ files: [state.result] }).catch(() => {});
$('showResult').onclick = () => $('done').showModal();
$('doneClose').onclick = () => $('done').close();
$('done').addEventListener('close', () => $('resultVideo').pause());
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
    await saveNow();
    say('Скачиваю…');
    const r = await window.updater.install();
    if (r.error) {
      say(`Не получилось обновить: ${r.error}`);
      $('updInstall').disabled = $('updCheck').disabled = false;
      setReady();
    } else say('Устанавливаю, программа сейчас перезапустится…');
  };
}

/* ---------- запуск ---------- */

const today = new Date();
setControl('date', `${today.toLocaleDateString('ru', { weekday: 'short' }).replace(/^./, (c) => c.toUpperCase())} ${today.toLocaleDateString('ru', { day: 'numeric', month: 'short' }).replace('.', '')}`);
for (const id of SAVED) if (!['speed', 'reverb', 'bass', 'offset', 'stretch'].includes(id)) apply[id](read(id));
syncView();
markSound();
drawPresets();
document.fonts.load('800 80px "Inter Variable"', 'AaЯяӘә').finally(() => { renderer.dirty = true; });
document.fonts.ready.then(() => { renderer.dirty = true; });
requestAnimationFrame(frame);
window.__pripev = { renderer, state };

// возвращаем то, на чём остановились в прошлый раз
(async () => {
  const doc = await dbGet('doc');
  if (!doc || state.audioFile) return;
  const files = {};
  for (const key of FILE_KEYS) files[key] = await dbGet(key);
  if (state.audioFile) return;
  await restore(doc, files);
})().catch((e) => console.warn('restore', e));
