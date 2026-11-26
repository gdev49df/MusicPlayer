// Стиль «Панель»: карточки плеера и виджеты слева, живой текст справа.
// Всё рисуется как функция от времени t.
import { hash, distort, overlay } from './effects.js';
import { BANDS } from './audio.js';

const FONT = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
const white = (a) => `rgba(255,255,255,${a})`;

export const LABELS = {
  playing: 'Сейчас играет', now: 'Сейчас', state: 'Состояние', word: '', lyrics: 'Текст песни',
  live: 'LIVE', message: 'СООБЩЕНИЕ', msgTime: 'сейчас', pause: 'проигрыш',
};
const label = (r, key) => r.deck.labels[key] || LABELS[key];

// расположение блоков с учётом скрытых
export function deckGeometry(layout, show) {
  const tall = layout === 'deckTall';
  const G = { widgets: [] };
  if (tall) {
    let y = 214;
    if (show.media) { G.media = [60, y, 960, 440]; y += 464; }
    if (show.player) { G.player = [60, y, 960, 202]; y += 224; }
    const empty = y === 214;
    const header = empty ? 420 : y + 44;
    G.header = [74, header];
    G.box = [74, header - 10, 1000, 1660];
    G.anchor = header + (show.header ? 64 : 20);
    G.status = [60, 70];
    G.island = [330, 118, 420, 64];
    G.notice = [60, 96, 960, 134];
    return G;
  }
  const rows = [];
  if (show.media) rows.push(['media', 312]);
  if (show.player) rows.push(['player', 202]);
  if (show.eq || show.ring) rows.push(['widgets', 328]);
  const total = rows.reduce((s, r) => s + r[1], 0) + 24 * Math.max(0, rows.length - 1);
  let y = 122 + Math.max(0, (888 - total) / 2);
  for (const [name, h] of rows) {
    if (name === 'widgets') {
      if (show.eq && show.ring) G.widgets = [['eq', [86, y, 353, h]], ['ring', [461, y, 353, h]]];
      else G.widgets = [[show.eq ? 'eq' : 'ring', [86, y, 728, h]]];
    } else G[name] = [86, y, 728, h];
    y += h + 24;
  }
  const left = rows.length ? 902 : 262;
  G.header = [left, 140];
  G.box = rows.length ? [912, 200, 1850, 1065] : [272, 200, 1700, 1065];
  G.anchor = show.header ? 300 : 260;
  G.status = [62, 52];
  G.island = [750, 22, 420, 64];
  G.notice = [1190, 104, 664, 126];
  return G;
}

export function parseNotices(text) {
  return (text || '').split(/\r?\n/).map((l) => {
    const m = l.match(/^\s*(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)\s+([^:]{1,30}):\s*(.+)$/);
    return m && { time: Number(m[1]) * 60 + Number(m[2].replace(',', '.')), from: m[3].trim(), text: m[4].trim() };
  }).filter(Boolean).sort((a, b) => a.time - b.time);
}

function text(g, str, x, y, size, weight = 600, color = '#fff', align = 'left') {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(str, x, y);
  return g.measureText(str).width;
}

function fit(g, str, max, size, weight = 600) {
  g.font = `${weight} ${size}px ${FONT}`;
  if (g.measureText(str).width <= max) return str;
  const c = [...str];
  while (c.length && g.measureText(`${c.join('')}…`).width > max) c.pop();
  return `${c.join('').trimEnd()}…`;
}

// длинное название плавно прокручивается по кругу
function marquee(g, str, x, y, max, size, weight, alpha, t) {
  g.font = `${weight} ${size}px ${FONT}`;
  const w = g.measureText(str).width;
  if (w <= max) { text(g, str, x, y, size, weight, white(alpha)); return; }
  const gap = size * 2.4, speed = size * 1.7, rest = 2;
  const phase = t % (rest + (w + gap) / speed);
  const off = phase < rest ? 0 : (phase - rest) * speed;
  const gr = g.createLinearGradient(x, 0, x + max, 0);
  gr.addColorStop(0, white(alpha * (1 - clamp(off / 20))));
  gr.addColorStop(0.07, white(alpha));
  gr.addColorStop(0.88, white(alpha));
  gr.addColorStop(1, white(0));
  g.save();
  g.beginPath();
  g.rect(x, y - size, max, size * 2);
  g.clip();
  text(g, str, x - off, y, size, weight, gr);
  g.fillText(str, x - off + w + gap, y);
  g.restore();
}

function box(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
}

// «стекло»: размытый фон под карточкой, блик сверху и светящаяся кромка
function glass(r, g, [x, y, w, h], radius = 36, tint = 0.07) {
  const k = r.deckBg.width / r.width;
  g.save();
  g.shadowColor = 'rgba(0,0,0,.5)';
  g.shadowBlur = 48;
  g.shadowOffsetY = 20;
  box(g, x, y, w, h, radius, 'rgba(18,16,22,.55)');
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.clip();
  g.drawImage(r.deckBg, x * k, y * k, w * k, h * k, x, y, w, h);
  g.fillStyle = white(tint);
  g.fillRect(x, y, w, h);
  const shine = g.createLinearGradient(x, y, x + w * 0.35, y + h);
  shine.addColorStop(0, white(0.13));
  shine.addColorStop(0.4, white(0.025));
  shine.addColorStop(1, white(0));
  g.fillStyle = shine;
  g.fillRect(x, y, w, h);
  g.restore();
  const edge = g.createLinearGradient(x, y, x + w * 0.5, y + h);
  edge.addColorStop(0, white(0.42));
  edge.addColorStop(0.35, white(0.1));
  edge.addColorStop(1, white(0.16));
  g.strokeStyle = edge;
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(x + 1, y + 1, w - 2, h - 2, radius - 1);
  g.stroke();
}

const poly = (g, pts) => {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fill();
};

function bubble(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x - s / 2, y - s * 0.42, s, s * 0.72, s * 0.2);
  g.fill();
  poly(g, [[x - s * 0.24, y + s * 0.24], [x - s * 0.3, y + s * 0.5], [x + s * 0.04, y + s * 0.28]]);
}

function heart(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y + s * 0.42);
  g.bezierCurveTo(x - s * 0.75, y - s * 0.05, x - s * 0.38, y - s * 0.62, x, y - s * 0.2);
  g.bezierCurveTo(x + s * 0.38, y - s * 0.62, x + s * 0.75, y - s * 0.05, x, y + s * 0.42);
  g.fill();
}

function star(g, x, y, r, color, stroke) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const k = i % 2 ? r * 0.45 : r;
    g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  g.closePath();
  if (stroke) { g.strokeStyle = color; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke(); } else { g.fillStyle = color; g.fill(); }
}

function paintBackground(r, t) {
  const c = r.deckBg;
  const w = Math.round(r.width / 4), h = Math.round(r.height / 4);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d');
  const [R, G, B] = r.accentRgb;
  const m = r.style.motion ? t : 0;
  const long = Math.max(w, h);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = `rgb(${Math.round(R * 0.05) + 8},${Math.round(G * 0.05) + 7},${Math.round(B * 0.05) + 10})`;
  g.fillRect(0, 0, w, h);
  if (r.deck.bgMode === 'cover') {
    g.drawImage(r.blob, (w - long) / 2, (h - long) / 2, long, long);
    const spots = [[0.2, 0.3, 0.95, 0.07, 0], [0.85, 0.75, 1.05, -0.055, 2], [0.65, 0.2, 0.7, 0.09, 4]];
    for (const [x, y, s, v, ph] of spots) {
      g.save();
      g.translate(w * x + Math.sin(m * v * 3 + ph) * long * 0.09, h * y + Math.cos(m * v * 2.3 + ph) * long * 0.08);
      g.rotate(m * v * 2 + ph);
      g.drawImage(r.soft, (-long * s) / 2, (-long * s) / 2, long * s, long * s);
      g.restore();
    }
    // лёгкая тонировка акцентом и затемнение, чтобы текст читался
    g.globalCompositeOperation = 'soft-light';
    g.fillStyle = `rgba(${R},${G},${B},.65)`;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(8,7,12,.54)';
    g.fillRect(0, 0, w, h);
  }
  const glow = (x, y, rad, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${R},${G},${B},${a})`);
    gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  const base = r.deck.bgMode === 'cover' ? 0.18 : 0.38;
  glow(w * 0.82 + Math.sin(m * 0.23) * w * 0.05, h * 0.8 + Math.cos(m * 0.19) * h * 0.06, long * 0.58, base);
  glow(w * 0.16 + Math.cos(m * 0.17) * w * 0.04, h * 0.08, long * 0.42, base * 0.6);
}

function background(r, g, t, beat) {
  const { width: W, height: H } = r;
  const [R, G, B] = r.accentRgb;
  paintBackground(r, t);
  g.imageSmoothingQuality = 'high';
  g.drawImage(r.deckBg, 0, 0, W, H);
  if (beat > 0.01) { // вспышка на басах
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const [x, y, rad, a] of [[W * 0.84, H * 0.84, Math.max(W, H) * 0.5, 0.24], [W * 0.12, H * 0.4, Math.max(W, H) * 0.36, 0.15]]) {
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${R},${G},${B},${a * beat})`);
      gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
  }
  const m = r.style.motion ? t : 0;
  for (let i = 0; i < 110; i++) {
    const x = (hash(i) * W + Math.sin(m * 0.3 + i) * 14) % W;
    const y = (((hash(i + 300) * H - m * (4 + hash(i + 600) * 14)) % H) + H) % H;
    g.fillStyle = white((0.1 + 0.34 * hash(i + 900) * (0.6 + 0.4 * Math.sin(m * 1.7 + i * 2))) * (1 + beat * 0.6));
    g.beginPath();
    g.arc(x, y, (0.8 + hash(i + 1200) * 2.1) * (1 + beat * 0.35), 0, TAU);
    g.fill();
  }
  const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,.42)');
  g.fillStyle = vig;
  g.fillRect(0, 0, W, H);
}

function media(r, g, t, [x, y, w, h], beat) {
  const d = r.deck;
  const src = r.cardMedia || r.cover;
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  g.save();
  // карточка «дышит» в такт
  g.translate(x + w / 2, y + h / 2);
  g.scale(1 + beat * 0.016, 1 + beat * 0.016);
  g.translate(-x - w / 2, -y - h / 2);
  const [R, G, B] = r.accentRgb;
  g.save();
  g.shadowColor = `rgba(${R},${G},${B},${0.25 + beat * 0.7})`;
  g.shadowBlur = 30 + beat * 60;
  box(g, x, y, w, h, 36, '#121218');
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 36);
  g.clip();
  const zoom = (r.cardMedia?.videoWidth ? 1 : 1.07 + (r.style.motion ? Math.sin(t * 0.12) * 0.05 : 0)) + beat * 0.09;
  const image = (dx = 0) => {
    if (!sw || !sh) return;
    const k = Math.max(w / sw, h / sh) * zoom;
    g.drawImage(src, x + (w - sw * k) / 2 + dx, y + (h - sh * k) / 2, sw * k, sh * k);
  };
  image();
  const strength = d.strength;
  distort(g, [x, y, w, h], t, d.effect, strength, beat, image);
  if (d.mono) {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  if (d.effect === 'rain') { g.fillStyle = `rgba(6,8,14,${0.3 * strength})`; g.fillRect(x, y, w, h); }
  overlay(g, [x, y, w, h], t, d.effect, strength, beat, r.accentRgb);
  if (beat > 0.05) { g.fillStyle = white(beat * 0.09); g.fillRect(x, y, w, h); }
  const shade = g.createLinearGradient(0, y + h - 130, 0, y + h);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.72)');
  g.fillStyle = shade;
  g.fillRect(x, y + h - 130, w, 130);
  g.restore();
  g.strokeStyle = white(0.2 + beat * 0.25);
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(x + 1, y + 1, w - 2, h - 2, 35);
  g.stroke();

  const playing = fit(g, label(r, 'playing'), w * 0.6, 22, 700);
  g.font = `700 22px ${FONT}`;
  const lw = g.measureText(playing).width;
  box(g, x + 20, y + 18, lw + 70, 42, 21, 'rgba(10,10,14,.62)');
  for (let i = 0; i < 3; i++) {
    const bh = 6 + 17 * r.band(t, 2 + i * 7);
    box(g, x + 38 + i * 8, y + 50 - bh, 4.5, bh, 2, r.accent);
  }
  text(g, playing, x + 70, y + 40, 22, 700);
  const line = [r.meta.artist, r.meta.title].filter(Boolean).join(' · ').toUpperCase();
  marquee(g, line, x + 24, y + h - 30, w - 200, 21, 700, 1, t);
  const p = (n) => String(n).padStart(2, '0');
  const s = Math.max(0, Math.floor(t));
  text(g, `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`, x + w - 24, y + h - 30, 21, 700, '#fff', 'right');
  g.restore();
}

function player(r, g, t, rect) {
  const [x, y, w, h] = rect;
  glass(r, g, rect);
  marquee(g, r.meta.title || 'Название трека', x + 28, y + 40, w - 200, 42, 800, 1, t);
  marquee(g, r.meta.artist || 'Исполнитель', x + 28, y + 82, w - 200, 28, 500, 0.66, t);
  for (const [i, cx] of [x + w - 116, x + w - 52].entries()) {
    g.fillStyle = white(0.12);
    g.beginPath(); g.arc(cx, y + 54, 27, 0, TAU); g.fill();
    if (i === 0) star(g, cx, y + 55, 15, '#fff', true);
    else for (let k = -1; k <= 1; k++) { g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + k * 10, y + 54, 3.4, 0, TAU); g.fill(); }
  }
  const p = r.duration ? clamp(t / r.duration) : 0;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const py = y + 126;
  text(g, mmss(Math.max(0, t)), x + 28, py, 20, 600, white(0.72));
  text(g, `-${mmss(Math.max(0, r.duration - Math.floor(t)))}`, x + w - 28, py, 20, 600, white(0.72), 'right');
  const bx = x + 96, bw = w - 200;
  box(g, bx, py - 3.5, bw, 7, 3.5, white(0.24));
  box(g, bx, py - 3.5, Math.max(7, bw * p), 7, 3.5, '#fff');
  g.save();
  g.shadowColor = r.accent;
  g.shadowBlur = 18;
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(bx + bw * p, py, 10, 0, TAU); g.fill();
  g.restore();

  const cy = y + 170;
  const vol = clamp(r.deck.volume);
  g.fillStyle = white(0.82);
  poly(g, [[x + 28, cy - 6], [x + 37, cy - 6], [x + 49, cy - 15], [x + 49, cy + 15], [x + 37, cy + 6], [x + 28, cy + 6]]);
  box(g, x + 60, cy - 3, 110, 6, 3, white(0.24));
  if (vol > 0) box(g, x + 60, cy - 3, Math.max(6, 110 * vol), 6, 3, white(0.9));
  const mid = x + w / 2;
  g.fillStyle = '#fff';
  for (const [ox, dir] of [[-90, -1], [90, 1]]) {
    for (const k of [-13, 4]) {
      const a = mid + ox + k + (dir < 0 ? 9 : 0);
      poly(g, dir > 0 ? [[a, cy - 13], [a + 19, cy], [a, cy + 13]] : [[a + 10, cy - 13], [a - 9, cy], [a + 10, cy + 13]]);
    }
  }
  box(g, mid - 14, cy - 16, 9, 32, 3, '#fff');
  box(g, mid + 5, cy - 16, 9, 32, 3, '#fff');
  box(g, x + w - 150, cy - 21, 42, 42, 11, '#fff');
  bubble(g, x + w - 129, cy, 25, '#2a2430');
  for (let i = 0; i < 3; i++) {
    box(g, x + w - 70, cy - 13 + i * 11, 5, 5, 2.5, white(0.85));
    box(g, x + w - 59, cy - 13 + i * 11, 30, 5, 2.5, white(0.85));
  }
}

const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function widgetHead(r, g, [x, y, w], icon, title) {
  if (icon === 'heart') heart(g, x + 36, y + 43, 28, r.accent);
  else star(g, x + 36, y + 42, 13, r.accent);
  const now = fit(g, label(r, 'now'), w * 0.3, 20, 500);
  g.font = `500 20px ${FONT}`;
  const nw = g.measureText(now).width;
  marquee(g, title, x + 58, y + 42, w - 100 - nw, 26, 700, 1, 0);
  text(g, now, x + w - 24, y + 42, 20, 500, white(0.55), 'right');
}

function bars(r, g, t, x, y, w, h, count) {
  const step = w / count, bw = step * 0.64;
  const grad = g.createLinearGradient(0, y + h, 0, y);
  grad.addColorStop(0, r.accent);
  grad.addColorStop(1, '#fff');
  for (let i = 0; i < count; i++) {
    const b = (i * BANDS) / count;
    const v = r.band(t, b);
    const bh = Math.max(bw, v * h);
    box(g, x + i * step, y + h - bh, bw, bh, bw / 2, grad);
    // «шапка», которая медленно падает после пика
    let peak = 0;
    for (let k = 0; k < 18; k++) peak = Math.max(peak, r.band(t - k / 30, b) - (k * k) * 0.0022);
    box(g, x + i * step, y + h - Math.max(bw, peak * h) - 9, bw, 4, 2, white(0.75));
  }
}

function eqWidget(r, g, t, rect) {
  const [x, y, w, h] = rect;
  const d = r.deck;
  glass(r, g, rect);
  const numeric = d.widgetMode === 'number';
  widgetHead(r, g, rect, 'star', d.leftTitle || (numeric ? 'Пульс' : 'Эквалайзер'));
  if (!numeric) { bars(r, g, t, x + 28, y + 92, w - 52, h - 118, w > 500 ? 24 : 14); return; }
  const { from, to } = r.clip;
  const part = clamp((t - from) / Math.max(1, to - from));
  const raw = String(d.leftValue).trim();
  const digits = raw.replace(/\s/g, '');
  const isNumber = digits !== '' && Number.isFinite(Number(digits));
  // своё число плавно «накручивается»; пусто — показываем громкость трека
  const value = raw === '' ? `${Math.round(d.volume * 100)}%` : isNumber ? group(Number(digits) * (0.8 + 0.2 * part)) : raw;
  text(g, fit(g, value, w - 48, 60, 800), x + 26, y + 112, 60, 800);
  text(g, fit(g, d.leftCaption || (raw === '' ? 'громкость' : ''), w - 52, 23, 500), x + 28, y + 162, 23, 500, white(0.65));
  bars(r, g, t, x + 28, y + 196, w - 52, h - 222, w > 500 ? 24 : 16);
}

function ringWidget(r, g, t, rect) {
  const [x, y, w] = rect;
  const d = r.deck;
  glass(r, g, rect);
  widgetHead(r, g, rect, 'heart', d.rightTitle || 'Настрой');
  const { from, to } = r.clip;
  const part = clamp((t - from) / Math.max(1, to - from));
  const cx = x + w / 2, cy = y + 156, rad = 66;
  const beat = r.beat(t) * d.pulse;
  g.lineWidth = 15;
  g.lineCap = 'round';
  g.strokeStyle = white(0.15);
  g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke();
  g.save();
  g.shadowColor = r.accent;
  g.shadowBlur = 16 + beat * 34;
  g.strokeStyle = r.accent;
  g.beginPath(); g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.002, part)); g.stroke();
  g.restore();
  text(g, `${Math.round(part * 100)}%`, cx, cy + 2, 36 + beat * 5, 800, '#fff', 'center');
  let word = '', since = -9;
  for (const it of r.items) {
    if (it.time > t + 0.15) break;
    if (it.dots) continue;
    // своё слово строки важнее общего, общее важнее подобранного
    const next = it.custom ? it.label : d.labels.word || it.label;
    if (next !== word) { word = next; since = it.time; }
  }
  if (!word) word = d.labels.word;
  if (word) {
    const pop = smooth((t - since + 0.15) / 0.35);
    g.save();
    g.globalAlpha *= pop;
    const s = fit(g, word, w - 90, 23, 700);
    g.font = `700 23px ${FONT}`;
    const tw = g.measureText(s).width;
    box(g, cx - tw / 2 - 20, y + 250 + (1 - pop) * 12, tw + 40, 42, 21, white(0.15));
    text(g, s, cx, y + 272 + (1 - pop) * 12, 23, 700, '#fff', 'center');
    g.restore();
  }
  text(g, fit(g, label(r, 'state'), w - 40, 18, 500), cx, y + 309, 18, 500, white(0.45), 'center');
}

function statusBar(r, g, [x, y]) {
  const d = r.deck;
  const tw = d.clock ? text(g, d.clock, x, y, 32, 700) : 0;
  if (d.date) text(g, d.date, x + tw + 24, y + 1, 26, 600);
  const right = r.width - x;
  g.strokeStyle = white(0.6);
  g.lineWidth = 2.5;
  g.beginPath(); g.roundRect(right - 50, y - 12, 44, 23, 7); g.stroke();
  box(g, right - 46, y - 8, 30, 15, 4, '#fff');
  box(g, right - 3, y - 5, 4, 9, 2, white(0.6));
  g.strokeStyle = '#fff';
  g.lineWidth = 4.5;
  g.lineCap = 'round';
  for (const k of [20, 12]) { g.beginPath(); g.arc(right - 83, y + 10, k, -Math.PI * 0.75, -Math.PI * 0.25); g.stroke(); }
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(right - 83, y + 7, 4.5, 0, TAU); g.fill();
  for (let i = 0; i < 4; i++) box(g, right - 150 + i * 10, y + 11 - (8 + i * 5), 7, 8 + i * 5, 2, '#fff');
}

function island(r, g, t, [x, y, w, h]) {
  const beat = r.beat(t) * r.deck.pulse;
  const grow = beat * 10;
  g.save();
  g.shadowColor = `rgba(0,0,0,.6)`;
  g.shadowBlur = 24;
  box(g, x - grow / 2, y, w + grow, h, h / 2, '#000');
  g.restore();
  g.save();
  g.beginPath(); g.arc(x + 34, y + h / 2, 23, 0, TAU); g.clip();
  g.drawImage(r.art, x + 11, y + h / 2 - 23, 46, 46);
  g.restore();
  marquee(g, r.meta.title || 'Название', x + 70, y + 22, w - 180, 21, 700, 1, t);
  marquee(g, r.meta.artist || 'Исполнитель', x + 70, y + 45, w - 180, 18, 500, 0.62, t);
  for (let i = 0; i < 7; i++) {
    const bh = 6 + 32 * r.band(t, 1 + i * 3.4);
    box(g, x + w - 96 + i * 11, y + h / 2 - bh / 2, 6, bh, 3, i < 3 ? r.accent : '#fff');
  }
}

function notice(r, g, t, [x, y, w, h]) {
  for (const n of r.deck.notices) {
    const age = t - n.time;
    if (age < 0 || age > 4.6) continue;
    const k = smooth(age / 0.4) * (1 - smooth((age - 4.2) / 0.4));
    g.save();
    g.globalAlpha = k;
    g.translate(0, (1 - k) * -50);
    g.shadowColor = 'rgba(0,0,0,.55)';
    g.shadowBlur = 40;
    box(g, x, y, w, h, 34, 'rgb(48,44,52)');
    g.shadowColor = 'transparent';
    g.strokeStyle = white(0.18);
    g.lineWidth = 2;
    g.stroke();
    box(g, x + 22, y + h / 2 - 33, 66, 66, 19, r.accent);
    bubble(g, x + 55, y + h / 2, 40, '#fff');
    text(g, fit(g, label(r, 'message'), w - 260, 18, 600), x + 108, y + 28, 18, 600, white(0.55));
    text(g, fit(g, label(r, 'msgTime'), 120, 18, 500), x + w - 24, y + 28, 18, 500, white(0.55), 'right');
    text(g, fit(g, n.from, w - 140, 26, 700), x + 108, y + 62, 26, 700);
    text(g, fit(g, n.text, w - 136, 24, 500), x + 108, y + h - 28, 24, 500);
    g.restore();
  }
}

export function drawDeck(r, g, t) {
  const d = r.deck;
  const G = r.G;
  const beat = r.beat(t) * d.pulse;
  background(r, g, t, beat);
  // появление блоков по очереди в начале видео
  const since = t - r.clip.from;
  const block = (order, dx, dy, draw) => {
    let p = 1;
    if (d.intro && r.introOn && since > -0.05 && since < 3) p = 1 - (1 - clamp((since - order * 0.12) / 0.75)) ** 3;
    if (p <= 0.001) return;
    g.save();
    g.globalAlpha = p;
    g.translate(dx * (1 - p), dy * (1 - p));
    draw(p);
    g.restore();
  };
  if (d.show.status) block(0, 0, -40, () => statusBar(r, g, G.status));
  if (d.show.island) block(1, 0, -70, () => island(r, g, t, G.island));
  if (G.media) block(1.5, -120, 30, () => media(r, g, t, G.media, beat));
  if (G.player) block(2.5, -120, 40, () => player(r, g, t, G.player));
  G.widgets.forEach(([kind, rect], i) => block(3.5 + i, -80, 90, () => (kind === 'eq' ? eqWidget : ringWidget)(r, g, t, rect)));
  if (d.show.header) {
    block(2, 80, 0, () => {
      const [hx, hy] = G.header;
      bubble(g, hx + 15, hy, 28, white(0.62));
      const title = fit(g, label(r, 'lyrics'), 520, 25, 600);
      const w = text(g, title, hx + 40, hy, 25, 600, white(0.62));
      const live = fit(g, label(r, 'live'), 180, 18, 800);
      g.font = `800 18px ${FONT}`;
      const lw = g.measureText(live).width;
      box(g, hx + 54 + w, hy - 16, lw + 38, 32, 9, white(0.15));
      g.save();
      g.globalAlpha *= 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2));
      g.fillStyle = r.accent;
      g.beginPath(); g.arc(hx + 67 + w, hy, 4.5, 0, TAU); g.fill();
      g.restore();
      text(g, live, hx + 78 + w, hy + 1, 18, 800, white(0.88));
    });
  }
  block(3, 140, 0, (p) => { r.lyricAlpha = p; r.drawLyrics(g, t); r.lyricAlpha = 1; });
  notice(r, g, t, G.notice);
}
