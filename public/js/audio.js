// Audio out: one shared AudioContext and master gain. playTone handles one-shot tones;
// startTuner / setTunerFreq / setTunerOn / stopTuner handle the dial's continuous tone.
// Both take an instrument key from INSTRUMENTS (pickInstrument chooses one for a note).
let actx = null, master = null, tuner = null;
let volume = 0.45;
const shots = new Set();
const volGain = () => 0.5 * volume * volume;

// Instruments. `harmonics` are the strengths of overtones 1, 2, 3… and become a PeriodicWave, so
// every instrument repeats at the fundamental and is heard at exactly the target pitch.
// `formants` are fixed [Hz, level, Q] resonances (sung "ah"), mixed with `direct` raw wave.
// `attack` is in seconds; `decay` lets a struck tone fall from its strike to a sustain level
// ({ to: fraction of the peak, tau: seconds }), so it still rings for the whole listen time.
// `gain` evens out loudness, measured in Chromium across each instrument's band: steady tones sit
// 1.5 dB under the sine's RMS at the same pitch (overtones sound louder than their RMS), struck
// tones sustain 5 dB under it, and no gain lets the peak pass 0.95 at full volume.
const saw = (n) => Array.from({ length: n }, (_, i) => 1 / (i + 1));
export const INSTRUMENTS = {
  sine:         { name: 'Sine', harmonics: [1], gain: 1, attack: 0.03 },
  piano:        { name: 'Piano', harmonics: [1, 0.55, 0.32, 0.26, 0.16, 0.11, 0.07, 0.05, 0.03, 0.02], gain: 1.77, attack: 0.006, decay: { to: 0.4, tau: 0.35 } },
  doubleBass:   { name: 'Double bass', harmonics: [0.7, 1, 0.6, 0.45, 0.3, 0.2, 0.14, 0.1, 0.07], gain: 1.38, attack: 0.1 },
  cello:        { name: 'Cello', harmonics: [1, 0.8, 0.55, 0.45, 0.35, 0.25, 0.18, 0.13, 0.1, 0.08, 0.06], gain: 1.35, attack: 0.09 },
  viola:        { name: 'Viola', harmonics: [1, 0.75, 0.5, 0.4, 0.3, 0.22, 0.16, 0.12, 0.09, 0.07], gain: 1.3, attack: 0.08 },
  violin:       { name: 'Violin', harmonics: [1, 0.7, 0.55, 0.5, 0.45, 0.35, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12, 0.1, 0.08], gain: 1.58, attack: 0.07 },
  bassoon:      { name: 'Bassoon', harmonics: [0.7, 1, 0.8, 0.7, 0.5, 0.35, 0.25, 0.18, 0.12, 0.08], gain: 1.57, attack: 0.05 },
  clarinet:     { name: 'Clarinet', harmonics: [1, 0.04, 0.75, 0.03, 0.5, 0.02, 0.35, 0.01, 0.2, 0, 0.12], gain: 1.11, attack: 0.05 },
  oboe:         { name: 'Oboe', harmonics: [0.6, 1, 0.9, 0.7, 0.55, 0.4, 0.3, 0.2, 0.14, 0.1], gain: 1.62, attack: 0.04 },
  flute:        { name: 'Flute', harmonics: [1, 0.35, 0.15, 0.08, 0.04], gain: 0.89, attack: 0.06 },
  tuba:         { name: 'Tuba', harmonics: [1, 0.7, 0.4, 0.25, 0.15, 0.09, 0.05], gain: 1.14, attack: 0.06 },
  trombone:     { name: 'Trombone', harmonics: [0.9, 1, 0.8, 0.65, 0.5, 0.38, 0.28, 0.2, 0.14, 0.1], gain: 1.55, attack: 0.05 },
  horn:         { name: 'French horn', harmonics: [1, 0.6, 0.35, 0.2, 0.12, 0.07, 0.04], gain: 1.07, attack: 0.06 },
  trumpet:      { name: 'Trumpet', harmonics: [0.8, 1, 0.9, 0.75, 0.6, 0.5, 0.4, 0.3, 0.22, 0.16, 0.12, 0.09], gain: 1.68, attack: 0.04 },
  bass:         { name: 'Bass voice', harmonics: saw(40), formants: [[600, 1, 8], [1040, 0.45, 10], [2250, 0.35, 14]], direct: 0.12, gain: 5.43, attack: 0.08 },
  tenor:        { name: 'Tenor voice', harmonics: saw(40), formants: [[650, 1, 7], [1080, 0.5, 9], [2650, 0.45, 14]], direct: 0.12, gain: 4.52, attack: 0.08 },
  alto:         { name: 'Alto voice', harmonics: saw(40), formants: [[800, 1, 5], [1150, 0.63, 6], [2800, 0.1, 10]], direct: 0.18, gain: 2.75, attack: 0.08 },
  soprano:      { name: 'Soprano voice', harmonics: saw(40), formants: [[800, 1, 4], [1150, 0.5, 5], [2900, 0.03, 9]], direct: 0.25, gain: 2.11, attack: 0.08 },
  marimba:      { name: 'Marimba', harmonics: [1, 0, 0, 0.35, 0, 0, 0, 0, 0, 0.1], gain: 1.1, attack: 0.004, decay: { to: 0.65, tau: 0.8 } },
  xylophone:    { name: 'Xylophone', harmonics: [1, 0, 0.4, 0, 0, 0.15], gain: 0.91, attack: 0.003, decay: { to: 0.65, tau: 0.6 } },
  glockenspiel: { name: 'Glockenspiel', harmonics: [1, 0.1, 0.25, 0, 0.08], gain: 0.77, attack: 0.002, decay: { to: 0.65, tau: 1 } }
};

// Families, each listed low to high as [instrument, top of its band in Hz]. A note is played by
// the first instrument whose band it falls below, so every family covers the game's 60–2000 Hz.
// The band edges are notes (G2 = 98 Hz, etc.) inside each instrument's real range.
export const FAMILIES = {
  sine:       [['sine', Infinity]],
  keyboard:   [['piano', Infinity]],
  strings:    [['doubleBass', 98], ['cello', 220], ['viola', 392], ['violin', Infinity]],
  woodwinds:  [['bassoon', 164.81], ['clarinet', 392], ['oboe', 783.99], ['flute', Infinity]],
  brass:      [['tuba', 98], ['trombone', 196], ['horn', 392], ['trumpet', Infinity]],
  voices:     [['bass', 146.83], ['tenor', 261.63], ['alto', 440], ['soprano', Infinity]],
  percussion: [['marimba', 523.25], ['xylophone', 1046.5], ['glockenspiel', Infinity]]
};
// "random" picks one of the instrument families (not the plain sine) for each note
export const RANDOM_FAMILIES = Object.keys(FAMILIES).filter((k) => k !== 'sine');
export function pickInstrument(family, freq) {
  if (family === 'random') family = RANDOM_FAMILIES[Math.floor(Math.random() * RANDOM_FAMILIES.length)];
  const parts = FAMILIES[family] || FAMILIES.sine;
  return parts.find(([, top]) => freq < top)[0];
}
const holdLevel = (t) => t.gain * (t.decay ? t.decay.to : 1);

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

// Builds one note of an instrument in any context (an OfflineAudioContext works too) and connects
// it to dest. The caller drives `env.gain` (it starts at 0), calls start/stop, then dispose().
const waves = new WeakMap();
function wave(ctx, key, coeffs) {
  if (!waves.has(ctx)) waves.set(ctx, {});
  const cache = waves.get(ctx);
  if (!cache[key]) {
    const imag = new Float32Array([0, ...coeffs]);
    cache[key] = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  }
  return cache[key];
}
export function buildNote(ctx, key, freq, dest) {
  const t = INSTRUMENTS[key] || INSTRUMENTS.sine;
  const o = ctx.createOscillator();
  if (t.harmonics.length === 1) o.type = 'sine';
  else o.setPeriodicWave(wave(ctx, key, t.harmonics));
  o.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.value = 0;
  const nodes = [env];
  if (t.formants) {
    const direct = ctx.createGain();       // a little of the raw wave keeps the fundamental clear
    direct.gain.value = t.direct;
    o.connect(direct); direct.connect(env); nodes.push(direct);
    for (const [f, level, q] of t.formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(bp); bp.connect(g); g.connect(env); nodes.push(bp, g);
    }
  } else o.connect(env);
  env.connect(dest);
  return {
    o, env, t,
    start: (at) => o.start(at),
    stop: (at) => { try { o.stop(at); } catch (e) {} },
    dispose: () => nodes.forEach((n) => { try { n.disconnect(); } catch (e) {} })
  };
}

export function playTone(freq, dur, delay = 0, inst = 'sine') {
  if (!ensureAudio()) return;
  const v = buildNote(actx, inst, freq, master);
  const { env, t } = v;
  const t0 = actx.currentTime + 0.03 + delay;
  const end = t0 + Math.max(dur, t.attack + 0.06);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(t.gain, t0 + t.attack);
  if (t.decay) env.gain.setTargetAtTime(t.gain * t.decay.to, t0 + t.attack, t.decay.tau);
  env.gain.setTargetAtTime(0, end - 0.05, 0.015);
  v.start(t0); v.stop(end + 0.1);
  shots.add(v);
  v.o.onended = () => { shots.delete(v); v.dispose(); };
}
export function stopShots() {
  if (!actx) return;
  const now = actx.currentTime;
  shots.forEach((v) => {
    try { v.env.gain.cancelScheduledValues(now); v.env.gain.setTargetAtTime(0, now, 0.01); } catch (e) {}
    v.stop(now + 0.08);
  });
  shots.clear();
}
export function startTuner(freq, on, inst = 'sine') {
  if (!ensureAudio()) return;
  stopTuner();
  const v = buildNote(actx, inst, freq, master);
  const { env, t } = v;
  v.start();
  if (on) {
    const now = actx.currentTime, att = Math.max(t.attack, 0.03);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(t.gain, now + att);
    env.gain.setTargetAtTime(holdLevel(t), now + att, t.decay ? t.decay.tau : 0.03);
  }
  tuner = v;
}
export function setTunerFreq(f) { if (tuner) tuner.o.frequency.setTargetAtTime(f, actx.currentTime, 0.012); }
export function setTunerOn(on) { if (tuner) tuner.env.gain.setTargetAtTime(on ? holdLevel(tuner.t) : 0, actx.currentTime, 0.03); }
export function stopTuner() {
  if (!tuner) return;
  const v = tuner;
  tuner = null;
  try {
    const now = actx.currentTime;
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setTargetAtTime(0, now, 0.02);
  } catch (e) {}
  v.stop(actx.currentTime + 0.15);
  v.o.onended = v.dispose;
}
