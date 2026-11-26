// Сборка видеофайла. Основной путь — WebCodecs (покадрово, без пропусков),
// запасной — запись экрана плеера в реальном времени через MediaRecorder.
import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  canEncodeAudio, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { sliceAudio } from './audio.js';

let aacRegistered = false;

function chunk(buffer, start, length) {
  const n = Math.min(length, buffer.length - start);
  const out = new AudioBuffer({ length: n, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(start, start + n), c);
  }
  return out;
}

const breathe = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

export async function exportVideo(opts) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined' && typeof AudioData === 'undefined') {
    return recordRealtime(opts);
  }
  const { width, height } = opts.renderer;
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height, bitrate: 10e6 });
  if (!codec || typeof AudioData === 'undefined') return recordRealtime(opts);
  return encode(opts, codec);
}

async function encode({ renderer, buffer, from, to, fps, sound: mixing, onProgress, signal }, codec) {
  const audio = sliceAudio(buffer, from, to, mixing);
  const params = { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate, bitrate: 192e3 };
  if (!aacRegistered && !(await canEncodeAudio('aac', params))) {
    registerAacEncoder();
    aacRegistered = true;
  }
  const canvas = document.createElement('canvas');
  canvas.width = renderer.width;
  canvas.height = renderer.height;
  const g = canvas.getContext('2d', { alpha: false });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec, bitrate: fps > 30 ? 14e6 : 10e6, keyFrameInterval: 2 });
  const track = new AudioBufferSource({ codec: 'aac', bitrate: 192e3 });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(track);
  try {
    await output.start();
    const frames = Math.max(1, Math.round(audio.duration * fps));
    let fed = 0;
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('cancel', 'AbortError');
      // звук подаём порциями по секунде, чуть опережая видео
      while (fed < audio.length && fed / audio.sampleRate <= i / fps + 0.5) {
        await track.add(chunk(audio, fed, audio.sampleRate));
        fed += audio.sampleRate;
      }
      const t = from + i / fps;
      await renderer.prepare(t);
      renderer.draw(g, t);
      const mix = renderer.loopMix(t);
      if (mix) {
        await renderer.prepare(mix.at);
        renderer.drawMix(g, mix);
      }
      await video.add(i / fps, 1 / fps);
      if (i % 6 === 0) { onProgress(i / frames, canvas); await breathe(); }
    }
    while (fed < audio.length) { await track.add(chunk(audio, fed, audio.sampleRate)); fed += audio.sampleRate; }
    onProgress(1, canvas);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  return {
    blob: new Blob([output.target.buffer], { type: 'video/mp4' }),
    ext: 'mp4',
    note: codec === 'avc' ? '' : 'В этом браузере нет кодека H.264 — файл сохранён в другом формате. Если TikTok его не примет, сделайте экспорт в Google Chrome.',
  };
}

async function recordRealtime({ renderer, buffer, from, to, fps, sound, onProgress, signal }) {
  if (typeof MediaRecorder === 'undefined') throw new Error('Этот браузер не умеет записывать видео. Откройте плеер в Google Chrome.');
  const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    .find((t) => MediaRecorder.isTypeSupported(t));
  const canvas = document.createElement('canvas');
  canvas.width = renderer.width;
  canvas.height = renderer.height;
  const g = canvas.getContext('2d', { alpha: false });
  renderer.draw(g, from);
  const ac = new AudioContext();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = sliceAudio(buffer, from, to, sound);
  src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getTracks(), ...dest.stream.getTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6, audioBitsPerSecond: 192e3 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => { rec.onstop = r; });
  rec.start(500);
  const t0 = ac.currentTime + 0.05;
  src.start(t0);
  if (renderer.cardMedia?.play) renderer.cardMedia.play().catch(() => {});
  const len = src.buffer.duration;
  await new Promise((resolve) => {
    const tick = () => {
      const t = Math.max(0, ac.currentTime - t0);
      const at = from + Math.min(t, len);
      renderer.draw(g, at);
      const mix = renderer.loopMix(at);
      if (mix) renderer.drawMix(g, mix);
      onProgress(Math.min(1, t / len), canvas);
      if (signal.aborted || t >= len) resolve(); else requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((tr) => tr.stop());
  await ac.close();
  if (signal.aborted) throw new DOMException('cancel', 'AbortError');
  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  return {
    blob: new Blob(parts, { type: type.split(';')[0] }),
    ext,
    note: `Записано в реальном времени.${ext === 'webm' ? ' Формат WebM: для TikTok лучше сделать экспорт в Google Chrome.' : ''}`,
  };
}
