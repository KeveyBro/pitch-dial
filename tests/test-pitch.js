// Tests the scoring maths, pitch detection (using synthetic voices) and instrument ranges
// without a browser.
// Usage: node tests/test-pitch.js   (or: npm test)
import fs from 'node:fs';
import * as maths from '../public/js/maths.js';
import * as pitch from '../public/js/pitch.js';
import { INSTRUMENTS, FAMILIES, pickInstrument } from '../public/js/audio.js';
import { normalizeGame, binOf, binEdges, BIN_COUNT, fractionBelow, quantile, seedAverages, seedBins, comparisonFor, SEED_UNTIL } from '../public/js/community.js';
import { seedSql } from '../tools/make-seed.js';

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

// --- community results: the server's checks and rescoring (public/js/community.js)
{
  const base = { v: 1, mode: 'dial', input: null, family: 'brass', listen: 'easy', time: 30, range: 'mid', fold: false,
    rounds: [[440, 446.2, 'trumpet'], [200, 198, 'horn'], [300, 301, 'horn'], [500, 505, 'trumpet'], [170, 169, 'trombone'], [250, null, 'horn']] };
  const g = normalizeGame(base);
  const expect = [[440, 446.2], [200, 198], [300, 301], [500, 505], [170, 169]].map(([t, y]) => 1200 * Math.log2(y / t));
  const avg = expect.reduce((s, c) => s + Math.abs(c), 0) / expect.length;
  check('a valid game is rescored by the server', g.ok && g.game.scored === 5 && g.game.missed === 1 && Math.abs(g.game.avgCents - avg) < 0.006 && g.game.rounds[0][3] === 24.22,
    g.ok ? `avg ${g.game.avgCents}¢ (expected ${avg.toFixed(3)}), first round ${g.game.rounds[0][3]}¢` : g.error);
  const bad = {
    'bad mode': { mode: 'piano' },
    'instrument outside the family': { rounds: [[440, 446.2, 'violin'], ...base.rounds.slice(1)] },
    'target outside the range': { rounds: [[5000, 446.2, 'trumpet'], ...base.rounds.slice(1)] },
    'dial answer outside the range': { rounds: [[440, 950, 'trumpet'], ...base.rounds.slice(1)] },
    'octave folding in dial mode': { fold: true },
    'too few scored rounds': { rounds: base.rounds.slice(0, 4) },
    'too many rounds': { rounds: Array(21).fill([440, 441, 'trumpet']) },
    'unknown format': { v: 2 }
  };
  const missed = Object.entries(bad).filter(([, change]) => normalizeGame({ ...base, ...change }).ok).map(([name]) => name);
  check('the server rejects implausible games', !missed.length, missed.length ? 'accepted: ' + missed.join(', ') : `${Object.keys(bad).length} kinds rejected`);
  const sung = normalizeGame({ ...base, mode: 'sing', input: 'live', family: 'sine', range: 'low', fold: true,
    rounds: [[220, 111, 'sine'], [150, 151, 'sine'], [200, 199, 'sine'], [250, 249, 'sine'], [180, 181, 'sine']] });
  check('octave folding scores a note sung an octave down', sung.ok && Math.abs(sung.game.rounds[0][3] - 1200 * Math.log2(111 / 110)) < 0.01,
    sung.ok ? `${sung.game.rounds[0][3]}¢` : sung.error);
}
// --- community results: the histogram behind the stats
{
  let ok = true;
  for (let c = 0; c < 3000; c += 0.37) { const [a, b] = binEdges(binOf(c)); if (!(c >= a && (c < b || binOf(c) === BIN_COUNT - 1))) ok = false; }
  for (let i = 1; i < BIN_COUNT; i++) if (binEdges(i)[0] !== binEdges(i - 1)[1]) ok = false;
  check('every average falls in its own bin, and the bins tile 0–2400¢', ok);
  const bins = new Array(BIN_COUNT).fill(0);
  for (let k = 0; k < 2000; k++) bins[binOf(5 + 20 * (k + 0.5) / 2000)]++;   // averages spread evenly over 5–25¢
  const med = quantile(0.5, bins), below10 = fractionBelow(10, bins);
  check('median and percentile from the histogram', Math.abs(med - 15) < 0.3 && Math.abs(below10 - 0.25) < 0.01, `median ${med.toFixed(2)}¢, ${(below10 * 100).toFixed(1)}% below 10¢`);
}

// --- community results: the research seed matches its studies, and is labelled and retired
{
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y), i = p * (s.length - 1), k = Math.floor(i); return s[k] + (s[Math.min(k + 1, s.length - 1)] - s[k]) * (i - k); };
  const d = seedAverages('dial'), s = seedAverages('sing');
  const near = (x, want, tol) => Math.abs(x - want) <= tol;
  check('dial seed follows 918 adults (5% 6.2¢, median 14.5¢, 95% 77.4¢)', d.length === 50 && near(pct(d, 0.05), 6.2, 0.6) && near(pct(d, 0.5), 14.5, 0.3) && near(pct(d, 0.95), 77.4, 8),
    `${pct(d, 0.05).toFixed(1)} / ${pct(d, 0.5).toFixed(1)} / ${pct(d, 0.95).toFixed(1)}¢`);
  check('singing seed follows 50 untrained singers (median 87.8¢, range 2.3–522.1¢)', s.length === 50 && near(pct(s, 0.5), 87.8, 0.3) && Math.min(...s) >= 2.3 && Math.max(...s) <= 522.1,
    `median ${pct(s, 0.5).toFixed(1)}¢, ${s.filter((c) => c > 100).length} of 50 over a semitone`);
  check('the seed migration is up to date with tools/make-seed.js', fs.readFileSync('migrations/0002_research_seed.sql', 'utf8') === seedSql());
  const zero = new Array(BIN_COUNT).fill(0), research = { n: 50, bins: seedBins('dial') };
  const early = comparisonFor({ modes: { dial: { n: 12, bins: zero }, 'dial:research': research } }, 'dial');
  const later = comparisonFor({ modes: { dial: { n: SEED_UNTIL, bins: zero }, 'dial:research': research } }, 'dial');
  check(`research games are pooled until ${SEED_UNTIL} real games, then dropped`, early.n === 62 && early.research === 50 && later.n === SEED_UNTIL && later.research === 0);
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
