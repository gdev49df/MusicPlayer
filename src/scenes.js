// Вертикальные стили: переписка, экран блокировки, пластинка и кассета.
// Как и всё в кадре, рисуются только от времени t.
import { text, fit, box, glass, poly, paintBackground, background, wrapLines, frosted, statusBar } from './deck.js';
import { distort, overlay, hash } from './effects.js';
import { pop, alphaOf, fmt } from './render.js';
import { FONTS, cssFont } from './fonts.js';

const W = 1080;
const H = 1920;
const TAU = Math.PI * 2;
const FONT = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
const white = (a) => `rgba(255,255,255,${a})`;
const mix = (a, b, k) => a + (b - a) * k;
const progress = (r, t) => (r.duration ? clamp(t / r.duration) : 0);

// кто пишет: выбранное у строки, иначе по очереди
export const sideOf = (item, index) => (item.side === 'me' || item.side === 'them' ? item.side : index % 2 ? 'me' : 'them');
export const messageEvents = (items) => items.filter((i) => !i.dots).map((it, i) => ({ at: it.time, side: sideOf(it, i) }));

function circle(g, x, y, r, fill) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

function artIn(g, r, x, y, s, radius, angle = 0) {
  g.save();
  g.beginPath();
  g.roundRect(x, y, s, s, radius);
  g.clip();
  g.translate(x + s / 2, y + s / 2);
  g.rotate(angle);
  g.drawImage(r.art, -s / 2, -s / 2, s, s);
  g.restore();
}

// слова строки внутри пузыря или уведомления; спетые ярче
function words(r, g, line, x, y, t, color, mark, quiet = 0.5) {
  g.font = line.font;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const base = g.globalAlpha;
  line.rows.forEach((row, i) => {
    for (const w of row) {
      const p = r.style.karaoke ? smooth((t - w.start + 0.08) / Math.max(0.12, (w.end - w.start) * 0.6)) : 1;
      g.globalAlpha = base * mix(quiet, 1, p);
      g.fillStyle = w.mark ? mark : line.color || color;
      g.fillText(w.text, x + w.x, y + line.lh * (i + 0.5));
    }
  });
  g.globalAlpha = base;
}

function empty(r, g, y) {
  if (!r.emptyText) return;
  text(g, fit(g, r.emptyText, 940, 38, 700), W / 2, y, 38, 700, white(0.6), 'center');
}

/* ---------- переписка ---------- */

const CHAT = { left: 52, right: 1028, top: 322, bottom: 1462, gap: 18, typing: 108 };

// когда собеседник (или вы) начинает печатать сообщение номер i
const typingFrom = (list, i) => Math.max((list[i - 1]?.line.time ?? -9) + 0.45, list[i].line.time - 1.5);

function dotsBubble(g, x, y, t, alpha) {
  g.save();
  g.globalAlpha = alpha;
  box(g, x, y - CHAT.typing + CHAT.gap, 150, CHAT.typing - CHAT.gap, 45, 'rgba(46,45,58,.94)');
  for (let i = 0; i < 3; i++) {
    const up = Math.max(0, Math.sin(t * 7 - i * 0.9));
    circle(g, x + 45 + i * 30, y - 45 - up * 10, 9, white(0.45 + up * 0.5));
  }
  g.restore();
}

function chat(r, g, t) {
  background(r, g, t, r.beat(t) * r.deck.pulse);
  g.fillStyle = 'rgba(6,6,10,.34)';
  g.fillRect(0, 0, W, H);
  const [R, G, B] = r.accentRgb;
  const list = r.lines.filter((l) => !l.dots).map((line, i) => ({ line, side: sideOf(line, i) }));
  if (!list.length) empty(r, g, 900);

  let last = -1;
  while (last + 1 < list.length && list[last + 1].line.time <= t + 0.05) last++;
  const next = list[last + 1];
  const from = next ? typingFrom(list, last + 1) : Infinity;
  const writing = next && next.line.time - from >= 0.35 && t >= from ? next : null;
  const incoming = writing?.side === 'them';

  // сообщения растут снизу вверх
  const size = (m) => ({ w: Math.max(150, m.line.width + 72), h: m.line.h + 48 });
  let offset = incoming ? CHAT.typing * smooth((t - from) / 0.22) : 0;
  if (incoming) dotsBubble(g, CHAT.left, CHAT.bottom, t, smooth((t - from) / 0.18));
  for (let i = last; i >= 0; i--) {
    const m = list[i];
    const { w, h } = size(m);
    const age = t - m.line.time + 0.05;
    const grow = smooth(age / 0.3);
    const me = m.side === 'me';
    const bottom = CHAT.bottom - offset;
    // на месте уходящего «печатает» остаётся запас, чтобы лента не прыгала
    const held = i === last && !me && last >= 0 && m.line.time - typingFrom(list, i) >= 0.35 ? CHAT.typing : 0;
    offset += i === last ? mix(held, h + CHAT.gap, grow) : h + CHAT.gap;
    const top = bottom - h;
    if (top < CHAT.top - 70) break;
    const x = me ? CHAT.right - w : CHAT.left;
    const k = 0.55 + 0.45 * pop(age);
    g.save();
    g.globalAlpha = smooth(age / 0.12) * smooth((top - CHAT.top + 70) / 90);
    g.translate(me ? x + w : x, bottom);
    g.scale(k, k);
    g.translate(me ? -x - w : -x, -bottom);
    let fill = 'rgba(46,45,58,.94)';
    if (me) {
      fill = g.createLinearGradient(x, top, x + w, bottom);
      fill.addColorStop(0, `rgb(${Math.round(R * 0.78)},${Math.round(G * 0.7)},${Math.round(B * 0.82)})`);
      fill.addColorStop(1, `rgb(${Math.round(R * 0.55)},${Math.round(G * 0.44)},${Math.round(B * 0.62)})`);
    }
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 24;
    g.shadowOffsetY = 8;
    g.beginPath();
    g.roundRect(x, top, w, h, me ? [46, 46, 12, 46] : [46, 46, 46, 12]);
    g.fillStyle = fill;
    g.fill();
    g.shadowColor = 'transparent';
    words(r, g, m.line, x + 36, top + 24, t, '#fff', me ? '#ffe58f' : r.accent, 0.62);
    g.restore();
  }

  // шапка поверх ленты
  g.fillStyle = 'rgba(10,10,15,.55)';
  g.fillRect(0, 0, W, 262);
  g.fillStyle = white(0.1);
  g.fillRect(0, 262, W, 2);
  statusBar(r, g, [60, 52]);
  g.strokeStyle = r.accent;
  g.lineWidth = 8;
  g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.moveTo(66, 160); g.lineTo(42, 186); g.lineTo(66, 212); g.stroke();
  artIn(g, r, 96, 134, 104, 52);
  const name = r.chat.name || r.meta.artist || 'Собеседник';
  text(g, fit(g, name, 560, 42, 800), 224, 164, 42, 800);
  text(g, incoming ? 'печатает…' : 'в сети', 224, 214, 29, 600, incoming ? r.accent : white(0.55));
  // кнопки звонка
  g.fillStyle = r.accent;
  g.beginPath(); g.roundRect(866, 166, 50, 40, 11); g.fill();
  poly(g, [[922, 186], [944, 168], [944, 204]]);
  g.lineWidth = 9;
  g.beginPath(); g.arc(1006, 168, 36, Math.PI * 0.52, Math.PI * 0.98); g.stroke();
  circle(g, 971, 172, 9, r.accent);
  circle(g, 1002, 203, 9, r.accent);

  // поле ввода: свои сообщения сначала набираются в нём
  const mine = writing?.side === 'me' ? writing : null;
  const field = CHAT.right - CHAT.left - 114; // до кнопки отправки
  box(g, CHAT.left, 1494, field, 96, 48, 'rgba(30,30,40,.92)');
  if (mine) {
    const p = clamp((t - from) / Math.max(0.2, mine.line.time - from - 0.2));
    const chars = [...mine.line.text];
    const typed = chars.slice(0, Math.ceil(chars.length * p)).join('');
    g.save();
    g.beginPath(); g.rect(CHAT.left + 36, 1494, field - 70, 96); g.clip();
    g.font = `500 38px ${FONT}`;
    const width = g.measureText(typed).width;
    const x = CHAT.left + 40 - Math.max(0, width - (field - 96));
    text(g, typed, x, 1543, 38, 500);
    if (Math.floor(t * 3) % 2 === 0 || p < 1) g.fillRect(x + width + 4, 1520, 4, 46);
    g.restore();
  } else text(g, 'Сообщение', CHAT.left + 40, 1543, 38, 500, white(0.4));
  const ready = mine ? smooth((t - mine.line.time + 0.25) / 0.2) : 0;
  const sx = CHAT.right - 48;
  circle(g, sx, 1542, 48 * (1 + 0.12 * Math.sin(ready * Math.PI)), mine ? r.accent : 'rgba(60,60,74,.95)');
  g.fillStyle = '#fff';
  poly(g, [[sx, 1514], [sx + 24, 1546], [sx + 8, 1546], [sx + 8, 1570], [sx - 8, 1570], [sx - 8, 1546], [sx - 24, 1546]]);
}

/* ---------- экран блокировки ---------- */

const LOCK = { x: 50, w: 980, top: 778, bottom: 1596, gap: 16 };

function wallpaper(r, g, t, beat) {
  const d = r.deck;
  const src = r.cardMedia || r.cover;
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  const zoom = 1.08 + (r.style.motion ? Math.sin(t * 0.11) * 0.05 : 0) + beat * 0.035;
  const image = (dx = 0) => {
    if (!sw || !sh) return;
    const k = Math.max(W / sw, H / sh) * zoom;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, (W - sw * k) / 2 + dx, (H - sh * k) / 2, sw * k, sh * k);
  };
  g.fillStyle = '#101018';
  g.fillRect(0, 0, W, H);
  image();
  const ft = r.fxTime ?? t;
  distort(g, [0, 0, W, H], ft, d.effect, d.strength, beat, image);
  if (d.mono) {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
  }
  overlay(g, [0, 0, W, H], ft, d.effect, d.strength, beat, r.accentRgb);
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(0,0,0,.42)');
  shade.addColorStop(0.24, 'rgba(0,0,0,.18)');
  shade.addColorStop(0.5, 'rgba(0,0,0,.36)');
  shade.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
}

function lockPlayer(r, g, t) {
  const y = 484;
  glass(r, g, [50, y, 980, 268], 48, 0.09);
  artIn(g, r, 80, y + 28, 134, 24);
  text(g, fit(g, r.meta.title || 'Название трека', 610, 42, 800), 242, y + 66, 42, 800);
  text(g, fit(g, r.meta.artist || 'Исполнитель', 610, 31, 500), 242, y + 118, 31, 500, white(0.66));
  for (let i = 0; i < 6; i++) {
    const h = 8 + 54 * r.band(t, 1 + i * 4);
    box(g, 906 + i * 15, y + 92 - h / 2, 8, h, 4, r.accent);
  }
  const p = progress(r, t);
  text(g, fmt(t), 80, y + 193, 24, 600, white(0.7));
  text(g, `-${fmt(r.duration - Math.floor(Math.max(0, t)))}`, 1000, y + 193, 24, 600, white(0.7), 'right');
  box(g, 166, y + 188, 746, 10, 5, white(0.24));
  box(g, 166, y + 188, Math.max(10, 746 * p), 10, 5, '#fff');
  const cy = y + 235;
  g.fillStyle = '#fff';
  box(g, 522, cy - 18, 11, 36, 4, '#fff');
  box(g, 547, cy - 18, 11, 36, 4, '#fff');
  for (const [x, dir] of [[380, -1], [700, 1]]) {
    for (const k of [-16, 4]) poly(g, dir > 0 ? [[x + k, cy - 16], [x + k + 22, cy], [x + k, cy + 16]] : [[x - k, cy - 16], [x - k - 22, cy], [x - k, cy + 16]]);
  }
}

function lock(r, g, t) {
  const beat = r.beat(t) * r.deck.pulse;
  paintBackground(r, t); // подложка для стеклянных карточек
  wallpaper(r, g, t, beat);
  const d = r.deck;
  statusBar(r, g, [60, 58], true);
  // замочек
  g.strokeStyle = white(0.9);
  g.lineWidth = 7;
  g.beginPath(); g.arc(540, 136, 15, Math.PI, 0); g.lineTo(555, 150); g.moveTo(525, 136); g.lineTo(525, 150); g.stroke();
  box(g, 515, 147, 50, 38, 9, white(0.92));
  if (d.date) text(g, fit(g, d.date, 900, 42, 600), 540, 226, 42, 600, white(0.88), 'center');
  if (d.clock) {
    g.save();
    g.shadowColor = 'rgba(0,0,0,.35)';
    g.shadowBlur = 30;
    text(g, fit(g, d.clock, 940, 232, 700), 540, 376, 232, 700, white(0.97), 'center');
    g.restore();
  }
  if (d.show.player) lockPlayer(r, g, t);
  const top = d.show.player ? LOCK.top : 520;

  // строки песни и свои сообщения приходят уведомлениями, свежее — сверху
  const cards = r.lines.filter((l) => !l.dots).map((line) => ({ time: line.time, line, h: line.h + 106 }));
  for (const n of d.notices) {
    const rows = wrapLines(g, n.text, LOCK.w - 72, 38, 500, 3);
    cards.push({ time: n.time, notice: n, rows, h: rows.length * 48 + 144 });
  }
  cards.sort((a, b) => a.time - b.time);
  let last = -1;
  while (last + 1 < cards.length && cards[last + 1].time <= t + 0.05) last++;
  if (!cards.length) empty(r, g, top + 160);
  const shown = [];
  let y = top;
  for (let i = last; i >= 0 && last - i < 6; i--) {
    const c = cards[i];
    const age = t - c.time + 0.05;
    shown.push({ c, age, y, depth: last - i });
    y += (c.h + LOCK.gap) * (i === last ? smooth(age / 0.35) : 1);
    if (y > LOCK.bottom) break;
  }
  const app = (r.meta.artist || 'Музыка').toUpperCase();
  for (const { c, age, y: at, depth } of shown.reverse()) {
    const out = smooth((at + c.h - LOCK.bottom + 60) / 110); // у нижнего края карточка тает
    const alpha = smooth(age / 0.14) * (1 - out) * (1 - Math.min(0.42, depth * 0.14));
    if (alpha <= 0.01) continue;
    const k = pop(age);
    const scale = (0.86 + 0.14 * k) * (1 - Math.min(0.07, depth * 0.022));
    g.save();
    g.globalAlpha = alpha;
    g.translate(LOCK.x + LOCK.w / 2, at - (1 - k) * 70);
    g.scale(scale, scale);
    const x = -LOCK.w / 2;
    frosted(g, x, 0, LOCK.w, c.h, 44);
    if (depth === 0) box(g, x, 0, LOCK.w, c.h, 44, alphaOf(rgbHex(r.accentRgb), 0.1 + beat * 0.12));
    g.strokeStyle = white(0.16);
    g.lineWidth = 2;
    g.beginPath(); g.roundRect(x + 1, 1, LOCK.w - 2, c.h - 2, 43); g.stroke();
    artIn(g, r, x + 32, 22, 46, 12);
    const minutes = depth ? `${depth} мин` : r.deck.labels.msgTime || 'сейчас';
    text(g, fit(g, c.notice ? c.notice.from.toUpperCase() : app, LOCK.w - 280, 24, 700), x + 94, 46, 24, 700, white(0.62));
    text(g, minutes, x + LOCK.w - 34, 46, 24, 600, white(0.5), 'right');
    if (c.notice) {
      text(g, fit(g, c.notice.from, LOCK.w - 72, 38, 800), x + 36, 104, 38, 800);
      c.rows.forEach((row, i) => text(g, row, x + 36, 154 + i * 48, 38, 500, white(0.92)));
    } else words(r, g, c.line, x + 36, 82, t, '#fff', r.accent);
    g.restore();
  }

  // фонарик, камера и полоска внизу
  for (const x of [150, 930]) circle(g, x, 1760, 62, 'rgba(20,20,26,.55)');
  g.fillStyle = '#fff';
  poly(g, [[132, 1732], [168, 1732], [168, 1744], [160, 1756], [160, 1788], [140, 1788], [140, 1756], [132, 1744]]);
  box(g, 900, 1742, 60, 42, 10, '#fff');
  box(g, 917, 1732, 26, 14, 5, '#fff');
  circle(g, 930, 1763, 12, '#23232b');
  box(g, 380, 1878, 320, 10, 5, white(0.85));
}

const rgbHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/* ---------- пластинка ---------- */

let record = null; // диск с канавками рисуется один раз
function disc(radius) {
  if (record) return record;
  record = document.createElement('canvas');
  record.width = record.height = radius * 2;
  const g = record.getContext('2d');
  const body = g.createRadialGradient(radius, radius, radius * 0.4, radius, radius, radius);
  body.addColorStop(0, '#17171b');
  body.addColorStop(0.92, '#0b0b0e');
  body.addColorStop(1, '#222228');
  circle(g, radius, radius, radius, body);
  g.lineWidth = 1.5;
  for (let i = 0, at = radius * 0.46; at < radius - 12; i++, at += 4.5) {
    g.strokeStyle = white(0.018 + hash(i) * 0.06);
    g.beginPath(); g.arc(radius, radius, at, 0, TAU); g.stroke();
  }
  for (const at of [0.6, 0.76, 0.9]) { // дорожки между песнями
    g.strokeStyle = 'rgba(0,0,0,.65)';
    g.lineWidth = 6;
    g.beginPath(); g.arc(radius, radius, radius * at, 0, TAU); g.stroke();
  }
  return record;
}

function heading(r, g, y) {
  const title = r.meta.title || 'Название трека';
  text(g, fit(g, title, 900, 56, 800), W / 2, y, 56, 800, '#fff', 'center');
  text(g, fit(g, r.meta.artist || 'Исполнитель', 900, 38, 500), W / 2, y + 58, 38, 500, white(0.65), 'center');
}

function vinyl(r, g, t) {
  r.drawBackground(g, t);
  const beat = r.style.motion ? r.beat(t) : 0;
  const [R, G, B] = r.accentRgb;
  const cx = 530, cy = 660, rad = 395;
  const halo = g.createRadialGradient(cx, cy, rad * 0.85, cx, cy, rad * (1.35 + beat * 0.2));
  halo.addColorStop(0, `rgba(${R},${G},${B},${0.3 + beat * 0.45})`);
  halo.addColorStop(1, `rgba(${R},${G},${B},0)`);
  g.fillStyle = halo;
  g.fillRect(0, 0, W, 1240);
  const angle = t * TAU * (100 / 3 / 60); // 33⅓ оборота в минуту
  g.save();
  g.translate(cx, cy);
  g.scale(1 + beat * 0.016, 1 + beat * 0.016);
  g.save();
  g.shadowColor = 'rgba(0,0,0,.6)';
  g.shadowBlur = 60;
  g.shadowOffsetY = 30;
  circle(g, 0, 0, rad - 2, '#0c0c0f');
  g.restore();
  g.save();
  g.rotate(angle);
  g.drawImage(disc(rad), -rad, -rad);
  // царапины: по ним видно вращение
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = white(0.04 + hash(i + 40) * 0.09);
    const a = hash(i + 7) * TAU;
    g.beginPath(); g.arc(0, 0, rad * (0.5 + hash(i + 19) * 0.46), a, a + 0.15 + hash(i + 3) * 0.5); g.stroke();
  }
  g.restore();
  // блики стоят на месте, как свет от лампы
  const shine = g.createConicGradient(-1.25, 0, 0);
  for (const [at, a] of [[0, 0], [0.07, 0.17], [0.15, 0], [0.5, 0], [0.57, 0.13], [0.65, 0], [1, 0]]) shine.addColorStop(at, white(a));
  g.beginPath();
  g.arc(0, 0, rad - 8, 0, TAU);
  g.arc(0, 0, rad * 0.43, 0, TAU, true);
  g.fillStyle = shine;
  g.fill();
  artIn(g, r, -168, -168, 336, 168, angle);
  g.strokeStyle = r.accent;
  g.lineWidth = 6;
  g.beginPath(); g.arc(0, 0, 171, 0, TAU); g.stroke();
  circle(g, 0, 0, 17, '#d9d9df');
  circle(g, 0, 0, 7, '#25252b');
  g.restore();

  // звукосниматель ползёт к центру вместе с песней
  const reach = mix(rad - 34, 205, progress(r, t));
  const tip = [cx + Math.cos(0.42) * reach, cy + Math.sin(0.42) * reach + beat * 3];
  const pivot = [976, 292];
  g.save();
  g.shadowColor = 'rgba(0,0,0,.5)';
  g.shadowBlur = 24;
  g.shadowOffsetY = 16;
  circle(g, ...pivot, 56, '#2b2b33');
  g.strokeStyle = '#cfd0d8';
  g.lineWidth = 15;
  g.lineCap = g.lineJoin = 'round';
  const elbow = [mix(pivot[0], tip[0], 0.72) + 52, mix(pivot[1], tip[1], 0.72)];
  g.beginPath(); g.moveTo(...pivot); g.lineTo(...elbow); g.lineTo(...tip); g.stroke();
  g.translate(...tip);
  g.rotate(Math.atan2(tip[1] - elbow[1], tip[0] - elbow[0]));
  box(g, -46, -20, 66, 40, 9, '#e9eaf0');
  box(g, -34, -20, 12, 40, 0, r.accent);
  g.restore();
  circle(g, ...pivot, 24, '#e9eaf0');

  heading(r, g, 1110);
  if (r.style.progress) {
    box(g, 240, 1205, 600, 7, 3.5, white(0.22));
    box(g, 240, 1205, Math.max(7, 600 * progress(r, t)), 7, 3.5, '#fff');
  }
  r.drawLyrics(g, t);
}

/* ---------- кассета ---------- */

function hub(g, x, y, angle) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  circle(g, 0, 0, 50, '#ece8de');
  circle(g, 0, 0, 29, '#17171c');
  g.fillStyle = '#ece8de';
  for (let i = 0; i < 6; i++) {
    g.rotate(TAU / 6);
    g.fillRect(-6, -31, 12, 15);
  }
  g.restore();
}

function cassette(r, g, t) {
  r.drawBackground(g, t);
  const beat = r.style.motion ? r.beat(t) : 0;
  const x = 55, y = 340, w = 970, h = 616;
  const [R, G, B] = r.accentRgb;
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(r.style.motion ? Math.sin(t * 0.7) * 0.012 : 0);
  g.scale(1 + beat * 0.022, 1 + beat * 0.022);
  g.translate(-x - w / 2, -y - h / 2);

  g.save();
  g.shadowColor = `rgba(${R},${G},${B},${0.35 + beat * 0.5})`;
  g.shadowBlur = 70 + beat * 50;
  box(g, x, y, w, h, 46, '#1b1b21');
  g.restore();
  const shell = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  shell.addColorStop(0, '#3a3a44');
  shell.addColorStop(0.5, '#222229');
  shell.addColorStop(1, '#15151a');
  box(g, x, y, w, h, 46, shell);
  g.strokeStyle = white(0.22);
  g.lineWidth = 3;
  g.beginPath(); g.roundRect(x + 2, y + 2, w - 4, h - 4, 44); g.stroke();
  for (const [sx, sy] of [[34, 34], [w - 34, 34], [34, h - 34], [w - 34, h - 34]]) {
    circle(g, x + sx, y + sy, 13, '#8f8f99');
    g.fillStyle = '#34343c';
    g.fillRect(x + sx - 9, y + sy - 2.5, 18, 5);
    g.fillRect(x + sx - 2.5, y + sy - 9, 5, 18);
  }

  // бумажная наклейка с подписью от руки
  box(g, x + 70, y + 48, w - 140, 424, 22, '#f1e9d8');
  g.save();
  g.beginPath(); g.roundRect(x + 70, y + 48, w - 140, 424, 22); g.clip();
  g.fillStyle = r.accent;
  g.fillRect(x + 70, y + 218, w - 140, 214);
  g.fillStyle = 'rgba(20,16,24,.22)';
  for (let i = 0; i < 3; i++) g.fillRect(x + 70, y + 366 + i * 20, w - 140, 7);
  g.restore();
  g.strokeStyle = 'rgba(40,34,30,.28)';
  g.lineWidth = 2;
  for (const ly of [134, 198]) { g.beginPath(); g.moveTo(x + 200, y + ly); g.lineTo(x + w - 110, y + ly); g.stroke(); }
  text(g, 'A', x + 135, y + 134, 96, 800, '#241f2b', 'center');
  const hand = (str, size, ly, color) => {
    g.font = cssFont(FONTS.caveat, size);
    let s = str;
    while ([...s].length > 4 && g.measureText(s).width > w - 340) s = `${[...s].slice(0, -2).join('').trimEnd()}…`;
    g.fillStyle = color;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(s, x + 215, y + ly);
  };
  hand(r.meta.title || 'Название трека', 76, 126, '#1d2f6f');
  hand(r.meta.artist || 'Исполнитель', 54, 190, '#38333f');

  // окошко с катушками
  const wx = x + 190, wy = y + 248, ww = w - 380, wh = 156;
  box(g, wx, wy, ww, wh, wh / 2, '#0e0e12');
  const p = progress(r, t);
  const left = wx + 92, right = wx + ww - 92, mid = wy + wh / 2;
  g.save();
  g.beginPath(); g.roundRect(wx, wy, ww, wh, wh / 2); g.clip();
  for (const [hx, part] of [[left, 1 - p], [right, p]]) {
    const roll = 56 + 96 * part;
    circle(g, hx, mid, roll, '#4a342b');
    g.strokeStyle = 'rgba(0,0,0,.28)';
    g.lineWidth = 2;
    for (let q = 62; q < roll; q += 11) { g.beginPath(); g.arc(hx, mid, q, 0, TAU); g.stroke(); }
  }
  hub(g, left, mid, -t * 2.7);
  hub(g, right, mid, -t * 2.3);
  const glare = g.createLinearGradient(wx, wy, wx + ww * 0.5, wy + wh);
  glare.addColorStop(0, white(0.16));
  glare.addColorStop(0.45, white(0.02));
  g.fillStyle = glare;
  g.fillRect(wx, wy, ww, wh);
  g.restore();
  g.strokeStyle = white(0.4);
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(wx, wy, ww, wh, wh / 2); g.stroke();
  // уровень звука на наклейке
  for (let i = 0; i < 4; i++) {
    for (const [bx, band] of [[x + 100, 1], [x + w - 176, 13]]) {
      const bh = 10 + 100 * r.band(t, band + i * 3);
      box(g, bx + i * 21, mid + 55 - bh, 13, bh, 5, 'rgba(25,18,30,.72)');
    }
  }

  g.fillStyle = '#2c2c35';
  poly(g, [[x + 190, y + h], [x + 240, y + h - 108], [x + w - 240, y + h - 108], [x + w - 190, y + h]]);
  for (const hx of [305, 405, w - 405, w - 305]) circle(g, x + hx, y + h - 50, hx === 305 || hx === w - 305 ? 17 : 23, '#0e0e12');
  box(g, x + w / 2 - 22, y + h - 64, 44, 26, 6, '#0e0e12');
  g.restore();
  r.drawLyrics(g, t);
}

const SCENES = { chat, lock, vinyl, cassette };

export function drawScene(r, g, t) {
  SCENES[r.style.layout](r, g, t);
}
