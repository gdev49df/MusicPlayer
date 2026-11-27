// Настоящая форма волны текущей песни: по ней удобно перематывать.

const BINS = 160;
const cache = new Map();

export function peaks(id, seconds) {
  if (cache.has(id)) return cache.get(id);
  // очень длинные записи не разбираем: это заняло бы слишком много памяти
  if (seconds > 1200) return Promise.resolve(null);
  const job = (async () => {
    const data = await (await fetch(`media://track/${id}`)).arrayBuffer();
    // низкая частота: для рисунка хватает, а памяти нужно в разы меньше
    const sound = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(data);
    const samples = sound.getChannelData(0);
    const step = Math.max(1, Math.floor(samples.length / BINS));
    const out = Array.from({ length: BINS }, (_, i) => {
      let sum = 0;
      for (let k = i * step; k < (i + 1) * step && k < samples.length; k++) sum += samples[k] * samples[k];
      return Math.sqrt(sum / step);
    });
    const max = Math.max(...out) || 1;
    // степень выделяет разницу между тихими и громкими местами
    return out.map((v) => (v / max) ** 1.6);
  })().catch(() => null);
  cache.set(id, job);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return job;
}

export function draw(canvas, data, progress) {
  const { clientWidth: w, clientHeight: height } = canvas;
  if (!w || !height) return;
  const scale = devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(height * scale);
  }
  const g = canvas.getContext('2d');
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, w, height);
  const style = getComputedStyle(canvas);
  const played = style.getPropertyValue('--played');
  const rest = style.getPropertyValue('--rest');
  const count = Math.max(1, Math.floor((w + 2) / 5));
  const gap = (w - count * 3) / Math.max(1, count - 1);
  for (let i = 0; i < count; i++) {
    let v = 0.12;
    if (data) {
      const from = Math.floor((i * data.length) / count);
      const to = Math.max(from + 1, Math.floor(((i + 1) * data.length) / count));
      v = Math.max(...data.slice(from, to));
    }
    const size = Math.max(3, v * height);
    g.fillStyle = (i + 0.5) / count <= progress ? played : rest;
    g.beginPath();
    g.roundRect(i * (3 + gap), (height - size) / 2, 3, size, 1.5);
    g.fill();
  }
}
