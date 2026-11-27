// Мелкие части интерфейса. Названия из тегов вставляются только как текст.

export const $ = (s, root = document) => root.querySelector(s);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === false || c === null || c === undefined) continue;
    el.append(c);
  }
  return el;
}

const line = (d) => `<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
const fill = (d) => `<path fill="currentColor" d="${d}"/>`;
const ICONS = {
  home: line('M4 11l8-7 8 7M6 10v9h4v-5h4v5h4v-9'),
  search: line('M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4'),
  note: line('M9 18V6l10-2v12') + fill('M6.5 15.5a3 3 0 100 6 3 3 0 000-6zM16.5 13.5a3 3 0 100 6 3 3 0 000-6z'),
  album: line('M12 3a9 9 0 100 18 9 9 0 000-18z') + fill('M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z'),
  artist: line('M12 4a4 4 0 100 8 4 4 0 000-8zM5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5'),
  heart: line('M12 20s-8-4.8-8-10.6C4 6.4 6.1 5 8.2 5c1.7 0 3.1 1 3.8 2.4C12.700 6 14.100 5 15.800 5 17.900 5 20 6.400 20 9.400 20 15.200 12 20 12 20z'),
  heartFull: fill('M12 21s-9-5.2-9-11.6C3 6 5.500 4 8.200 4c1.600 0 3 .800 3.800 2 .800-1.200 2.200-2 3.800-2C18.500 4 21 6 21 9.400 21 15.800 12 21 12 21z'),
  list: line('M4 7h12M4 12h12M4 17h8') + fill('M18 14l4 3-4 3z'),
  queue: line('M4 6h16M4 11h16M4 16h9') + fill('M16 14l5 3.500-5 3.500z'),
  lyrics: line('M4 6h16M4 11h10M4 16h13'),
  tape: line('M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1zM8.500 9.500a2 2 0 100 4 2 2 0 000-4zM15.500 9.500a2 2 0 100 4 2 2 0 000-4zM8 18l1.500-3h5L16 18'),
  settings: line('M4 7h9M17 7h3M4 17h3M11 17h9') + line('M15 4.500a2.500 2.500 0 100 5 2.500 2.500 0 000-5zM9 14.500a2.500 2.500 0 100 5 2.500 2.500 0 000-5z'),
  folder: line('M3 7a2 2 0 012-2h4l2 3h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2z'),
  plus: line('M12 5v14M5 12h14'),
  back: line('M15 5l-7 7 7 7'),
  forward: line('M9 5l7 7-7 7'),
  play: fill('M8 5.200v13.600a1 1 0 001.500.850l10.700-6.800a1 1 0 000-1.700L9.500 4.350A1 1 0 008 5.200z'),
  pause: fill('M7 5h3.500v14H7zM13.500 5H17v14h-3.500z'),
  prev: fill('M6 5h2.500v14H6zM19 5.500v13a.800.800 0 01-1.250.650L9.600 12.650a.800.800 0 010-1.300l8.150-6.500A.800.800 0 0119 5.500z'),
  next: fill('M15.500 5H18v14h-2.500zM5 5.500v13a.800.800 0 001.250.650l8.150-6.500a.800.800 0 000-1.300l-8.150-6.500A.800.800 0 005 5.500z'),
  shuffle: line('M3 7h3c5 0 7 10 12 10h3M3 17h3c1.800 0 3.200-1.300 4.400-3M13.600 10C14.800 8.300 16.200 7 18 7h3M18 4l3 3-3 3M18 14l3 3-3 3'),
  repeat: line('M17 3l3 3-3 3M4 12v-2a4 4 0 014-4h12M7 21l-3-3 3-3M20 12v2a4 4 0 01-4 4H4'),
  volume: fill('M4 9h4l5-4v14l-5-4H4z') + line('M16 9a4 4 0 010 6M18.500 6.500a8 8 0 010 11'),
  muted: fill('M4 9h4l5-4v14l-5-4H4z') + line('M16 9.500l5 5M21 9.500l-5 5'),
  more: fill('M5 10.200a1.800 1.800 0 100 3.600 1.800 1.800 0 000-3.600zM12 10.200a1.800 1.800 0 100 3.600 1.800 1.800 0 000-3.600zM19 10.200a1.800 1.800 0 100 3.600 1.800 1.800 0 000-3.600z'),
  close: line('M6 6l12 12M18 6L6 18'),
  clock: line('M12 4a8 8 0 100 16 8 8 0 000-16zM12 8v4l3 2'),
  trash: line('M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13'),
  edit: line('M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3'),
};

export const icon = (name) => {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
};

export function setIcon(el, name) {
  if (el.dataset.now === name) return;
  el.dataset.now = name;
  el.querySelector(':scope > .ico')?.remove();
  el.prepend(icon(name));
}

export const clock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60);
  const tail = String(s % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${tail}` : `${m}:${tail}`;
};

export function plural(n, one, few, many) {
  const d = n % 10;
  const t = n % 100;
  return `${n} ${d === 1 && t !== 11 ? one : d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many}`;
}
export const tracksWord = (n) => plural(n, 'песня', 'песни', 'песен');

export function duration(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
}

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- меню по правой кнопке ---------- */

let openMenu = null;
export function closeMenu() {
  openMenu?.forEach((m) => m.remove());
  openMenu = null;
}

// пункты: { label, icon, run, items, danger } или '-' для черты
export function menu(items, x, y) {
  closeMenu();
  openMenu = [];
  const build = (list, level) => {
    const box = h('div', { class: 'menu', role: 'menu' });
    for (const item of list.filter(Boolean)) {
      if (item === '-') { box.append(h('hr')); continue; }
      const b = h('button', { role: 'menuitem', class: item.danger ? 'danger' : '' },
        item.icon ? icon(item.icon) : h('span', { class: 'ico' }), h('span', {}, item.label), item.items ? icon('forward') : null);
      const sub = () => {
        openMenu.splice(level + 1).forEach((m) => m.remove());
        if (!item.items) return;
        const child = build(item.items, level + 1);
        const r = b.getBoundingClientRect();
        place(child, r.right + 4, r.top - 6, r.left - 4);
      };
      b.addEventListener('mouseenter', sub);
      b.addEventListener('click', () => {
        if (item.items) return sub();
        closeMenu();
        item.run();
      });
      box.append(b);
    }
    openMenu[level] = box;
    document.body.append(box);
    return box;
  };
  const place = (box, left, top, flip) => {
    const { offsetWidth: w, offsetHeight: height } = box;
    box.style.left = `${left + w > innerWidth - 8 ? Math.max(8, (flip ?? innerWidth - 8) - w) : left}px`;
    box.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
  };
  const root = build(items, 0);
  place(root, x, y);
  root.querySelector('button')?.focus({ preventScroll: true });
}

addEventListener('pointerdown', (e) => { if (openMenu && !e.target.closest('.menu')) closeMenu(); }, true);
addEventListener('blur', closeMenu);
addEventListener('resize', closeMenu);
addEventListener('keydown', (e) => {
  if (!openMenu) return;
  if (e.key === 'Escape') { closeMenu(); e.preventDefault(); e.stopImmediatePropagation(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const buttons = [...openMenu.at(-1).querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}, true);

/* ---------- окна ---------- */

// содержимое + кнопки; возвращает значение нажатой кнопки или null
export function dialog(title, body, buttons) {
  return new Promise((resolve) => {
    const d = h('dialog', {});
    const form = h('form', { method: 'dialog' },
      h('h2', {}, title), body,
      h('div', { class: 'actions' }, buttons.map(([label, value, kind]) => h('button', { value, class: kind || '', formnovalidate: value === 'cancel' }, label))));
    d.append(form);
    // Enter в поле нажимает главную кнопку
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input')) {
        e.preventDefault();
        form.querySelector('.primary')?.click();
      }
    });
    d.addEventListener('close', () => {
      d.remove();
      resolve(d.returnValue && d.returnValue !== 'cancel' ? d.returnValue : null);
    });
    document.body.append(d);
    d.showModal();
    d.querySelector('input[type=text]')?.select();
  });
}

export async function ask(title, value = '', ok = 'Сохранить') {
  const input = h('input', { type: 'text', value, maxlength: '80', 'aria-label': title });
  const done = await dialog(title, input, [['Отмена', 'cancel'], [ok, 'ok', 'primary']]);
  return done ? input.value.trim() || null : null;
}

export async function confirmDialog(title, text, ok) {
  return Boolean(await dialog(title, h('p', {}, text), [['Отмена', 'cancel'], [ok, 'ok', 'primary']]));
}
