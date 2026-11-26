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

const singTime = (text) => Math.max(1.1, [...text].length * 0.095 + 0.7);

// Возвращает ленту: строки текста + паузы (три точки).
export function buildTimeline(parsed, duration, offset = 0) {
  const items = [];
  const src = parsed.map((l) => ({ ...l, time: l.time + offset }));
  const total = duration || (src.length ? src[src.length - 1].time + 8 : 0);
  let quietFrom = 0; // с какого момента никто не поёт
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (!l.text) { if (items.length) quietFrom = Math.min(quietFrom, l.time); continue; }
    if (l.time - quietFrom >= (items.length ? 5 : 3.5)) {
      items.push({ dots: true, time: items.length ? quietFrom + 0.15 : 0, end: l.time - 0.1, text: '' });
    }
    const next = src[i + 1];
    const nextTime = next ? next.time : total;
    const gap = Math.max(0.3, nextTime - l.time);
    const est = singTime(l.text);
    // если до следующей строки близко — поём весь промежуток, иначе по оценке
    let end = l.time + (gap <= est * 1.6 ? gap * 0.94 : est * 1.15);
    if (next && !next.text) end = l.time + Math.min(gap * 0.97, est * 1.8);

    let words;
    if (l.words?.length) {
      words = l.words.map((w, k) => {
        const e = w.end ?? l.words[k + 1]?.start ?? end;
        const span = Math.max(0.05, e - w.start);
        const g = w.group || 1;
        return { text: w.text, start: w.start + offset + (span * (w.k || 0)) / g, end: w.start + offset + (span * ((w.k || 0) + 1)) / g };
      });
      end = words[words.length - 1].end;
    } else {
      const parts = l.text.split(' ');
      const weights = parts.map((p) => [...p].length + 1.2);
      const sum = weights.reduce((a, b) => a + b, 0);
      let at = l.time;
      words = parts.map((p, k) => {
        const d = ((end - l.time) * weights[k]) / sum;
        const w = { text: p, start: at, end: at + d };
        at += d;
        return w;
      });
    }
    // *слово* — выделить цветом
    let marking = false;
    words = words.map((w) => {
      let s = w.text;
      const opens = s.startsWith('*');
      if (opens) marking = true;
      const mark = marking;
      if (/\*[\p{P}]*$/u.test(opens ? s.slice(1) : s)) marking = false;
      s = s.replace(/\*/g, '');
      return { ...w, text: s, mark };
    }).filter((w) => w.text);
    if (!words.length) continue;
    const marked = words.filter((w) => w.mark);
    const longest = words.reduce((a, b) => ([...b.text].length > [...a.text].length ? b : a));
    const key = (marked.length ? marked.map((w) => w.text).join(' ') : longest.text).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const label = key ? key[0].toUpperCase() + key.slice(1) : '';
    items.push({ time: l.time, end, text: l.text.replace(/\*/g, ''), words, label });
    quietFrom = next && !next.text ? Math.max(next.time, end) : end;
    // длинная пауза без пустой метки тоже считается проигрышем
    if (next && !next.text) i++;
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
