// Полноэкранный текст песни.
import { parseLrc } from '../../src/lyrics.js';
import { $, h, dialog, toast } from './ui.js';
import { findLyrics } from './online.js';

export function createStage({ audio, getTrack, coverUrl, paintCover, user, saveUser }) {
  const root = $('#stage');
  const box = $('#lyrics');
  const tools = $('#stageTools');
  const cache = new Map(); // id -> { text, source, variants }
  let id = null;
  let lines = [];
  let rows = [];
  let active = -1;
  let touched = 0;
  let frame = 0;
  let request = 0;

  const offset = () => user().offsets[id] || 0;

  function show(entry) {
    active = -1;
    rows = [];
    lines = entry?.text ? parseLrc(entry.text) : [];
    box.replaceChildren();
    box.scrollTop = 0;
    const timed = lines.length > 0;
    box.classList.toggle('plain', !timed);
    if (timed) {
      rows = lines.map((l) => h('button', { class: 'line', onclick: () => { audio.currentTime = Math.max(0, l.time + offset()); touched = 0; audio.play().catch(() => {}); } }, l.text || '• • •'));
      box.append(...rows);
    } else if (entry?.text?.trim()) {
      box.append(h('div', { class: 'plaintext' }, entry.text.replace(/^\[[a-z]+:.*\]$/gim, '').trim()));
    } else {
      box.append(empty(entry?.note || 'Текст не найден'));
    }
    toolbar(entry, timed);
    tick();
  }

  const empty = (text) => h('div', { class: 'nolyrics' }, h('p', {}, text));

  function toolbar(entry, timed) {
    tools.replaceChildren(...[
      entry?.variants?.length > 1 && h('select', {
        'aria-label': 'Вариант текста',
        onchange: (e) => {
          const v = entry.variants[e.target.value];
          if (v) use(v.text, { ...entry, chosen: Number(e.target.value) });
        },
      }, entry.chosen === undefined ? h('option', { value: '', selected: true }, 'Выбрать вариант') : null,
      entry.variants.map((v, i) => h('option', { value: i, selected: i === entry.chosen }, v.label))),
      timed && h('div', { class: 'offset', title: 'Если текст спешит или отстаёт' },
        h('button', { onclick: () => shift(-0.5) }, 'Раньше'),
        h('output', { id: 'offsetValue' }, offsetText()),
        h('button', { onclick: () => shift(0.5) }, 'Позже')),
      h('button', { onclick: online }, 'Найти в интернете'),
      h('button', { onclick: edit }, 'Свой текст'),
      entry?.source === 'saved' && h('button', { onclick: forget, title: 'Вернуть текст из файла или найти заново' }, 'Сбросить'),
    ].filter(Boolean));
  }

  const offsetText = () => `${offset() > 0 ? '+' : ''}${offset().toFixed(1).replace('.', ',')} с`;

  function shift(by) {
    const v = Math.round((offset() + by) * 10) / 10;
    if (v) user().offsets[id] = v; else delete user().offsets[id];
    saveUser();
    $('#offsetValue').textContent = offsetText();
    active = -1;
    tick();
  }

  async function use(text, entry) {
    const target = id;
    delete user().offsets[target];
    saveUser();
    const next = { ...entry, text, source: 'saved' };
    cache.set(target, next);
    await window.kuplet.saveLyrics(target, text);
    if (target === id) show(next);
  }

  async function forget() {
    const target = id;
    await window.kuplet.saveLyrics(target, null);
    cache.delete(target);
    delete user().offsets[target];
    saveUser();
    if (target === id) load();
  }

  async function edit() {
    const target = id;
    const area = h('textarea', { rows: '14', spellcheck: 'false', placeholder: '[00:12.50] Первая строка\n[00:15.10] Вторая строка\n\nМожно и без таймингов — тогда текст просто будет виден.' });
    area.value = cache.get(target)?.text || '';
    const file = h('input', { type: 'file', accept: '.lrc,.txt', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      try { area.value = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { area.value = new TextDecoder('windows-1251').decode(buf); }
    } });
    const done = await dialog('Текст песни', h('div', { class: 'lyricedit' }, area, h('label', {}, 'Или открыть файл .lrc: ', file)), [['Отмена', 'cancel'], ['Сохранить', 'ok', 'primary']]);
    if (!done || target !== id) return;
    if (area.value.trim()) use(area.value, cache.get(target) || {});
    else forget();
  }

  async function online() {
    const target = id;
    const track = getTrack(target);
    if (!track) return;
    toast('Ищу текст…');
    const { variants, failed } = await findLyrics(track);
    if (target !== id) return;
    if (!variants.length) return toast(failed ? 'Нет связи с сервисом текстов' : 'Ничего не нашлось');
    const old = cache.get(target) || {};
    const best = variants[0];
    if (best.sure || !old.text) use(best.text, { ...old, variants, chosen: 0 });
    else {
      const next = { ...old, variants, chosen: undefined };
      cache.set(target, next);
      show(next);
      toast('Выберите вариант из списка');
    }
  }

  // порядок: свой сохранённый, файл .lrc рядом, теги, интернет
  async function load() {
    const target = id;
    const mine = ++request;
    const track = getTrack(target);
    if (!track) return show({ note: 'Ничего не играет' });
    if (cache.has(target)) return show(cache.get(target));
    box.replaceChildren(empty('Ищу текст…'));
    tools.replaceChildren();
    lines = [];
    rows = [];
    let entry = await window.kuplet.lyrics(target);
    if (!entry && user().online) {
      const { variants, failed } = await findLyrics(track);
      const best = variants.find((v) => v.sure);
      if (best) {
        await window.kuplet.saveLyrics(target, best.text);
        entry = { text: best.text, source: 'saved', variants, chosen: variants.indexOf(best) };
      } else {
        entry = { variants, note: failed ? 'Нет связи с сервисом текстов' : variants.length ? 'Точного совпадения нет — выберите вариант вверху' : 'Текст не найден' };
        if (failed) { if (mine === request && target === id) show(entry); return; }
      }
    }
    entry ||= { note: 'У этого трека нет текста' };
    cache.set(target, entry);
    if (mine === request && target === id) show(entry);
  }

  function tick() {
    cancelAnimationFrame(frame);
    if (root.hidden) return;
    if (rows.length) {
      const t = audio.currentTime - offset() + 0.15;
      let i = -1;
      while (i + 1 < lines.length && lines[i + 1].time <= t) i++;
      if (i !== active) {
        const first = active === -1;
        rows[active]?.classList.remove('on');
        active = i;
        rows.forEach((r, k) => r.classList.toggle('past', k < i));
        rows[i]?.classList.add('on');
        // после ручной прокрутки несколько секунд не мешаем
        if (Date.now() - touched > 4000) {
          const row = rows[Math.max(0, i)];
          box.scrollTo({ top: row.offsetTop - box.clientHeight * 0.38 + row.offsetHeight / 2, behavior: first ? 'auto' : 'smooth' });
        }
      }
    }
    frame = requestAnimationFrame(tick);
  }

  for (const ev of ['wheel', 'touchmove', 'pointerdown']) box.addEventListener(ev, (e) => { if (!e.target.closest('.line')) touched = Date.now(); }, { passive: true });

  function setTrack(next) {
    const changed = next !== id;
    id = next;
    const track = getTrack(id);
    $('#stageTitle').textContent = track?.title || 'Ничего не играет';
    $('#stageArtist').textContent = track?.artist || '';
    paintCover($('#stageCover'), track, false);
    const url = coverUrl(track, true);
    $('.backdrop', root).style.backgroundImage = url ? `url("${url}")` : '';
    if (changed && !root.hidden) { touched = 0; load(); }
  }

  return {
    get open() { return !root.hidden; },
    setTrack,
    toggle(on = root.hidden) {
      if (on === !root.hidden) return;
      root.hidden = !on;
      if (on) { touched = 0; setTrack(id); load(); root.focus(); } else cancelAnimationFrame(frame);
    },
  };
}
