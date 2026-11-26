// Обработка звука: скорость, реверберация, бас, громкость, анализ частот.

export const RATE = 48000;
export const BANDS = 24;
const FPS = 30;

/* ---------- эффекты ---------- */

function impulse(ctx, seconds = 2.6) {
  const n = Math.floor(RATE * seconds);
  const ir = ctx.createBuffer(2, n, RATE);
  let seed = 12345; // одинаковый «зал» при каждом запуске
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (random() * 2 - 1) * (1 - i / n) ** 2.4 * Math.min(1, i / (RATE * 0.012));
  }
  return ir;
}

export const isNeutral = ({ speed, reverb, bass }) => speed === 1 && !reverb && !bass;

export async function processTrack(source, { speed = 1, reverb = 0, bass = 0 }) {
  if (isNeutral({ speed, reverb, bass })) return source;
  const length = Math.max(1, Math.ceil((source.duration / speed) * RATE));
  const ctx = new OfflineAudioContext(2, length, RATE);
  const src = ctx.createBufferSource();
  src.buffer = source;
  src.playbackRate.value = speed; // вместе с темпом опускается и тон — это и есть slowed
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 110;
  low.gain.value = bass;
  src.connect(low);
  const dry = ctx.createGain();
  dry.gain.value = 1 - reverb * 0.3;
  low.connect(dry).connect(ctx.destination);
  if (reverb > 0) {
    const room = ctx.createConvolver();
    room.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = reverb * 0.85;
    low.connect(room).connect(wet).connect(ctx.destination);
  }
  src.start();
  const out = await ctx.startRendering();
  // эффекты могут поднять пики выше предела — приглушаем весь трек
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) {
    for (const v of out.getChannelData(c)) if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0.98) {
    const k = 0.98 / peak;
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return out;
}

/* ---------- анализ: частоты, громкость, удары баса ---------- */

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = i; k < i + len / 2; k++) {
        const m = k + len / 2;
        const tr = re[m] * cr - im[m] * ci, ti = re[m] * ci + im[m] * cr;
        re[m] = re[k] - tr; im[m] = im[k] - ti;
        re[k] += tr; im[k] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Удар — заметный прирост баса или середины. Порог подстраивается под место в песне,
// поэтому в тихих частях и в треках без бочки картинка тоже откликается.
function beats(bass, mid, level) {
  const n = bass.length;
  const scale = (data) => {
    const sorted = Float32Array.from(data).sort();
    const strong = sorted[Math.floor(n * 0.96)] || sorted[n - 1] || 1;
    return data.map((v) => v / strong);
  };
  const a = scale(bass), b = scale(mid);
  const onset = Float32Array.from(a, (v, i) => Math.max(v, b[i] * 0.6));
  const around = Math.round(FPS * 2.5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let top = 0;
    for (let j = Math.max(0, i - around); j < Math.min(n, i + around); j++) top = Math.max(top, onset[j]);
    const ref = Math.max(0.25, Math.min(1, top * 0.85));
    const hit = level[i] < 0.04 ? 0 : Math.min(1, onset[i] / ref);
    out[i] = Math.max(hit > 0.45 ? hit : 0, (out[i - 1] || 0) * 0.83);
  }
  return out;
}

export function analyse(buffer) {
  const size = 2048;
  const hop = buffer.sampleRate / FPS;
  const n = Math.max(1, Math.ceil(buffer.length / hop));
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const hann = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const top = Math.min(14000, buffer.sampleRate / 2);
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((40 * (top / 40) ** (i / BANDS) * size) / buffer.sampleRate));
  const raw = new Float32Array(n * BANDS);
  const level = new Float32Array(n);
  const low = new Float32Array(n);
  const mid = new Float32Array(n); // прирост средних частот: хлопки, малый барабан, гитара
  const midTop = Math.round((4000 * size) / buffer.sampleRate);
  const prev = new Float32Array(midTop + 1);
  const re = new Float32Array(size), im = new Float32Array(size);
  const bassTop = Math.max(3, Math.round((150 * size) / buffer.sampleRate));
  let maxLevel = 1e-6;
  const maxBand = new Float32Array(BANDS).fill(-120);
  for (let f = 0; f < n; f++) {
    const start = Math.floor(f * hop) - size / 2;
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const j = start + i;
      const v = j >= 0 && j < left.length ? (left[j] + right[j]) / 2 : 0;
      re[i] = v * hann[i]; im[i] = 0; sum += v * v;
    }
    level[f] = Math.sqrt(sum / size);
    maxLevel = Math.max(maxLevel, level[f]);
    fft(re, im);
    for (let k = 1; k <= bassTop; k++) low[f] += Math.hypot(re[k], im[k]);
    for (let k = bassTop + 1; k <= midTop; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (f) mid[f] += Math.max(0, m - prev[k]);
      prev[k] = m;
    }
    for (let b = 0; b < BANDS; b++) {
      const from = Math.max(1, edges[b]), to = Math.max(from + 1, edges[b + 1]);
      let p = 0;
      for (let k = from; k < to; k++) p += re[k] * re[k] + im[k] * im[k];
      const db = 10 * Math.log10(p / (to - from) + 1e-9);
      raw[f * BANDS + b] = db;
      maxBand[b] = Math.max(maxBand[b], db);
    }
  }
  const loudest = Math.max(...maxBand);
  const bands = new Float32Array(n * BANDS);
  for (let i = 0; i < bands.length; i++) {
    // каждая полоса подстраивается под свой максимум, чтобы двигались и верха
    const ceil = Math.max(maxBand[i % BANDS], loudest - 30);
    bands[i] = loudest < -60 ? 0 : Math.min(1, Math.max(0, (raw[i] - ceil + 34) / 34)) ** 1.4;
  }
  for (let i = 0; i < n; i++) level[i] /= maxLevel;
  const beat = beats(low.map((v, i) => (i ? Math.max(0, v - low[i - 1]) : 0)), mid, level);
  return { rate: FPS, n, bands, level, beat };
}

/* ---------- громкость, фрагмент, WAV ---------- */

export function fadeGain(t, from, to, fadeIn, fadeOut) {
  if (t < from || t > to) return 1;
  let k = 1;
  if (fadeIn > 0) k = Math.min(k, (t - from) / fadeIn);
  if (fadeOut > 0) k = Math.min(k, (to - t) / fadeOut);
  return Math.max(0, k);
}

// мягкий ограничитель: громкость выше 100 % не превращается в треск
const limit = (v) => {
  const a = Math.abs(v);
  return a <= 0.9 ? v : Math.sign(v) * (0.9 + 0.099 * Math.tanh((a - 0.9) / 0.099));
};

export function sliceAudio(buffer, from, to, { volume = 1, fadeIn = 0, fadeOut = 0 } = {}) {
  const rate = buffer.sampleRate;
  const a = Math.floor(from * rate);
  const n = Math.max(1, Math.min(buffer.length, Math.ceil(to * rate)) - a);
  const channels = Math.min(2, buffer.numberOfChannels);
  const out = new AudioBuffer({ length: n, numberOfChannels: channels, sampleRate: rate });
  // короткие 20 мс по краям убирают щелчки даже без затухания
  const inN = Math.min(n / 2, rate * Math.max(0.02, fadeIn));
  const outN = Math.min(n / 2, rate * Math.max(0.02, fadeOut));
  for (let c = 0; c < channels; c++) {
    const d = out.getChannelData(c);
    d.set(buffer.getChannelData(c).subarray(a, a + n));
    for (let i = 0; i < n; i++) {
      const k = Math.min(1, i / inN, (n - 1 - i) / outN);
      d[i] = volume > 1 ? limit(d[i] * volume * k) : d[i] * volume * k;
    }
  }
  return out;
}

export function toWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const n = buffer.length;
  const bytes = new ArrayBuffer(44 + n * channels * 2);
  const view = new DataView(bytes);
  const tag = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, 36 + n * channels * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); tag(36, 'data');
  view.setUint32(40, n * channels * 2, true);
  const pcm = new Int16Array(bytes, 44);
  for (let c = 0; c < channels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) pcm[i * channels + c] = Math.max(-1, Math.min(1, d[i])) * 32767;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// громкость в предпросмотре (в том числе выше 100 %)
export function createMonitor(element) {
  let ctx = null, gain = null;
  return {
    resume() {
      if (!ctx) {
        try {
          ctx = new AudioContext();
          gain = ctx.createGain();
          ctx.createMediaElementSource(element).connect(gain).connect(ctx.destination);
        } catch { ctx = null; gain = null; }
      }
      ctx?.resume();
    },
    set(value) {
      if (gain) gain.gain.value = value;
      else element.volume = Math.min(1, value);
    },
  };
}
