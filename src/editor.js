// Построчный редактор текста. Тексты вставляются только через value/textContent.
import { tokens, joinTokens, formatTime, parseTime, keyWord } from './lyrics.js';
import { FONTS } from './fonts.js';

const SWATCHES = ['#ff5468', '#ff9a3d', '#ffd84a', '#5ee58a', '#2fe3c6', '#5a8dff', '#b98cff', '#ff7ad9'];

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function createEditor(list, actions) {
  let rows = [];
  let openId = null;
  let currentId = null;

  const chips = (box, value) => {
    box.textContent = '';
    const words = tokens(value);
    words.forEach((w, i) => {
      const b = el('button', { type: 'button', className: 'word', textContent: w.text, title: 'Нажмите, чтобы слово стало цветным' });
      b.dataset.token = i;
      b.setAttribute('aria-pressed', String(w.mark));
      box.append(b);
    });
    return words;
  };

  const shiftButton = () => {
    const b = el('button', { type: 'button', className: 'wide', textContent: 'Поётся сейчас: сдвинуть отсюда и до конца' });
    b.dataset.act = 'shift';
    return b;
  };

  const details = (row, data) => {
    const box = el('div', { className: 'words' });
    const words = chips(box, data.text);
    const label = el('input', { className: 'label', value: data.label || '', maxLength: 24, placeholder: keyWord(words) || 'само' });
    row.querySelector('.more')?.remove();
    row.append(el('div', { className: 'more' },
      shiftButton(),
      el('p', { className: 'hint', textContent: words.length ? 'Цветные слова: нажмите на нужные' : 'Пустая строка — это проигрыш' }),
      box,
      ...(words.length ? [looks(data)] : []),
      el('label', { className: 'ring-row', textContent: 'Слово под кругом' }, label)));
  };

  // цвет, шрифт и автор строки
  const looks = (data) => {
    const colors = el('div', { className: 'swatches', role: 'group', ariaLabel: 'Цвет строки' });
    const swatch = (value, title) => {
      const b = el('button', { type: 'button', className: 'swatch', title });
      b.dataset.color = value;
      b.setAttribute('aria-label', title);
      if (value) b.style.background = value;
      return b;
    };
    colors.append(swatch('', 'Обычный цвет'), ...SWATCHES.map((c) => swatch(c, `Цвет ${c}`)),
      el('input', { type: 'color', className: 'color', value: data.color || '#ffffff', title: 'Свой цвет', ariaLabel: 'Свой цвет строки' }));
    mark(colors, data.color);
    const font = el('select', { className: 'font' }, new Option('как у всего текста', ''), ...Object.entries(FONTS).map(([key, f]) => new Option(f.name, key)));
    font.value = data.font || '';
    const side = el('select', { className: 'side' }, new Option('по очереди', ''), new Option('собеседник', 'them'), new Option('я', 'me'));
    side.value = data.side || '';
    return el('div', { className: 'looks' },
      el('p', { className: 'hint', textContent: 'Цвет строки' }), colors,
      el('label', { textContent: 'Шрифт строки' }, font),
      el('label', { className: 'side-row', textContent: 'Кто пишет в переписке' }, side));
  };
  const mark = (box, color) => box.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === (color || ''))));

  const open = (row) => {
    if (!row || openId === Number(row.dataset.id)) return;
    list.querySelector('.more')?.remove();
    list.querySelector('li.open')?.classList.remove('open');
    openId = Number(row.dataset.id);
    row.classList.add('open');
    details(row, rows.find((r) => r.id === openId));
  };

  function create(data) {
    const button = (act, textContent, title) => {
      const b = el('button', { type: 'button', textContent, title });
      b.dataset.act = act;
      b.setAttribute('aria-label', title);
      return b;
    };
    const row = el('li', {}, el('div', { className: 'main' },
      el('input', { className: 'time', value: formatTime(data.time), inputMode: 'decimal', ariaLabel: 'Время строки' }),
      el('input', { className: 'text', value: data.text, placeholder: 'проигрыш', ariaLabel: 'Текст строки' }),
      button('play', '▶', 'Слушать с этой строки'),
      button('now', '◷', 'Поставить текущее время трека'),
      button('del', '✕', 'Удалить строку')));
    row.dataset.id = data.id;
    if (data.id === currentId) row.classList.add('now');
    if (data.id === openId) { row.classList.add('open'); details(row, data); }
    return row;
  }

  const put = (input, value) => { if (input.value !== value) input.value = value; };

  // строки переиспользуются: после пересортировки фокус и клик не теряются
  function render(next) {
    rows = next;
    const active = document.activeElement;
    const ids = new Set(rows.map((r) => r.id));
    for (const li of [...list.children]) if (!ids.has(Number(li.dataset.id))) li.remove();
    const old = new Map([...list.children].map((li) => [Number(li.dataset.id), li]));
    rows.forEach((data, i) => {
      let row = old.get(data.id);
      if (row) {
        put(row.querySelector('.time'), formatTime(data.time));
        put(row.querySelector('.text'), data.text);
      } else row = create(data);
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
    });
    if (active !== document.activeElement && list.contains(active)) active.focus({ preventScroll: true });
  }

  // раскрываем только по полям: если раскрывать по кнопкам, список сдвинется и клик пропадёт
  list.addEventListener('focusin', (e) => { if (e.target.tagName === 'INPUT' && e.target.type !== 'color') open(e.target.closest('li')); });

  list.addEventListener('input', (e) => {
    const row = e.target.closest('li');
    const data = rows.find((r) => r.id === Number(row.dataset.id));
    if (e.target.classList.contains('text')) {
      data.text = e.target.value;
      actions.text(data.id, data.text);
      const box = row.querySelector('.words');
      if (box) {
        const words = chips(box, data.text);
        row.querySelector('.label').placeholder = keyWord(words) || 'само';
      }
    } else if (e.target.classList.contains('label')) {
      data.label = e.target.value;
      actions.label(data.id, data.label);
    } else if (e.target.classList.contains('color')) {
      data.color = e.target.value;
      mark(e.target.parentElement, data.color);
      actions.color(data.id, data.color);
    } else if (e.target.classList.contains('font')) {
      data.font = e.target.value;
      actions.font(data.id, data.font);
    } else if (e.target.classList.contains('side')) {
      data.side = e.target.value;
      actions.side(data.id, data.side);
    }
  });

  list.addEventListener('change', (e) => {
    if (!e.target.classList.contains('time')) return;
    const id = Number(e.target.closest('li').dataset.id);
    const seconds = parseTime(e.target.value);
    if (seconds == null) e.target.value = formatTime(rows.find((r) => r.id === id).time);
    else actions.time(id, seconds);
  });

  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
  });

  list.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('li');
    const id = Number(row.dataset.id);
    if (b.dataset.act) { actions[b.dataset.act](id); return; }
    const data = rows.find((r) => r.id === id);
    if (b.dataset.color !== undefined) {
      data.color = b.dataset.color;
      mark(b.parentElement, data.color);
      actions.color(id, data.color);
      return;
    }
    const words = tokens(data.text);
    const w = words[Number(b.dataset.token)];
    w.mark = !w.mark;
    data.text = joinTokens(words);
    row.querySelector('.text').value = data.text;
    b.setAttribute('aria-pressed', String(w.mark));
    actions.text(id, data.text);
  });

  return {
    render,
    // пересоздать строки целиком (после отмены меняются и скрытые поля)
    reset() { list.textContent = ''; },
    focus(id) { list.querySelector(`li[data-id="${id}"] .text`)?.focus(); },
    highlight(id) {
      if (id === currentId) return;
      currentId = id;
      list.querySelector('li.now')?.classList.remove('now');
      const row = id == null ? null : list.querySelector(`li[data-id="${id}"]`);
      if (!row) return;
      row.classList.add('now');
      // список сам следует за песней, пока в нём ничего не редактируют
      if (!list.contains(document.activeElement)) {
        list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 3;
      }
    },
  };
}
