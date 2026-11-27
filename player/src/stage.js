// Полноэкранный разворот: конверт с пластинкой и крупный текст песни.
import { parseLrc } from '../../src/lyrics.js';
import { $, h, icon, dialog, menu, toast } from './ui.js';
import { findLyrics } from './online.js';

export function createStage({ audio, getTrack, coverUrl, paintCover, changeCover, user, saveUser }) {
  const root = $('#stage');
  const box = $('#lyrics');
  const tools = $('#stageTools');
  const cache = new Map(); // id -> { text, source, variants }
  let id = null;
  let lines = [];
  let rows = [];
  let words = []; // на каждую строку: слова и когда каждое начинает звучать
  let active = -1;
  let touched = 0;
  let frame = 0;
  let request = 0;

  const offset = () => user().offsets[id] || 0;

  // строка из слов; внутри строки время делится по длине слов, если пословных меток нет
  function lineElement(l, next) {
    const parts = l.text.split(/\s+/).filter(Boolean);
    const gap = !parts.length;
    const texts = gap ? ['•', '•', '•'] : parts;
    const span = Math.max(0.3, (next ?? l.time + 6) - l.time);
    const length = texts.reduce((n, w) => n + w.length + 1, 0);
    // пауза тянется весь промежуток, а слова поются в темпе пения
    const sung = gap ? span : Math.min(span * 0.9, Math.max(0.8, length * 0.085 + 0.4));
    let passed = 0;
    const timed = l.words?.length === parts.length;
    const list = texts.map((text, k) => {
      const w = timed && !gap ? l.words[k] : null;
      const at = w ? w.start + (((w.end ?? w.start) - w.start) * (w.k || 0)) / (w.group || 1) : l.time + (sung * passed) / length;
      passed += text.length + 1;
      return { el: h('span', {}, text), at };
    });
    const el = h('button', {
      class: `line${gap ? ' gap' : ''}`,
      onclick: () => { audio.currentTime = Math.max(0, l.time + offset()); touched = 0; box.classList.remove('browsing'); audio.play().catch(() => {}); },
    }, list.flatMap((w, k) => (k ? [' ', w.el] : [w.el])));
    return { el, list };
  }

  function show(entry) {
    active = -1;
    rows = [];
    words = [];
    lines = entry?.text ? parseLrc(entry.text) : [];
    box.replaceChildren();
    box.scrollTop = 0;
    box.classList.remove('browsing');
    const timed = lines.length > 0;
    box.classList.toggle('plain', !timed);
    if (timed) {
      const built = lines.map((l, i) => lineElement(l, lines[i + 1]?.time));
      rows = built.map((b) => b.el);
      words = built.map((b) => b.list);
      box.append(...rows);
    } else if (entry?.text?.trim()) {
      box.append(h('div', { class: 'plaintext' }, entry.text.replace(/^\[[a-z]+:.*\]$/gim, '').trim()));
    } else {
      box.append(empty(entry?.note || 'Текст не найден', Boolean(getTrack(id))));
    }
    toolbar(entry, timed);
    tick();
  }

  const empty = (text, actions) => h('div', { class: 'nolyrics' }, h('p', {}, text),
    actions ? h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: online }, 'Найти в интернете'), h('button', { onclick: edit }, 'Вставить свой текст')) : null);

  function toolbar(entry, timed) {
    const track = getTrack(id);
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
      h('button', { id: 'soloButton', 'aria-pressed': String(user().solo), onclick: () => {
        user().solo = !user().solo;
        saveUser();
        root.classList.toggle('solo', user().solo);
        $('#soloButton').setAttribute('aria-pressed', String(user().solo));
        active = -1;
        tick();
      } }, 'Только текст'),
      track && h('button', { id: 'textMenu', onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        menu([
          { label: 'Найти текст в интернете', icon: 'search', run: online },
          { label: 'Свой текст', icon: 'edit', run: edit },
          entry?.source === 'saved' && { label: 'Сбросить текст', icon: 'close', run: forget },
          '-',
          { label: 'Сменить обложку', icon: 'album', run: () => changeCover(id) },
        ], r.left, r.bottom + 6);
      } }, icon('more'), 'Изменить'),
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
    box.classList.add('plain');
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
    entry ||= { note: 'У этой песни нет текста' };
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
      const browsing = Date.now() - touched < 4000;
      if (i !== active || box.classList.contains('browsing') !== browsing) {
        const first = active === -1;
        rows[active]?.classList.remove('on');
        active = i;
        box.classList.toggle('browsing', browsing);
        rows.forEach((r, k) => {
          r.classList.toggle('past', k < i);
          // чем дальше строка от текущей, тем мягче она видна
          r.style.setProperty('--far', Math.min(4, Math.abs(k - Math.max(0, i))));
        });
        rows[i]?.classList.add('on');
        // после ручной прокрутки несколько секунд не мешаем
        if (!browsing) {
          const row = rows[Math.max(0, i)];
          box.scrollTo({ top: row.offsetTop - box.clientHeight * 0.4 + row.offsetHeight / 2, behavior: first ? 'auto' : 'smooth' });
        }
      }
      words[i]?.forEach((w) => w.el.classList.toggle('sung', t >= w.at));
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
    paintCover($('#stageCover'), track);
    paintCover($('#stageLabel'), track);
    const url = coverUrl(track, true);
    for (const layer of root.querySelectorAll('.backdrop i')) layer.style.backgroundImage = url ? `url("${url}")` : '';
    if (changed && !root.hidden) { touched = 0; load(); }
  }

  return {
    get open() { return !root.hidden; },
    setTrack,
    toggle(on = root.hidden) {
      if (on === !root.hidden) return;
      root.hidden = !on;
      document.body.classList.toggle('staged', on);
      if (on) {
        touched = 0;
        root.classList.toggle('solo', user().solo);
        setTrack(id);
        load();
        root.focus();
      } else cancelAnimationFrame(frame);
    },
  };
}
