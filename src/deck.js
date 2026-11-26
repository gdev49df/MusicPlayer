// Стиль «Панель»: карточки плеера и виджеты слева, живой текст справа.
// Всё рисуется как функция от времени t.

const FONT = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif';
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const white = (a) => `rgba(255,255,255,${a})`;

const GEOMETRY = {
  deck: {
    status: [62, 52], island: [790, 24, 340, 62], media: [86, 122, 728, 312], player: [86, 458, 728, 202],
    widgets: [[86, 682, 353, 328], [461, 682, 353, 328]], header: [902, 140], notice: [1190, 104, 664, 126],
  },
  deckTall: {
    status: [60, 70], island: [370, 120, 340, 62], media: [60, 214, 960, 440], player: [60, 678, 960, 202],
    widgets: null, header: [74, 946], notice: [60, 96, 960, 134],
  },
};

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

function box(g, x, y, w, h, r, fill) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
}

function card(g, [x, y, w, h]) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,.45)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 16;
  box(g, x, y, w, h, 34, 'rgba(34,28,31,.62)');
  g.restore();
  box(g, x, y, w, h, 34, white(0.055));
  g.strokeStyle = white(0.13);
  g.lineWidth = 2;
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

function background(r, g, t) {
  const { width: W, height: H } = r;
  const [R, G, B] = r.accentRgb;
  g.fillStyle = `rgb(${Math.round(R * 0.04) + 8},${Math.round(G * 0.04) + 6},${Math.round(B * 0.04) + 8})`;
  g.fillRect(0, 0, W, H);
  const beat = r.style.motion ? r.energy(t) : 0;
  const glow = (x, y, rad, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${R * 0.62},${G * 0.45},${B * 0.45},${a})`);
    gr.addColorStop(1, `rgba(${R * 0.5},${G * 0.3},${B * 0.3},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  const m = r.style.motion ? t : 0;
  glow(W * 0.82 + Math.sin(m * 0.23) * 90, H * 0.78 + Math.cos(m * 0.19) * 70, Math.max(W, H) * 0.6, 0.5 + beat * 0.2);
  glow(W * 0.2 + Math.cos(m * 0.17) * 80, H * 0.1, Math.max(W, H) * 0.42, 0.2);
  for (let i = 0; i < 110; i++) {
    const x = (hash(i) * W + Math.sin(m * 0.3 + i) * 14) % W;
    const y = (((hash(i + 300) * H - m * (4 + hash(i + 600) * 14)) % H) + H) % H;
    g.fillStyle = white(0.12 + 0.35 * hash(i + 900) * (0.6 + 0.4 * Math.sin(m * 1.7 + i * 2)));
    g.beginPath();
    g.arc(x, y, 0.8 + hash(i + 1200) * 2.1, 0, TAU);
    g.fill();
  }
}

function rain(g, x, y, w, h, t) {
  for (let i = 0; i < 16; i++) {
    const bx = x + hash(i + 40) * w, by = y + hash(i + 80) * h, rad = 22 + hash(i + 120) * 55;
    const gr = g.createRadialGradient(bx, by, 0, bx, by, rad);
    gr.addColorStop(0, white(0.1 + 0.05 * Math.sin(t * 0.8 + i)));
    gr.addColorStop(1, white(0));
    g.fillStyle = gr;
    g.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
  }
  // мелкие капли на стекле
  for (let i = 0; i < 130; i++) {
    g.fillStyle = white(0.1 + hash(i + 5) * 0.25);
    g.beginPath();
    g.arc(x + hash(i + 11) * w, y + hash(i + 23) * h, 0.8 + hash(i + 31) * 2.4, 0, TAU);
    g.fill();
  }
  // стекающие капли
  for (let i = 0; i < 18; i++) {
    const speed = 35 + hash(i + 200) * 150;
    const span = h + 220;
    const dy = y - 40 + ((hash(i + 260) * span + t * speed) % span);
    const dx = x + hash(i + 320) * w;
    const tail = 40 + hash(i + 380) * 90;
    const gr = g.createLinearGradient(0, dy - tail, 0, dy);
    gr.addColorStop(0, white(0));
    gr.addColorStop(1, white(0.4));
    g.fillStyle = gr;
    g.fillRect(dx - 1.5, dy - tail, 3, tail);
    const s = 4 + hash(i + 440) * 4;
    g.fillStyle = 'rgba(210,215,225,.75)';
    g.beginPath();
    g.ellipse(dx, dy, s, s * 1.3, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(20,22,28,.65)';
    g.beginPath();
    g.arc(dx, dy + s * 0.2, s * 0.45, 0, TAU);
    g.fill();
  }
}

function media(r, g, t, [x, y, w, h]) {
  const d = r.deck;
  const src = r.cardMedia || r.cover;
  const sw = src.videoWidth || src.width, sh = src.videoHeight || src.height;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 34);
  g.fillStyle = '#15151a';
  g.fill();
  g.clip();
  if (sw && sh) {
    const zoom = r.cardMedia?.videoWidth ? 1 : 1.06 + (r.style.motion ? Math.sin(t * 0.12) * 0.05 : 0);
    const k = Math.max(w / sw, h / sh) * zoom;
    g.drawImage(src, x + (w - sw * k) / 2, y + (h - sh * k) / 2, sw * k, sh * k);
  }
  if (d.mono) {
    g.globalCompositeOperation = 'saturation';
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  if (d.rain) {
    g.fillStyle = 'rgba(6,8,14,.3)';
    g.fillRect(x, y, w, h);
    rain(g, x, y, w, h, t);
  }
  const shade = g.createLinearGradient(0, y + h - 110, 0, y + h);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,.65)');
  g.fillStyle = shade;
  g.fillRect(x, y + h - 110, w, 110);
  g.restore();
  g.strokeStyle = white(0.14);
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(x, y, w, h, 34);
  g.stroke();

  g.font = `700 22px ${FONT}`;
  const lw = g.measureText('Сейчас играет').width;
  box(g, x + 20, y + 18, lw + 66, 40, 20, 'rgba(10,10,14,.6)');
  for (let i = 0; i < 3; i++) {
    const bh = 9 + 11 * (0.5 + 0.5 * Math.sin(t * (6 + i * 1.7) + i * 2));
    box(g, x + 36 + i * 8, y + 48 - bh, 4, bh, 2, '#fff');
  }
  text(g, 'Сейчас играет', x + 68, y + 39, 22, 700);
  const line = `${r.meta.artist || 'Исполнитель'} · ${r.meta.title || 'Название'}`.toUpperCase();
  text(g, fit(g, line, w - 220, 21, 700), x + 24, y + h - 28, 21, 700);
  const p = (n) => String(n).padStart(2, '0');
  const s = Math.max(0, Math.floor(t));
  text(g, `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`, x + w - 24, y + h - 28, 21, 700, '#fff', 'right');
}

function player(r, g, t, [x, y, w, h]) {
  card(g, [x, y, w, h]);
  const title = r.meta.title || 'Название трека';
  text(g, fit(g, title, w - 210, 42, 800), x + 28, y + 40, 42, 800);
  text(g, fit(g, r.meta.artist || 'Исполнитель', w - 210, 28, 500), x + 28, y + 82, 28, 500, white(0.65));
  for (const [i, cx] of [x + w - 116, x + w - 52].entries()) {
    g.fillStyle = white(0.11);
    g.beginPath(); g.arc(cx, y + 54, 27, 0, TAU); g.fill();
    if (i === 0) star(g, cx, y + 55, 15, '#fff', true);
    else for (let k = -1; k <= 1; k++) { g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + k * 10, y + 54, 3.4, 0, TAU); g.fill(); }
  }
  const p = r.duration ? clamp(t / r.duration) : 0;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const py = y + 126;
  text(g, mmss(Math.max(0, t)), x + 28, py, 20, 600, white(0.7));
  text(g, `-${mmss(Math.max(0, r.duration - Math.floor(t)))}`, x + w - 28, py, 20, 600, white(0.7), 'right');
  const bx = x + 96, bw = w - 200;
  box(g, bx, py - 3, bw, 7, 4, white(0.25));
  box(g, bx, py - 3, Math.max(7, bw * p), 7, 4, '#fff');
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(bx + bw * p, py, 10, 0, TAU); g.fill();

  const cy = y + 170;
  g.fillStyle = white(0.8);
  poly(g, [[x + 28, cy - 6], [x + 37, cy - 6], [x + 49, cy - 15], [x + 49, cy + 15], [x + 37, cy + 6], [x + 28, cy + 6]]);
  box(g, x + 60, cy - 3, 110, 6, 3, white(0.25));
  box(g, x + 60, cy - 3, 74, 6, 3, white(0.85));
  const mid = x + w / 2;
  g.fillStyle = '#fff';
  for (const [ox, dir] of [[-90, -1], [90, 1]]) {
    for (const k of [-13, 4]) {
      const a = mid + ox + (k + (dir < 0 ? 9 : 0)) * 1;
      poly(g, dir > 0 ? [[a, cy - 13], [a + 19, cy], [a, cy + 13]] : [[a + 10, cy - 13], [a - 9, cy], [a + 10, cy + 13]]);
    }
  }
  box(g, mid - 14, cy - 16, 9, 32, 3, '#fff');
  box(g, mid + 5, cy - 16, 9, 32, 3, '#fff');
  box(g, x + w - 150, cy - 21, 42, 42, 11, '#fff');
  bubble(g, x + w - 129, cy, 25, '#2a2226');
  for (let i = 0; i < 3; i++) {
    box(g, x + w - 70, cy - 13 + i * 11, 5, 5, 2.5, white(0.85));
    box(g, x + w - 59, cy - 13 + i * 11, 30, 5, 2.5, white(0.85));
  }
}

const group = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function widgets(r, g, t, rects) {
  const d = r.deck;
  const { from, to } = r.clip;
  const part = clamp((t - from) / Math.max(1, to - from));
  {
    const [x, y, w, h] = rects[0];
    card(g, rects[0]);
    star(g, x + 36, y + 42, 13, r.accent);
    text(g, fit(g, d.leftTitle || 'Пульс', w - 160, 26, 700), x + 58, y + 42, 26, 700);
    text(g, 'Сейчас', x + w - 24, y + 42, 20, 500, white(0.55), 'right');
    const custom = Number(String(d.leftValue).replace(/\s/g, ''));
    const has = String(d.leftValue).trim() !== '' && Number.isFinite(custom);
    // своё число плавно «накручивается» до заданного, иначе — громкость трека
    const value = has ? group(custom * (0.8 + 0.2 * part)) : `${Math.round(Math.sqrt(r.energy(t)) * 100)}%`;
    text(g, fit(g, value, w - 48, 60, 800), x + 26, y + 112, 60, 800);
    text(g, fit(g, d.leftCaption || (has ? '' : 'громкость'), w - 52, 23, 500), x + 28, y + 160, 23, 500, white(0.65));
    const n = 20, bw = (w - 52) / n;
    for (let i = 0; i < n; i++) {
      const e = Math.sqrt(r.energy(Math.max(0, t - (n - 1 - i) * 0.14)));
      const bh = 12 + e * 82;
      box(g, x + 26 + i * bw, y + h - 28 - bh, bw * 0.68, bh, 4, i >= n - 5 ? r.accent : white(0.3));
    }
  }
  {
    const [x, y, w] = rects[1];
    card(g, rects[1]);
    heart(g, x + 36, y + 43, 28, r.accent);
    text(g, fit(g, d.rightTitle || 'Настрой', w - 160, 26, 700), x + 58, y + 42, 26, 700);
    text(g, 'Сейчас', x + w - 24, y + 42, 20, 500, white(0.55), 'right');
    const cx = x + w / 2, cy = y + 156, rad = 66;
    g.lineWidth = 15;
    g.lineCap = 'round';
    g.strokeStyle = white(0.16);
    g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke();
    g.strokeStyle = r.accent;
    g.beginPath(); g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.002, part)); g.stroke();
    text(g, `${Math.round(part * 100)}%`, cx, cy + 2, 36, 800, '#fff', 'center');
    let label = '', since = 0;
    for (const it of r.items) {
      if (it.time > t + 0.15) break;
      if (it.label) { label = it.label; since = it.time; }
    }
    if (label) {
      const pop = smooth((t - since + 0.15) / 0.35);
      g.save();
      g.globalAlpha = pop;
      const s = fit(g, label, w - 90, 23, 700);
      g.font = `700 23px ${FONT}`;
      const tw = g.measureText(s).width;
      box(g, cx - tw / 2 - 20, y + 252 + (1 - pop) * 12, tw + 40, 40, 20, white(0.14));
      text(g, s, cx, y + 273 + (1 - pop) * 12, 23, 700, '#fff', 'center');
      g.restore();
    }
    text(g, 'Состояние', cx, y + 308, 18, 500, white(0.45), 'center');
  }
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
  box(g, x, y, w, h, h / 2, '#000');
  g.save();
  g.beginPath(); g.arc(x + 34, y + h / 2, 22, 0, TAU); g.clip();
  g.drawImage(r.art, x + 12, y + h / 2 - 22, 44, 44);
  g.restore();
  text(g, fit(g, r.meta.title || 'Название', w - 175, 21, 700), x + 68, y + 22, 21, 700);
  text(g, fit(g, r.meta.artist || 'Исполнитель', w - 175, 18, 500), x + 68, y + 44, 18, 500, white(0.6));
  const e = Math.sqrt(r.energy(t));
  for (let i = 0; i < 6; i++) {
    const bh = 7 + 28 * e * (0.45 + 0.55 * Math.abs(Math.sin(t * (7 + i) + i * 1.9)));
    box(g, x + w - 88 + i * 11, y + h / 2 - bh / 2, 6, bh, 3, i < 2 ? r.accent : '#fff');
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
    box(g, x, y, w, h, 32, 'rgb(52,46,50)');
    g.strokeStyle = white(0.14);
    g.lineWidth = 2;
    g.stroke();
    box(g, x + 22, y + h / 2 - 33, 66, 66, 18, r.accent);
    bubble(g, x + 55, y + h / 2, 40, '#fff');
    text(g, 'СООБЩЕНИЕ', x + 108, y + 28, 18, 600, white(0.55));
    text(g, 'сейчас', x + w - 24, y + 28, 18, 500, white(0.55), 'right');
    text(g, fit(g, n.from, w - 140, 26, 700), x + 108, y + 62, 26, 700);
    text(g, fit(g, n.text, w - 136, 24, 500), x + 108, y + h - 28, 24, 500);
    g.restore();
  }
}

export function drawDeck(r, g, t) {
  const G = GEOMETRY[r.style.layout];
  background(r, g, t);
  statusBar(r, g, G.status);
  island(r, g, t, G.island);
  media(r, g, t, G.media);
  player(r, g, t, G.player);
  if (G.widgets) widgets(r, g, t, G.widgets);
  const [hx, hy] = G.header;
  bubble(g, hx + 15, hy, 28, white(0.6));
  const w = text(g, 'Текст песни', hx + 40, hy, 25, 600, white(0.6));
  box(g, hx + 54 + w, hy - 16, 62, 32, 8, white(0.15));
  text(g, 'LIVE', hx + 85 + w, hy + 1, 18, 800, white(0.85), 'center');
  r.drawLyrics(g, t);
  notice(r, g, t, G.notice);
}
