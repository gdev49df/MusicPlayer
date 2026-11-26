// Разбор LRC и расчёт таймингов строк и слов.

const TIME = /\[(\d{1,3}):(\d{1,2}(?:[.,:]\d{1,3})?)\]/g;
const WORD = /<(\d{1,3}):(\d{1,2}(?:[.,]\d{1,3})?)>/g;
const sec = (m, s) => Number(m) * 60 + Number(s.replace(/[,:]/, '.'));

export function parseLrc(text) {
  const out = [];
  let tagOffset = 0;
  for (const raw of (text || '').split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { tagOffset = Number(off[1]) / 1000; continue; }
    const stamps = [...raw.matchAll(TIME)];
    if (!stamps.length) continue;
    const body = raw.replace(TIME, '').trim();
    let words = null;
    const marks = [...body.matchAll(WORD)];
    if (marks.length) {
      words = [];
      marks.forEach((m, i) => {
        const chunk = body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length).trim();
        const at = sec(m[1], m[2]);
        if (words.length && words[words.length - 1].end == null) words[words.length - 1].end = at;
        if (chunk) {
          const parts = chunk.split(/\s+/);
          parts.forEach((p, k) => words.push({ text: p, start: at, end: null, group: parts.length, k }));
        }
      });
    }
    const clean = body.replace(WORD, ' ').replace(/\s+/g, ' ').trim();
    for (const s of stamps) {
      out.push({ time: sec(s[1], s[2]), text: clean, words: stamps.length === 1 ? words : null });
    }
  }
  out.sort((a, b) => a.time - b.time);
  for (const l of out) {
    l.time -= tagOffset;
    l.words?.forEach((w) => { w.start -= tagOffset; if (w.end != null) w.end -= tagOffset; });
  }
  return out;
}

// *слово* или *несколько слов* — выделить цветом
export function tokens(text) {
  let marking = false;
  return (text || '').split(/\s+/).filter(Boolean).map((w) => {
    const opens = w.startsWith('*');
    if (opens) marking = true;
    const mark = marking;
    if (/\*[\p{P}]*$/u.test(opens ? w.slice(1) : w)) marking = false;
    return { text: w.replace(/\*/g, ''), mark };
  }).filter((w) => w.text);
}

export const joinTokens = (list) => list.map((w) => (w.mark ? `*${w.text}*` : w.text)).join(' ');

export function keyWord(list) {
  if (!list.length) return '';
  const marked = list.filter((w) => w.mark);
  const longest = list.reduce((a, b) => ([...b.text].length > [...a.text].length ? b : a));
  const key = (marked.length ? marked.map((w) => w.text).join(' ') : longest.text)
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return key ? key[0].toUpperCase() + key.slice(1) : '';
}

// Переводит тайминги исходного текста во время того, что реально звучит.
export function retime(lines, { stretch = 1, offset = 0, speed = 1 } = {}) {
  const at = (t) => (t * stretch + offset) / speed;
  return lines.map((l) => ({
    ...l,
    time: at(l.time),
    words: l.words?.map((w) => ({ ...w, start: at(w.start), end: w.end == null ? null : at(w.end) })) || null,
  }));
}

const singTime = (text) => Math.max(1.1, [...text].length * 0.095 + 0.7);

const LEAD = 0.1; // заливка чуть опережает голос, иначе кажется, что она отстаёт

// Сколько секунд уходит на букву именно в этой песне. Берём плотные строки:
// там промежуток до следующей почти целиком занят пением.
function charTime(lines, pace) {
  const rates = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const text = tokens(lines[i].text).map((w) => w.text).join(' ');
    const gap = lines[i + 1].time - lines[i].time;
    if (text && gap > 0.4 && gap < 12) rates.push(gap / ([...text].length + 4));
  }
  if (rates.length < 4) return 0.075 * pace;
  rates.sort((a, b) => a - b);
  return Math.max(0.045 * pace, Math.min(0.12 * pace, rates[Math.floor(rates.length * 0.3)]));
}

// Возвращает ленту: строки текста + паузы (три точки).
// pace — растяжение темпа (slowed > 1), fill — скорость заливки слов.
export function buildTimeline(lines, duration, pace = 1, fill = 1) {
  const perChar = charTime(lines, pace);
  const items = [];
  const total = duration || (lines.length ? lines[lines.length - 1].time + 8 : 0);
  let quietFrom = 0; // с какого момента никто не поёт
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const list = tokens(l.text);
    if (!list.length) { if (items.length) quietFrom = Math.min(quietFrom, l.time); continue; }
    if (l.time - quietFrom >= (items.length ? 5 : 3.5)) {
      items.push({ dots: true, time: items.length ? quietFrom + 0.15 : 0, end: l.time - 0.1, text: '' });
    }
    const next = lines[i + 1];
    const silentNext = next && !tokens(next.text).length;
    const nextTime = next ? next.time : total;
    const gap = Math.max(0.3, nextTime - l.time);
    const plain = list.map((w) => w.text).join(' ');
    const est = singTime(plain) * pace;
    // если до следующей строки близко — поём весь промежуток, иначе по оценке
    let end = l.time + (gap <= est * 1.6 ? gap * 0.94 : est * 1.15);
    if (silentNext) end = l.time + Math.min(gap * 0.97, est * 1.8);

    let words;
    // пословные тайминги годятся, только пока число слов не меняли вручную
    if (l.words?.length === list.length) {
      words = l.words.map((w, k) => {
        const e = w.end ?? l.words[k + 1]?.start ?? end;
        const span = Math.max(0.05, e - w.start);
        const g = w.group || 1;
        return { ...list[k], start: w.start + (span * (w.k || 0)) / g, end: w.start + (span * ((w.k || 0) + 1)) / g };
      });
      end = words[words.length - 1].end;
    } else {
      const weights = list.map((w) => [...w.text].length + 1.2);
      const sum = weights.reduce((a, b) => a + b, 0);
      // слова заливаются в темпе пения, а не растягиваются на всю паузу до следующей строки
      const sung = Math.min(gap * 0.9, Math.max(0.7, ([...plain].length + 4) * perChar) / fill);
      let at = Math.max(0, l.time - LEAD);
      words = list.map((w, k) => {
        const d = (sung * weights[k]) / sum;
        const word = { ...w, start: at, end: at + d };
        at += d;
        return word;
      });
    }
    const custom = (l.label || '').trim();
    items.push({ time: l.time, end, text: plain, words, label: custom || keyWord(list), custom: Boolean(custom), color: l.color, font: l.font, side: l.side });
    quietFrom = silentNext ? Math.max(next.time, end) : end;
    if (silentNext) i++;
  }
  if (items.length && total - quietFrom >= 6) items.push({ dots: true, time: quietFrom + 0.15, end: total, text: '' });
  return items;
}

export function toLrc(lines) {
  return lines
    .map((l) => {
      const c = Math.max(0, Math.round(l.time * 100));
      const p = (n) => String(n).padStart(2, '0');
      return `[${p(Math.floor(c / 6000))}:${p(Math.floor(c / 100) % 60)}.${p(c % 100)}] ${l.text}`.trimEnd();
    })
    .join('\n');
}

// обычный текст без таймингов равномерно раскладывается по промежутку
export function distribute(texts, from, to) {
  const step = Math.max(0.5, Math.min(6, (to - from) / Math.max(1, texts.length)));
  return texts.map((text, i) => ({ time: from + i * step, text, words: null }));
}

export const formatTime = (s) => {
  const c = Math.max(0, Math.round(s * 10));
  return `${Math.floor(c / 600)}:${String(Math.floor(c / 10) % 60).padStart(2, '0')}.${c % 10}`;
};

export function parseTime(str) {
  const m = String(str).trim().replace(',', '.').match(/^(?:(\d{1,3}):)?(\d{1,4}(?:\.\d+)?)$/);
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : null;
}
