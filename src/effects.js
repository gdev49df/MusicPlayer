// Эффекты поверх верхней карточки. Всё зависит только от времени t.

const TAU = Math.PI * 2;
export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const white = (a) => `rgba(255,255,255,${a})`;
const wrap = (v, m) => ((v % m) + m) % m;

function dot(g, x, y, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

function rain(g, [x, y, w, h], t, s) {
  for (let i = 0; i < Math.round(20 * s); i++) {
    const bx = x + hash(i + 40) * w, by = y + hash(i + 80) * h, rad = 22 + hash(i + 120) * 55;
    const gr = g.createRadialGradient(bx, by, 0, bx, by, rad);
    gr.addColorStop(0, white(0.1 + 0.05 * Math.sin(t * 0.8 + i)));
    gr.addColorStop(1, white(0));
    g.fillStyle = gr;
    g.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < Math.round(170 * s); i++) {
    dot(g, x + hash(i + 11) * w, y + hash(i + 23) * h, 0.8 + hash(i + 31) * 2.4, white(0.1 + hash(i + 5) * 0.25));
  }
  for (let i = 0; i < Math.round(28 * s); i++) {
    const speed = 45 + hash(i + 200) * 170;
    const dy = y - 40 + wrap(hash(i + 260) * (h + 220) + t * speed, h + 220);
    const dx = x + hash(i + 320) * w;
    const tail = 40 + hash(i + 380) * 90;
    const gr = g.createLinearGradient(0, dy - tail, 0, dy);
    gr.addColorStop(0, white(0));
    gr.addColorStop(1, white(0.4));
    g.fillStyle = gr;
    g.fillRect(dx - 1.5, dy - tail, 3, tail);
    const r = 4 + hash(i + 440) * 4;
    g.fillStyle = 'rgba(210,215,225,.75)';
    g.beginPath();
    g.ellipse(dx, dy, r, r * 1.3, 0, 0, TAU);
    g.fill();
    dot(g, dx, dy + r * 0.2, r * 0.45, 'rgba(20,22,28,.65)');
  }
}

function snow(g, [x, y, w, h], t, s) {
  for (let i = 0; i < Math.round(240 * s); i++) {
    const depth = hash(i + 7);
    const r = 1.2 + depth * depth * 6;
    const px = x + wrap(hash(i + 71) * w + Math.sin(t * (0.5 + depth) + i) * 22 + t * 9 * depth, w);
    const py = y - 10 + wrap(hash(i + 133) * (h + 20) + t * (18 + depth * 75), h + 20);
    dot(g, px, py, r, white(0.25 + depth * 0.65));
  }
}

function sparks(g, [x, y, w, h], t, s, beat, [R, G, B]) {
  g.save();
  g.globalCompositeOperation = 'lighter';
  const glow = g.createLinearGradient(0, y + h * 0.45, 0, y + h);
  glow.addColorStop(0, `rgba(${R},${G},${B},0)`);
  glow.addColorStop(1, `rgba(${R},${G},${B},${(0.18 + beat * 0.35) * s})`);
  g.fillStyle = glow;
  g.fillRect(x, y, w, h);
  for (let i = 0; i < Math.round(110 * s); i++) {
    const life = wrap(hash(i + 3) + t * (0.14 + hash(i + 9) * 0.3), 1);
    const px = x + hash(i + 17) * w + Math.sin(t * 2 + i) * 18 * life;
    const py = y + h + 6 - life * h * (0.55 + hash(i + 29) * 0.55);
    const r = (1.3 + hash(i + 41) * 3.4) * (1 - life * 0.6) * (1 + beat * 0.5);
    dot(g, px, py, r * 3, `rgba(${R},${G},${B},${0.18 * (1 - life)})`);
    dot(g, px, py, r, `rgba(255,${Math.round(190 + G * 0.2)},${Math.round(150 + B * 0.3)},${0.95 * (1 - life)})`);
  }
  g.restore();
}

function vhs(g, [x, y, w, h], t, s) {
  g.fillStyle = `rgba(0,0,0,${0.38 * s})`;
  for (let py = y + (wrap(t * 18, 6)); py < y + h; py += 6) g.fillRect(x, py, w, 2.5);
  const band = y - 60 + wrap(t * 85, h + 120);
  const gr = g.createLinearGradient(0, band, 0, band + 55);
  gr.addColorStop(0, white(0));
  gr.addColorStop(0.5, white(0.2 * s));
  gr.addColorStop(1, white(0));
  g.fillStyle = gr;
  g.fillRect(x, band, w, 55);
  const tick = Math.floor(t * 18);
  for (let i = 0; i < Math.round(60 * s); i++) {
    const k = tick * 61 + i;
    g.fillStyle = white(hash(k) * 0.5);
    g.fillRect(x + hash(k + 1) * w, i % 3 ? band + hash(k + 2) * 55 : y + h - hash(k + 2) * 26, 3 + hash(k + 3) * 34, 2);
  }
  g.font = '700 22px ui-monospace, Consolas, monospace';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,40,90,.75)';
  g.fillText('PLAY ▶', x + w - 27, y + 38);
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText('PLAY ▶', x + w - 24, y + 38);
}

// рисуется до чёрно-белого фильтра: смещает куски самой картинки
export function distort(g, [x, y, w, h], t, type, s, beat, image) {
  if (type === 'vhs') {
    g.save();
    g.globalAlpha *= 0.35 * s;
    g.globalCompositeOperation = 'screen';
    image(7 + Math.sin(t * 9) * 4);
    g.restore();
    const jitter = y + h - 34;
    g.save();
    g.beginPath(); g.rect(x, jitter, w, 34); g.clip();
    image(Math.sin(t * 31) * 24 * s);
    g.restore();
  }
  if (type === 'glitch') {
    const step = Math.floor(t * 12);
    if (hash(step) > 0.2 + 0.4 * s && beat < 0.55) return;
    for (let i = 0; i < 3 + Math.round(7 * s); i++) {
      const k = step * 13 + i;
      const sy = y + hash(k + 1) * h, sh = 5 + hash(k + 2) * 40;
      g.save();
      g.beginPath(); g.rect(x, sy, w, sh); g.clip();
      image((hash(k + 3) - 0.5) * 150 * s);
      g.restore();
    }
  }
}

export function overlay(g, rect, t, type, s, beat, rgb) {
  if (s <= 0) return;
  if (type === 'rain') rain(g, rect, t, s);
  if (type === 'snow') snow(g, rect, t, s);
  if (type === 'sparks') sparks(g, rect, t, s, beat, rgb);
  if (type === 'vhs') vhs(g, rect, t, s);
  if (type === 'glitch') {
    const [x, y, w, h] = rect;
    const step = Math.floor(t * 12);
    if (hash(step) > 0.2 + 0.4 * s && beat < 0.55) return;
    g.save();
    g.globalCompositeOperation = 'screen';
    for (let i = 0; i < 6; i++) {
      const k = step * 29 + i;
      g.fillStyle = i % 2 ? `rgba(0,230,255,${0.45 * s})` : `rgba(255,0,140,${0.45 * s})`;
      g.fillRect(x + hash(k) * w * 0.8, y + hash(k + 1) * h, 40 + hash(k + 2) * 260, 2 + hash(k + 3) * 9);
    }
    g.restore();
  }
}
