// Отрисовка кадра 1080×1920. Кадр зависит только от времени t,
// поэтому предпросмотр и экспорт выглядят одинаково.

import { drawDeck, deckGeometry } from './deck.js';
import { BANDS } from './audio.js';

// размер вертикальных макетов
const W = 1080;
const H = 1920;

const FONT = '"Inter Variable", -apple-system, "Segoe UI", Roboto, sans-serif';
const BLUR_STEP = 2.4;
const PAD = 40;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v) => { v = clamp(v); return v * v * (3 - 2 * v); };
// критически затухающая пружина: быстрый старт, мягкая посадка
const spring = (v) => (v <= 0 ? 0 : v >= 1.6 ? 1 : 1 - (1 + 7 * v) * Math.exp(-7 * v));
const mix = (a, b, k) => a + (b - a) * k;

const LAYOUTS = {
  // рамку и якорь «Панели» считает deckGeometry
  deck: { deck: true, W: 1920, H: 1080, size: 74, gap: 50 },
  deckTall: { deck: true, size: 68, gap: 42 },
  lyrics: { box: [80, 465, 880, 1470], anchor: 665, size: 78, gap: 54 },
  cover: { box: [80, 1130, 880, 1540], anchor: 1215, size: 58, gap: 34 },
  text: { box: [80, 330, 880, 1500], anchor: 760, size: 96, gap: 62 },
};

const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
};

function placeholderCover() {
  const c = canvas(600, 600);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 600, 600);
  gr.addColorStop(0, '#2f6f6a');
  gr.addColorStop(0.55, '#41336e');
  gr.addColorStop(1, '#a8455c');
  g.fillStyle = gr;
  g.fillRect(0, 0, 600, 600);
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 22;
  g.lineCap = 'round';
  [70, 150, 230, 120, 190, 90].forEach((h, i) => {
    g.beginPath();
    g.moveTo(175 + i * 50, 300 - h / 2);
    g.lineTo(175 + i * 50, 300 + h / 2);
    g.stroke();
  });
  return c;
}

// размытый и насыщенный «отпечаток» обложки для фона
function makeBlob(img) {
  let c = canvas(20, 20);
  let g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  drawSquare(g, img, 0, 0, 20);
  const d = g.getImageData(0, 0, 20, 20);
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, gg, b] = [d.data[i], d.data[i + 1], d.data[i + 2]];
    const l = 0.3 * r + 0.59 * gg + 0.11 * b;
    const dim = l > 150 ? 150 / l : 1;
    d.data[i] = clamp((l + (r - l) * 1.7) * dim, 0, 255);
    d.data[i + 1] = clamp((l + (gg - l) * 1.7) * dim, 0, 255);
    d.data[i + 2] = clamp((l + (b - l) * 1.7) * dim, 0, 255);
  }
  g.putImageData(d, 0, 0);
  for (const s of [48, 128, 320]) {
    const n = canvas(s, s);
    const ng = n.getContext('2d');
    ng.imageSmoothingQuality = 'high';
    ng.drawImage(c, 0, 0, s, s);
    c = n; g = ng;
  }
  return c;
}

// самый заметный цвет обложки, осветлённый до читаемого
function accentOf(img) {
  const c = canvas(32, 32);
  const g = c.getContext('2d', { willReadFrequently: true });
  drawSquare(g, img, 0, 0, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, h: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
    const span = max - min;
    if (span < 50 || max < 70) continue;
    let h = max === d[i] ? (d[i + 1] - d[i + 2]) / span : max === d[i + 1] ? 2 + (d[i + 2] - d[i]) / span : 4 + (d[i] - d[i + 1]) / span;
    h = (h * 60 + 360) % 360;
    const bin = bins[Math.floor(h / 30)];
    bin.w += span; bin.h += h * span;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < 1500) return null;
  const h = best.h / best.w;
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.66 - 0.34 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

function drawSquare(g, img, x, y, s) {
  const iw = img.width, ih = img.height, m = Math.min(iw, ih);
  g.drawImage(img, (iw - m) / 2, (ih - m) / 2, m, m, x, y, s, s);
}

function ellipsis(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  const chars = [...text];
  while (chars.length && g.measureText(`${chars.join('')}…`).width > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

export const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Renderer {
  constructor() {
    this.style = { layout: 'deck', scale: 1, karaoke: true, blur: true, progress: true, motion: true, nick: '' };
    this.meta = { title: '', artist: '' };
    this.items = [];
    this.duration = 0;
    this.sound = null;
    this.introOn = false;
    this.fxTime = null; // только предпросмотр на паузе
    this.lyricAlpha = 1;
    this.deckBg = canvas(480, 270);
    this.emptyText = 'Загрузите трек — здесь появится текст';
    this.bg = canvas(270, 480);
    this.deck = {
      effect: 'rain', strength: 0.7, mono: true, bgMode: 'cover', pulse: 0.6, intro: true, volume: 1,
      widgetMode: 'eq', clock: '9:41', date: '', leftTitle: '', leftValue: '', leftCaption: '', rightTitle: '',
      labels: {}, notices: [],
      show: { status: true, island: true, media: true, player: true, eq: true, ring: true, header: true },
    };
    this.cardMedia = null;
    this.clip = { from: 0, to: 1 };
    this.autoAccent = true;
    this.customAccent = '#ff5468';
    this.setCover(null);
    this.dirty = true;
  }

  get width() { return LAYOUTS[this.style.layout].W || 1080; }
  get height() { return LAYOUTS[this.style.layout].H || 1920; }

  updateAccent() {
    let rgb = this.coverRgb;
    if (!this.autoAccent || !rgb) {
      const n = parseInt(this.autoAccent ? 'ff5468' : this.customAccent.slice(1), 16);
      rgb = [n >> 16, (n >> 8) & 255, n & 255];
    }
    this.accentRgb = rgb;
    this.accent = `rgb(${rgb.join(',')})`;
  }

  // для своего видео в карточке: дождаться нужного кадра перед отрисовкой
  prepare(t) {
    const v = this.cardMedia;
    if (!v?.duration || !LAYOUTS[this.style.layout].deck) return null;
    const at = t % v.duration;
    if (Math.abs(v.currentTime - at) < 0.001) return null;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); };
      const timer = setTimeout(done, 1500);
      v.addEventListener('seeked', done);
      v.currentTime = at;
    });
  }

  setCover(img) {
    this.cover = img || placeholderCover();
    this.blob = makeBlob(this.cover);
    this.coverRgb = img ? accentOf(this.cover) : null;
    this.updateAccent();
    this.soft = canvas(320, 320);
    const sg = this.soft.getContext('2d');
    sg.drawImage(this.blob, 0, 0);
    const mask = sg.createRadialGradient(160, 160, 30, 160, 160, 160);
    mask.addColorStop(0, '#000');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    sg.globalCompositeOperation = 'destination-in';
    sg.fillStyle = mask;
    sg.fillRect(0, 0, 320, 320);
    const art = canvas(900, 900);
    const g = art.getContext('2d');
    g.imageSmoothingQuality = 'high';
    drawSquare(g, this.cover, 0, 0, 900);
    this.art = art;
  }

  setLyrics(items) { this.items = items; this.dirty = true; }
  setStyle(s) { Object.assign(this.style, s); this.dirty = true; }

  layout(g) {
    let L = LAYOUTS[this.style.layout];
    if (L.deck) {
      this.G = deckGeometry(this.style.layout, this.deck.show);
      L = { ...L, box: this.G.box, anchor: this.G.anchor };
    }
    const size = Math.round(L.size * this.style.scale);
    const lh = Math.round(size * 1.2);
    const maxW = L.box[2] - L.box[0];
    g.font = `800 ${size}px ${FONT}`;
    const space = g.measureText(' ').width;
    let y = 0;
    this.lines = this.items.map((it) => {
      if (it.dots) {
        const line = { ...it, y, h: size * 0.8, rows: [] };
        y += line.h + L.gap;
        return line;
      }
      const rows = [[]];
      let x = 0;
      for (const w of it.words) {
        // слишком длинное «слово» (например, иероглифы) режем на куски
        const pieces = [];
        if (g.measureText(w.text).width > maxW) {
          let cur = '';
          for (const ch of w.text) {
            if (g.measureText(cur + ch).width > maxW) { pieces.push(cur); cur = ch; } else cur += ch;
          }
          pieces.push(cur);
        } else pieces.push(w.text);
        const len = [...w.text].length;
        let done = 0;
        for (const p of pieces) {
          const width = g.measureText(p).width;
          if (x > 0 && x + width > maxW) { rows.push([]); x = 0; }
          const n = [...p].length;
          rows[rows.length - 1].push({
            text: p, x, w: width, mark: w.mark,
            start: w.start + ((w.end - w.start) * done) / len,
            end: w.start + ((w.end - w.start) * (done + n)) / len,
          });
          done += n;
          x += width + space;
        }
      }
      const line = { ...it, y, h: rows.length * lh, rows, cache: [] };
      y += line.h + L.gap;
      return line;
    });
    this.L = L;
    this.size = size;
    this.lh = lh;
    this.dirty = false;
  }

  // картинка строки с нужным уровнем размытия (кэшируется)
  lineImage(line, level) {
    if (line.cache[level]) return line.cache[level];
    const maxW = this.L.box[2] - this.L.box[0];
    const c = canvas(maxW + PAD * 2, line.h + PAD * 2);
    const g = c.getContext('2d');
    g.font = `800 ${this.size}px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    const far = level ? 4000 : 0;
    if (level) {
      // размытие через тень: работает и в Safari, где нет ctx.filter
      g.shadowColor = '#fff';
      g.shadowBlur = level * BLUR_STEP * 2;
      g.shadowOffsetX = far;
    }
    line.rows.forEach((row, r) => row.forEach((w) => g.fillText(w.text, PAD + w.x - far, PAD + this.lh * (r + 0.5))));
    line.cache[level] = c;
    return c;
  }

  // значение из анализа звука в момент t с плавным переходом между кадрами
  sample(data, t, step = 1, shift = 0) {
    const i = Math.max(0, t * this.sound.rate);
    const k = Math.floor(i);
    return mix(data[k * step + shift] || 0, data[(k + 1) * step + shift] || 0, i - k);
  }

  energy(t) { return this.sound ? this.sample(this.sound.level, t) ** 2 : 0; }
  beat(t) { return this.sound ? this.sample(this.sound.beat, t) : 0; }
  band(t, b) {
    if (!this.sound) return 0;
    return this.sample(this.sound.bands, t, BANDS, Math.min(BANDS - 1, Math.floor(b)));
  }

  draw(g, t, { guides = false } = {}) {
    if (this.dirty) this.layout(g);
    g.save();
    g.globalAlpha = 1;
    if (this.L.deck) {
      drawDeck(this, g, t);
      if (this.style.nick) {
        g.font = `600 24px ${FONT}`;
        g.fillStyle = 'rgba(255,255,255,.45)';
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.fillText(this.style.nick, this.width - 66, this.height - 34);
      }
      if (guides && this.style.layout === 'deckTall') this.drawGuides(g);
      g.restore();
      return;
    }
    this.drawBackground(g, t);
    this.drawHeader(g, t);
    this.drawLyrics(g, t);
    if (this.style.progress) this.drawProgress(g, t);
    if (this.style.nick) {
      g.font = `600 30px ${FONT}`;
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this.style.nick, W / 2, 140);
    }
    if (guides) this.drawGuides(g);
    g.restore();
  }

  drawBackground(g, t) {
    const b = this.bg.getContext('2d');
    const m = this.style.motion ? t : 0;
    b.globalAlpha = 1;
    b.drawImage(this.blob, -105, 0, 480, 480);
    const spots = [
      [60, 90, 520, 0.07, 0, 0.95],
      [220, 380, 580, -0.055, 2, 0.9],
      [200, 150, 400, 0.1, 4, 0.75],
    ];
    for (const [x, y, s, v, ph, a] of spots) {
      b.save();
      b.translate(x + Math.sin(m * v * 3 + ph) * 55, y + Math.cos(m * v * 2.3 + ph) * 70);
      b.rotate(m * v * 2 + ph);
      b.globalAlpha = a;
      b.drawImage(this.soft, -s / 2, -s / 2, s, s);
      b.restore();
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.bg, 0, 0, W, H);
    const shade = g.createLinearGradient(0, 0, 0, H);
    const k = this.style.motion ? this.energy(t) * 0.09 : 0;
    shade.addColorStop(0, `rgba(8,8,12,${0.4 - k})`);
    shade.addColorStop(0.5, `rgba(8,8,12,${0.34 - k})`);
    shade.addColorStop(1, 'rgba(8,8,12,.66)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
  }

  roundArt(g, x, y, s, r, shadow) {
    g.save();
    if (shadow) {
      g.shadowColor = 'rgba(0,0,0,.45)';
      g.shadowBlur = 70;
      g.shadowOffsetY = 30;
      g.fillStyle = '#111';
      g.beginPath();
      g.roundRect(x, y, s, s, r);
      g.fill();
      g.shadowColor = 'transparent';
    }
    g.beginPath();
    g.roundRect(x, y, s, s, r);
    g.clip();
    g.drawImage(this.art, x, y, s, s);
    g.restore();
  }

  drawHeader(g, t) {
    const title = this.meta.title || 'Название трека';
    const artist = this.meta.artist || 'Исполнитель';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    const two = (x, y, max, s1, s2) => {
      g.fillStyle = '#fff';
      g.font = `700 ${s1}px ${FONT}`;
      g.fillText(ellipsis(g, title, max), x, y);
      g.fillStyle = 'rgba(255,255,255,.62)';
      g.font = `500 ${s2}px ${FONT}`;
      g.fillText(ellipsis(g, artist, max), x, y + s2 * 1.45);
    };
    if (this.style.layout === 'lyrics') {
      this.roundArt(g, 80, 210, 164, 22, true);
      two(280, 282, 640, 46, 38);
    } else if (this.style.layout === 'cover') {
      const beat = this.style.motion ? this.energy(t) : 0;
      const s = 680 * (1 + beat * 0.025);
      this.roundArt(g, W / 2 - s / 2, 560 - s / 2, s, 44, true);
      g.textAlign = 'center';
      two(W / 2, 990, 860, 54, 40);
      g.textAlign = 'left';
    } else {
      this.roundArt(g, 80, 200, 80, 14, false);
      two(186, 232, 700, 32, 28);
    }
  }

  drawLyrics(g, t) {
    const L = this.L;
    const lines = this.lines;
    const [x0, top, , bottom] = L.box;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    if (!lines.length) {
      if (!this.emptyText) return;
      g.font = `700 42px ${FONT}`;
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.textAlign = 'center';
      g.font = `700 ${L.deck ? 34 : 42}px ${FONT}`;
      g.fillText(this.emptyText, (L.box[0] + L.box[2]) / 2, L.anchor + 80);
      return;
    }
    // позиция прокрутки с лёгким «каскадом» для нижних строк
    let active = -1;
    for (let i = 0; i < lines.length && lines[i].time <= t; i++) active = i;
    const scrollAt = (lag) => {
      let s = lines[0].y;
      for (let j = 1; j < lines.length; j++) {
        const p = spring((t - lines[j].time + 0.18 - lag) / 0.8);
        if (!p) break;
        s += (lines[j].y - lines[j - 1].y) * p;
      }
      return s;
    };
    const focus = Math.max(0, active);
    const first = Math.max(0, focus - 4);
    const last = Math.min(lines.length - 1, focus + 9);
    // дробный индекс активной строки — для плавной смены размытия
    let pos = 0;
    for (let j = 1; j <= last; j++) pos += smooth((t - lines[j].time + 0.18) / 0.45);

    // во время проигрыша следующую строку видно отчётливо
    const waiting = L.deck && lines[focus].dots ? smooth((t - lines[focus].time) / 0.5) * (1 - smooth((t - lines[focus].end + 0.3) / 0.4)) : 0;

    for (let i = first; i <= last; i++) {
      const line = lines[i];
      const lag = clamp(i - pos, 0, 6) * 0.045;
      const y = L.anchor + line.y - scrollAt(lag);
      if (y + line.h < top - 80 || y > bottom + 40) continue;
      const edge = smooth((y - (top - 75)) / 140) * smooth((bottom - (y + line.h / 2)) / 220);
      if (edge <= 0.01) continue;
      const next = lines[i + 1];
      const outAt = next ? next.time : Math.max(line.end + 1.5, this.duration);
      const on = smooth((t - line.time + 0.15) / 0.3) * (1 - smooth((t - outAt + 0.18) / 0.35));

      if (line.dots) { this.drawDots(g, line, x0, y, t, on * edge * this.lyricAlpha); continue; }

      const dist = Math.abs(i - pos);
      const past = i < pos ? clamp(pos - i) : 0;
      // в «Панели» спетые строки уходят совсем, а дальние тускнеют
      const upcoming = i === focus + 1 ? waiting : 0;
      const base = L.deck ? mix(mix(0.5 * clamp(1 - (dist - 1) * 0.27, 0.2, 1), 0.82, upcoming), 0, past) : mix(0.36, 0.17, past);
      const scale = 0.965 + 0.035 * on;
      g.save();
      g.translate(x0, y + line.h / 2);
      g.scale(scale, scale);
      g.translate(0, -line.h / 2);
      if (on < 0.999) {
        const level = this.style.blur ? clamp(L.deck ? (dist - 0.8) * 1.15 : dist - 0.15, 0, 4) * (1 - upcoming) : 0;
        const lo = Math.floor(level);
        const k = level - lo;
        const a = base * edge * (1 - on) * this.lyricAlpha;
        if (k < 0.99) { g.globalAlpha = a * (1 - k); g.drawImage(this.lineImage(line, lo), -PAD, -PAD); }
        if (k > 0.01) { g.globalAlpha = a * Math.min(1, k * 1.15); g.drawImage(this.lineImage(line, lo + 1), -PAD, -PAD); }
      }
      if (on > 0.001) this.drawActive(g, line, t, on * edge * this.lyricAlpha);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  drawActive(g, line, t, alpha) {
    g.font = `800 ${this.size}px ${FONT}`;
    g.globalAlpha = alpha;
    line.rows.forEach((row, r) => {
      const cy = this.lh * (r + 0.5);
      if (this.L.deck) { this.drawAccentRow(g, row, cy, t); return; }
      for (const w of row) {
        if (!this.style.karaoke) {
          g.fillStyle = w.mark ? this.accent : '#fff';
          g.fillText(w.text, w.x, cy);
          continue;
        }
        const p = clamp((t - w.start) / Math.max(0.05, w.end - w.start));
        const lift = -this.size * 0.045 * smooth((t - w.start) / Math.max(0.35, w.end - w.start));
        if (p <= 0) g.fillStyle = 'rgba(255,255,255,.34)';
        else if (p >= 1) g.fillStyle = '#fff';
        else {
          const soft = this.size * 0.55;
          const edge = w.x - soft + (w.w + soft) * p;
          const gr = g.createLinearGradient(edge, 0, edge + soft, 0);
          gr.addColorStop(0, '#fff');
          gr.addColorStop(1, 'rgba(255,255,255,.34)');
          g.fillStyle = gr;
        }
        g.fillText(w.text, w.x, cy + lift);
      }
    });
  }

  // поющееся слово заливается акцентным цветом и светится
  drawAccentRow(g, row, cy, t) {
    const dim = 'rgba(255,255,255,.38)';
    const [R, G, B] = this.accentRgb;
    for (const w of row) {
      const p = this.style.karaoke ? clamp((t - w.start) / Math.max(0.05, w.end - w.start)) : 1;
      g.shadowBlur = 0;
      if (p <= 0) g.fillStyle = dim;
      else if (p < 1) {
        const gr = g.createLinearGradient(w.x, 0, w.x + w.w, 0);
        gr.addColorStop(0, this.accent);
        gr.addColorStop(p, this.accent);
        gr.addColorStop(Math.min(1, p + 0.12), dim);
        gr.addColorStop(1, dim);
        g.fillStyle = gr;
        g.shadowColor = `rgba(${R},${G},${B},.8)`;
        g.shadowBlur = 26;
      } else {
        const k = w.mark || !this.style.karaoke ? 0 : smooth((t - w.end) / 0.25);
        const base = w.mark ? [R, G, B] : this.style.karaoke ? [R, G, B] : [255, 255, 255];
        g.fillStyle = `rgb(${base.map((v) => Math.round(mix(v, 255, k))).join(',')})`;
        g.shadowColor = w.mark ? `rgba(${R},${G},${B},.8)` : 'rgba(255,255,255,.55)';
        g.shadowBlur = 20;
      }
      g.fillText(w.text, w.x, cy);
    }
    g.shadowBlur = 0;
  }

  drawDots(g, line, x, y, t, alpha) {
    if (alpha <= 0.01) return;
    const len = Math.max(0.5, line.end - line.time);
    const p = clamp((t - line.time) / len);
    const breathe = 1 + Math.sin((t - line.time) * 2.4) * 0.09;
    const big = this.L.deck ? 1.35 : 1;
    const r = this.size * 0.15 * big * breathe * (1 - smooth((t - line.end + 0.35) / 0.35) * 0.7);
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = alpha * mix(0.28, 1, clamp(p * 3 - i));
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(x + this.size * 0.22 * big + i * this.size * 0.52 * big, y + line.h / 2, r, 0, Math.PI * 2);
      g.fill();
    }
    if (this.L.deck && line.end - t > 0.6) { // сколько ещё ждать
      g.globalAlpha = alpha * 0.6;
      g.font = `600 ${Math.round(this.size * 0.38)}px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(`${this.deck.labels.pause || 'проигрыш'} · ${Math.ceil(line.end - t)} с`, x + this.size * 2.45, y + line.h / 2 + 2);
    }
    g.globalAlpha = 1;
  }

  drawProgress(g, t) {
    const x = 80, w = 800, y = this.style.layout === 'cover' ? 1582 : 1532;
    const p = this.duration ? clamp(t / this.duration) : 0;
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath(); g.roundRect(x, y, w, 10, 5); g.fill();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.beginPath(); g.roundRect(x, y, Math.max(10, w * p), 10, 5); g.fill();
    g.font = `600 27px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(fmt(t), x, y + 50);
    g.textAlign = 'right';
    g.fillText(`−${fmt(this.duration - Math.floor(t))}`, x + w, y + 50);
    g.textAlign = 'left';
  }

  // зоны, которые в TikTok закрывает интерфейс (только предпросмотр)
  drawGuides(g) {
    g.fillStyle = 'rgba(255,60,90,.22)';
    g.fillRect(0, 0, W, 130);
    g.fillRect(0, 1620, W, 300);
    g.fillRect(940, 760, 140, 860);
    g.font = `600 30px ${FONT}`;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('поиск и вкладки', W / 2, 70);
    g.fillText('подпись и звук', W / 2, 1780);
  }
}
