// Audio out: one shared AudioContext and master gain. playTone handles one-shot tones;
// startTuner / setTunerFreq / setTunerOn / stopTuner handle the dial's continuous tone.
let actx = null, master = null, tuner = null;
let volume = 0.45;
const shots = new Set();
const volGain = () => 0.5 * volume * volume;

export const audioContext = () => actx;

export function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { actx = new AC(); } catch (e) { return false; }
    master = actx.createGain();
    master.gain.value = volGain();
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return true;
}
// v is 0–1
export function setVolume(v) {
  volume = v;
  if (master) master.gain.setTargetAtTime(volGain(), actx.currentTime, 0.02);
}
export function playTone(freq, dur, delay = 0) {
  if (!ensureAudio()) return;
  const t0 = actx.currentTime + 0.03 + delay;
  const o = actx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 0.03);
  g.gain.setValueAtTime(1, t0 + Math.max(0.04, dur - 0.06));
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
  const shot = { o, g };
  shots.add(shot);
  o.onended = () => { shots.delete(shot); try { g.disconnect(); } catch (e) {} };
}
export function stopShots() {
  if (!actx) return;
  const now = actx.currentTime;
  shots.forEach(({ o, g }) => {
    try { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.01); o.stop(now + 0.08); } catch (e) {}
  });
  shots.clear();
}
export function startTuner(freq, on) {
  if (!ensureAudio()) return;
  stopTuner();
  const o = actx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = actx.createGain();
  g.gain.value = 0;
  o.connect(g); g.connect(master);
  o.start();
  g.gain.setTargetAtTime(on ? 1 : 0, actx.currentTime, 0.03);
  tuner = { o, g };
}
export function setTunerFreq(f) { if (tuner) tuner.o.frequency.setTargetAtTime(f, actx.currentTime, 0.012); }
export function setTunerOn(on) { if (tuner) tuner.g.gain.setTargetAtTime(on ? 1 : 0, actx.currentTime, 0.03); }
export function stopTuner() {
  if (!tuner) return;
  const { o, g } = tuner;
  tuner = null;
  try {
    const now = actx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0, now, 0.02);
    o.stop(now + 0.15);
    o.onended = () => { try { g.disconnect(); } catch (e) {} };
  } catch (e) {}
}
