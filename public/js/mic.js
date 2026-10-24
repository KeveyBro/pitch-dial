// Microphone input. Echo cancellation, noise suppression and AGC are off so the pitch isn't
// processed. The analyser feeds a zero-gain sink so the graph keeps pulling samples through it.
import { audioContext } from './audio.js';

let mic = null;

export const micOpen = () => !!mic;

// Resolves true once the mic is live, false if it's refused, missing, or the prompt is
// left unanswered for 20 s. getUserMedia needs a secure context (https or localhost).
export function openMic() {
  if (mic) return Promise.resolve(true);
  const actx = audioContext();
  if (!actx || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; resolve(false); }, 20000);
    let req;
    try {
      req = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { clearTimeout(timer); resolve(false); return; }
    req.then((stream) => {
      if (settled) { stream.getTracks().forEach((t) => t.stop()); return; }
      clearTimeout(timer); settled = true;
      try {
        const src = actx.createMediaStreamSource(stream);
        const an = actx.createAnalyser();
        an.fftSize = actx.sampleRate > 50000 ? 4096 : 2048;
        const sink = actx.createGain();
        sink.gain.value = 0;
        src.connect(an); an.connect(sink); sink.connect(actx.destination);
        mic = { stream, src, an, sink, buf: new Float32Array(an.fftSize) };
        resolve(true);
      } catch (e) { stream.getTracks().forEach((t) => t.stop()); resolve(false); }
    }, () => { if (!settled) { clearTimeout(timer); settled = true; resolve(false); } });
  });
}
// The latest frame of samples, or null when the mic isn't open. The buffer is reused.
export function readMic() {
  if (!mic) return null;
  mic.an.getFloatTimeDomainData(mic.buf);
  return mic.buf;
}
export function closeMic() {
  if (!mic) return;
  try { mic.stream.getTracks().forEach((t) => t.stop()); mic.src.disconnect(); mic.an.disconnect(); mic.sink.disconnect(); } catch (e) {}
  mic = null;
}
