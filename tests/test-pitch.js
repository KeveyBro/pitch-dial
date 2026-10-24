// Tests the scoring maths, pitch detection (using synthetic voices) and instrument ranges
// without a browser.
// Usage: node tests/test-pitch.js   (or: npm test)
import fs from 'node:fs';
import * as maths from '../public/js/maths.js';
import * as pitch from '../public/js/pitch.js';
import { INSTRUMENTS, FAMILIES, pickInstrument } from '../public/js/audio.js';

const api = { ...maths, ...pitch };
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!ok) fails++; };

// --- scoring maths
const d = api.describe(440, 446.2, 200);
check('describe 440→446.2', d.hzText === '6.20 Hz too high' && d.toneText === '≈ 1/8 of a tone too high' && d.centsText === '+24.2 cents', `${d.hzText} | ${d.toneText} | ${d.centsText}`);
const fo = api.foldOctave(218.26, 110.0);
check('octave fold 218.26 vs sung 110', fo.k === -1 && fo.ref === 109.13, JSON.stringify(fo));
const fo2 = api.foldOctave(196.0, 196.5);
check('no fold in same octave', fo2.k === 0 && fo2.ref === 196, JSON.stringify(fo2));

// --- instrument families: every note in the game's 60–2000 Hz range gets a real instrument
{
  const bad = [];
  for (const [fam, parts] of Object.entries(FAMILIES)) {
    const tops = parts.map(([, top]) => top);
    if (tops.some((t, i) => i && t <= tops[i - 1]) || tops[tops.length - 1] !== Infinity) bad.push(`${fam}: bands out of order`);
    for (const [k] of parts) if (!INSTRUMENTS[k]) bad.push(`${fam}: unknown ${k}`);
  }
  for (const fam of [...Object.keys(FAMILIES), 'random'])
    for (let f = 60; f <= 2000; f *= 1.01) if (!INSTRUMENTS[pickInstrument(fam, f)]) bad.push(`${fam} at ${f.toFixed(1)} Hz`);
  check('every family covers 60–2000 Hz', !bad.length, bad.slice(0, 3).join('; '));
  const brass = [70, 150, 300, 1500].map((f) => pickInstrument('brass', f)).join(', ');
  check('brass runs tuba → trombone → horn → trumpet', brass === 'tuba, trombone, horn, trumpet', brass);
}

// --- recorded samples (public/samples, from tools/build-samples.js): every entry is usable, and no
// note in an instrument's band is more than a few semitones from a recording. Two known stretches:
// the library's lowest marimba note is F2 (87 Hz), and its highest trumpet note is C6 (1047 Hz).
if (fs.existsSync('public/samples/index.json')) {
  const idx = JSON.parse(fs.readFileSync('public/samples/index.json', 'utf8'));
  const bad = [], LIMIT = { marimba: 7, trumpet: 12 };
  for (const [k, set] of Object.entries(idx.instruments)) {
    if (!INSTRUMENTS[k]) bad.push(`${k}: not an instrument`);
    for (const s of set) {
      if (!fs.existsSync('public/samples/' + s.file)) bad.push(`${s.file}: missing`);
      if (!(s.f0 > 20 && s.loopStart < s.loopEnd && s.gain > 0 && s.gain <= 3)) bad.push(`${s.file}: bad values`);
    }
  }
  for (const parts of Object.values(FAMILIES)) {
    let lo = 60;
    for (const [k, top] of parts) {
      const set = idx.instruments[k];
      if (set) for (let f = lo; f <= Math.min(top, 2000); f *= 1.01) {
        const d = Math.min(...set.map((s) => Math.abs(12 * Math.log2(f / s.f0))));
        if (d > (LIMIT[k] || 4)) { bad.push(`${k} at ${f.toFixed(0)} Hz is ${d.toFixed(1)} semitones from a recording`); break; }
      }
      lo = top;
    }
  }
  check(`${Object.keys(idx.instruments).length} sampled instruments cover their bands`, !bad.length, bad.slice(0, 3).join('; '));
}

// --- synthetic voices
const SR = 48000;
function synth(f0, secs, { harmonics = 1, vibCents = 0, vibHz = 5.5, noise = 0, jitter = 0 } = {}) {
  const n = Math.round(SR * secs), x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * Math.pow(2, (vibCents * Math.sin(2 * Math.PI * vibHz * t) + jitter * (Math.random() - 0.5)) / 1200);
    ph += 2 * Math.PI * f / SR;
    let s = 0;
    for (let h = 1; h <= harmonics; h++) s += Math.sin(h * ph) / h * (h === 2 ? 1.4 : 1); // strong 2nd harmonic
    x[i] = 0.3 * s / Math.max(1, Math.log2(harmonics + 1)) + noise * (Math.random() * 2 - 1);
  }
  return x;
}
const frame = (x, at, N = 2048) => x.subarray(Math.round(at * SR), Math.round(at * SR) + N);
const cases = [
  ['pure sine 220 Hz', 220, {}],
  ['voice-like 110 Hz, 12 harmonics', 110, { harmonics: 12 }],
  ['voice-like 98 Hz, 12 harmonics, noise', 98, { harmonics: 12, noise: 0.02 }],
  ['voice-like 523.25 Hz, 6 harmonics', 523.25, { harmonics: 6 }],
  ['voice-like 330 Hz, vibrato ±30¢', 330, { harmonics: 8, vibCents: 30 }]
];
for (const [name, f0, opt] of cases) {
  const x = synth(f0, 1, opt);
  const p = api.yin(frame(x, 0.5), SR);
  const err = p ? api.centsBetween(p.freq, f0) : NaN;
  check(`yin ${name}`, p && Math.abs(err) < (opt.vibCents ? 40 : 5), p ? `${p.freq.toFixed(2)} Hz, ${err.toFixed(2)}¢, conf ${p.conf.toFixed(2)}` : 'no pitch');
}
const silent = api.yin(new Float32Array(2048).map(() => (Math.random() * 2 - 1) * 0.3), SR);
check('white noise gives no confident pitch', !silent || silent.conf < 0.8, silent ? `conf ${silent.conf.toFixed(2)}` : 'null');

// --- offline recording analysis: silence, a scoop up to the note, a held note with vibrato, silence
function recording(f0) {
  const parts = [new Float32Array(SR * 0.5)];
  const scoop = synth(f0 * 0.85, 0.25, { harmonics: 10 });
  parts.push(scoop, synth(f0, 2.0, { harmonics: 10, vibCents: 20, jitter: 6, noise: 0.01 }), new Float32Array(SR * 0.5));
  const n = parts.reduce((s, p) => s + p.length, 0), out = new Float32Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return { sampleRate: SR, getChannelData: () => out };
}
for (const f0 of [110, 196, 261.63, 440]) {
  const t0 = Date.now();
  const f = api.analyzeRecording(recording(f0));
  const err = f ? api.centsBetween(f, f0) : NaN;
  check(`recording held at ${f0} Hz`, f && Math.abs(err) < 5, f ? `${f.toFixed(2)} Hz, ${err.toFixed(2)}¢, ${Date.now() - t0} ms` : 'no note found');
}
check('recording of silence finds no note', api.analyzeRecording({ sampleRate: SR, getChannelData: () => new Float32Array(SR * 2) }) === null);

// --- live tracker: frames every 30 ms, held note locks after ~1.2 s of steadiness
{
  const tr = api.makeTracker();
  const x = synth(247, 3, { harmonics: 10, vibCents: 25, noise: 0.01 });
  let lockedAt = null, val = null;
  for (let t = 0; t + 2048 / SR < 3; t += 0.03) {
    const p = api.yin(frame(x, t), SR);
    const st = tr.push(t, p && p.conf > 0.8 ? p.freq : null);
    if (st.done) { lockedAt = t; val = tr.current(); break; }
  }
  check('live tracker locks a held 247 Hz note', lockedAt !== null && Math.abs(api.centsBetween(val, 247)) < 5, lockedAt !== null ? `locked at ${lockedAt.toFixed(2)} s, ${val.toFixed(2)} Hz` : 'never locked');
}
{
  const tr = api.makeTracker();
  let done = false;
  for (let t = 0; t < 3; t += 0.03) { const f = 200 * Math.pow(2, (t * 400) / 1200); done = tr.push(t, f).done || done; } // sliding pitch
  check('live tracker does not lock on a slide', !done);
}
console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
