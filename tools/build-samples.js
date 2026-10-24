// Builds public/samples/ from VSCO 2 Community Edition (Versilian Studios, CC0 public domain).
// It downloads the chosen sustained-note recordings into a cache outside the project, measures each
// one's real pitch with the game's own YIN detector (the library's note names are often an octave
// off; the glockenspiel is then refined by its spectral peak), then trims it, resamples it to 22.05 kHz mono, flattens and crossfades a loop so the note can
// sustain for as long as needed, and writes small 16-bit WAVs plus public/samples/index.json.
// Usage: node tools/build-samples.js [cacheDir]     (default cache: <OS temp>/pitch-dial-vsco)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { yin, medianOf } from '../public/js/pitch.js';
import { FAMILIES } from '../public/js/audio.js';

const REPO = 'sgossner/VSCO-2-CE';
const SHA = '440300901dfe9275fd84e0b7763af1f8443ae62e';   // pinned, so a rebuild uses the same recordings
const OUT = path.join('public', 'samples');
const CACHE = process.argv[2] || path.join(os.tmpdir(), 'pitch-dial-vsco');
const SR = 22050;

// [instrument, folder in the library, which recordings to use (one dynamic level), struck?,
//  optionally the measured-pitch range this folder covers, when an instrument draws on two]
const SOURCES = [
  ['piano', 'Keys/Upright Nr1', /_mf_RR1/, true],
  ['doubleBass', 'Strings/Solo Contrabass/SusNV', /_v3_/, false],
  ['cello', 'Strings/Cello Section/susvib', /_v3_1/, false],
  ['viola', 'Strings/Viola Section/susvib', /_v2_/, false],
  // the violin section's players' vibratos blend into a much steadier pitch than the solo
  // violin's (which wandered up to 16¢), but the section stops at D6, so the solo covers the top
  ['violin', 'Strings/Violin Section/susVib', /_v2\.wav/, false, [0, 1200]],
  ['violin', 'Strings/Solo Violin/Arco Vib', /_f\.wav/, false, [1200, Infinity]],
  ['bassoon', 'Woodwinds/Bassoon/sus', /_v2_/, false],
  ['clarinet', 'Woodwinds/Clarinet/susLong', /_v2_/, false],
  ['oboe', 'Woodwinds/Oboe/Sus', /_v3_/, false],
  ['flute', 'Woodwinds/Flute/susNV', /_v1_/, false],
  ['tuba', 'Brass/Tuba/sus', /_v2_|F0_v1|D3_v1/, false],
  ['trombone', 'Brass/Tenor Trombone/sus', /_v2_/, false],
  ['horn', 'Brass/F Horn/sus', /_v2_|A0_v1|D4_v1|F4_v1/, false],
  ['trumpet', 'Brass/Trumpet/sus', /_v1_/, false],
  ['marimba', 'Percussion/Marimba', /./, true],
  ['xylophone', 'Percussion/Xylo', /./, true],
  ['glockenspiel', 'Percussion/Glock', /./, true]
];

// Each instrument's band in the game, from FAMILIES (60–2000 Hz overall).
const BANDS = {};
for (const parts of Object.values(FAMILIES)) {
  let lo = 60;
  for (const [k, top] of parts) { BANDS[k] = [lo, Math.min(top, 2000)]; lo = top; }
}

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const NAMES = Object.keys(NOTE);
const hz = (name, oct) => 440 * Math.pow(2, (NOTE[name] + 12 * (oct + 1) - 69) / 12);
const label = (file) => { const m = path.basename(file).match(/(?:^|_)([A-G]#?)(\d)(?=_|\.)/); return m && { name: m[1], oct: +m[2] }; };
const noteOf = (f) => { const m = Math.round(69 + 12 * Math.log2(f / 440)); return NAMES[m % 12] + (Math.floor(m / 12) - 1); };
const cents = (a, b) => 1200 * Math.log2(a / b);
const MARGIN = Math.pow(2, 5 / 12);                     // download notes up to 5 semitones past a band

/* ---------- download ---------- */
async function listFiles() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${SHA}?recursive=1`, { headers: { 'User-Agent': 'pitch-dial-build' } });
  if (!res.ok) throw new Error(`GitHub tree request failed: ${res.status}`);
  const blobs = (await res.json()).tree.filter((x) => x.type === 'blob' && /\.wav$/i.test(x.path));
  const out = [];
  for (const [inst, dir, dyn, struck, range = [0, Infinity]] of SOURCES) {
    const lo = Math.max(BANDS[inst][0], range[0]), hi = Math.min(BANDS[inst][1], range[1]);
    for (const b of blobs) {
      if (!b.path.startsWith(dir + '/') || !dyn.test(b.path)) continue;
      const l = label(b.path);
      // the names may be an octave low, so keep a file if either reading lands near the band
      if (l && ![0, 1].some((o) => { const f = hz(l.name, l.oct + o); return f >= lo / MARGIN && f <= hi * MARGIN; })) continue;
      out.push({ inst, struck, range, path: b.path, size: b.size, label: l });
    }
  }
  return out;
}
async function download(files) {
  let done = 0, bytes = 0;
  const queue = files.slice();
  const worker = async () => {
    for (let f; (f = queue.shift());) {
      const local = path.join(CACHE, ...f.path.split('/'));
      if (!(fs.existsSync(local) && fs.statSync(local).size === f.size)) {
        const url = `https://raw.githubusercontent.com/${REPO}/${SHA}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} for ${f.path}`);
        fs.mkdirSync(path.dirname(local), { recursive: true });
        fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
      }
      f.local = local;
      bytes += f.size;
      process.stdout.write(`\rDownloaded ${++done}/${files.length} (${(bytes / 1048576).toFixed(0)} MB)`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  process.stdout.write('\n');
}

/* ---------- WAV in and out ---------- */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
      if (fmt.format === 0xFFFE) fmt.format = buf.readUInt16LE(p + 32);   // WAVE_FORMAT_EXTENSIBLE sub-format
    }
    if (id === 'data') { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + len)); break; }
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('WAV has no fmt or data chunk');
  const { ch, bits, format } = fmt, bps = bits / 8, n = Math.floor(data.length / (bps * ch));
  const read = format === 3 ? (o) => (bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o))
    : bits === 16 ? (o) => data.readInt16LE(o) / 32768
    : bits === 24 ? (o) => data.readIntLE(o, 3) / 8388608
    : bits === 32 ? (o) => data.readInt32LE(o) / 2147483648
    : (o) => (data[o] - 128) / 128;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += read((i * ch + c) * bps);
    x[i] = s / ch;
  }
  return { sr: fmt.sr, x };
}
function writeWav(file, x, sr) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/* ---------- signal helpers ---------- */
// windowed-sinc (Blackman) resampler, low-passed just under the new Nyquist frequency
function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const ratio = to / from, n = Math.floor(x.length * ratio), out = new Float32Array(n);
  const cut = Math.min(1, ratio) * 0.95, width = 24 / cut;
  for (let i = 0; i < n; i++) {
    const c = i / ratio;
    let s = 0, wsum = 0;
    for (let j = Math.max(0, Math.ceil(c - width)); j <= Math.min(x.length - 1, Math.floor(c + width)); j++) {
      const t = j - c, d = t * cut;
      const k = (d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d)) * (0.42 + 0.5 * Math.cos(Math.PI * t / width) + 0.08 * Math.cos(2 * Math.PI * t / width));
      s += x[j] * k; wsum += k;
    }
    out[i] = wsum ? s / wsum : 0;
  }
  return out;
}
// RMS envelope over a centred window, one value per sample
function envelope(x, sr, win = 0.03) {
  const h = Math.max(1, Math.round(sr * win / 2)), env = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < Math.min(x.length, h); i++) acc += x[i] * x[i];
  for (let i = 0; i < x.length; i++) {
    if (i + h < x.length) acc += x[i + h] * x[i + h];
    if (i - h - 1 >= 0) acc -= x[i - h - 1] * x[i - h - 1];
    const n = Math.min(x.length - 1, i + h) - Math.max(0, i - h) + 1;
    env[i] = Math.sqrt(Math.max(0, acc) / n);
  }
  return env;
}
// Average period over K cycles near `at`, for sub-cent precision once YIN has found the octave
function refine(x, sr, at, f) {
  const K = Math.max(1, Math.round(0.025 * f)), t0 = K * sr / f, W = Math.max(1024, Math.ceil(2 * sr / f));
  const lo = Math.floor(t0 * 0.985), hi = Math.ceil(t0 * 1.015);
  if (at + W + hi + 1 >= x.length) return f;
  const d = (tau) => { let s = 0; for (let i = at; i < at + W; i++) { const v = x[i] - x[i + tau]; s += v * v; } return s; };
  let best = lo, bv = Infinity;
  for (let tau = lo; tau <= hi; tau++) { const v = d(tau); if (v < bv) { bv = v; best = tau; } }
  const a = d(best - 1), b = bv, c = d(best + 1), den = a + c - 2 * b;
  const tau = best + (den > 0 ? Math.max(-1, Math.min(1, (a - c) / (2 * den))) : 0);
  return K * sr / tau;
}
// Glockenspiel bars ring with far-from-harmonic overtones (about ×2.8 and ×5.4) that bias
// period-based estimates by up to 17¢, so their pitch is read from the fundamental's spectral peak
// (Hann window, interpolated on dB). Piano overtones are only slightly stretched, and what we hear
// follows the waveform's period, so piano (like marimba and xylophone, whose overtones are tuned)
// keeps the YIN estimate; the peak method would put low piano notes up to 9¢ flat.
const SPECTRAL = new Set(['glockenspiel']);
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, half = len / 2;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const c = Math.cos(ang * k), s = Math.sin(ang * k), p = i + k, q = p + half;
      const xr = re[q] * c - im[q] * s, xi = re[q] * s + im[q] * c;
      re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
    }
  }
}
function spectralPeak(x, sr, at, f, N = 32768) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[at + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  fft(re, im);
  const db = (k) => 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12);
  const lo = Math.floor(f * Math.pow(2, -0.6 / 12) * N / sr), hi = Math.ceil(f * Math.pow(2, 0.6 / 12) * N / sr);
  let k = lo;
  for (let j = lo; j <= hi; j++) if (db(j) > db(k)) k = j;
  if (k === lo || k === hi) return f;                      // no clear peak near the estimate
  const a = db(k - 1), b = db(k), c = db(k + 1);
  return (k + 0.5 * (a - c) / (a - 2 * b + c)) * sr / N;
}
// What an AudioBufferSourceNode with loop on plays: straight through to loopEnd, then from
// loopStart again (fractional loop points, read with linear interpolation)
function simulate(y, ls, le, secs) {
  const n = Math.round(secs * SR), out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (p >= le) p -= le - ls;
    const k = Math.floor(p), t = p - k;
    out[i] = y[k] * (1 - t) + (y[k + 1] ?? y[k]) * t;
    p += 1;
  }
  return out;
}
const rmsOf = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

/* ---------- one recording ---------- */
function process1(f) {
  const { sr, x } = readWav(fs.readFileSync(f.local));
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  let onset = 0;
  while (onset < x.length && Math.abs(x[onset]) < 0.05 * peak) onset++;
  const start = Math.max(0, onset - Math.round(0.01 * sr));

  // pitch: YIN over the steady part, searching both readings of the note name, then refined
  const fStd = f.label ? hz(f.label.name, f.label.oct) : 200;
  const fmin = fStd / 1.25, fmax = fStd * 2 * 1.25;
  const N = Math.max(2048, Math.pow(2, Math.ceil(Math.log2(2.2 * sr / fmin))));
  const a0 = onset + Math.round((f.struck ? 0.05 : 0.4) * sr);
  const a1 = Math.min(x.length - N - 1, onset + Math.round((f.struck ? 0.6 : 1.6) * sr));
  const est = [];
  for (let i = a0; i <= a1; i += Math.round(0.04 * sr)) {
    const p = yin(x.subarray(i, i + N), sr, 0.15, fmin, fmax);
    if (p && p.conf > 0.7) est.push(refine(x, sr, i, p.freq));
  }
  if (est.length < 3) return { ...f, error: 'no steady pitch found' };
  const f0 = SPECTRAL.has(f.inst) ? spectralPeak(x, sr, onset + Math.round(0.02 * sr), medianOf(est)) : medianOf(est);
  const sorted = est.slice().sort((p, q) => p - q);
  const spread = cents(sorted[Math.floor(sorted.length * 0.9)], sorted[Math.floor(sorted.length * 0.1)]);

  // loop: sustained notes loop 1 s from 0.5 s in; struck notes loop 0.5 s from where the ring has
  // fallen to 40% of its peak, so they sustain at that level
  const env0 = envelope(x, sr);
  let ls = onset + Math.round(0.5 * sr), len = 1.0;
  if (f.struck) {
    let top = 0, at = onset;
    for (let i = onset; i < Math.min(x.length, onset + 0.2 * sr); i++) if (env0[i] > top) { top = env0[i]; at = i; }
    ls = at;
    while (ls < x.length - 1 && env0[ls] > 0.4 * top) ls++;
    ls = Math.max(onset + Math.round(0.12 * sr), Math.min(ls, onset + Math.round(1.2 * sr)));
    len = 0.5;
  }
  len = Math.min(len, (x.length - ls) / sr - 0.02);
  if (len < 0.2) return { ...f, error: 'recording too short to loop' };
  len = Math.max(1, Math.round(len * f0)) / f0;            // a whole number of cycles
  const C = Math.min(0.08, 0.3 * len);

  // resample the part we keep, then work at 22.05 kHz
  const end = Math.min(x.length, ls + Math.ceil((len + 0.02) * sr));
  const y = resample(x.subarray(start, end), sr, SR);
  const lsS = (ls - start) * SR / sr, leS = lsS + len * SR, Cn = Math.round(C * SR);

  // flatten the loop (and the crossfade lead-in) to the level where the loop starts
  const env = envelope(y, SR);
  const target = env[Math.round(lsS)];
  for (let i = Math.max(0, Math.round(lsS) - Cn); i < Math.min(y.length, Math.ceil(leS) + 1); i++) {
    y[i] *= Math.max(0.25, Math.min(4, target / Math.max(1e-6, env[i])));
  }
  // crossfade the end of the loop into the audio just before its start, so the wrap is seamless
  const at = (p) => { const i = Math.floor(p), t = p - i; return y[i] * (1 - t) + y[Math.min(y.length - 1, i + 1)] * t; };
  for (let k = 0; k < Cn; k++) {
    const i = Math.floor(leS) - Cn + k, w = k / Cn;
    y[i] = y[i] * (1 - w) + at(i - (leS - lsS)) * w;
  }
  const out = y.subarray(0, Math.min(y.length, Math.ceil(leS) + 2));
  for (let i = 0; i < Math.min(out.length, Math.round(0.002 * SR)); i++) out[i] *= i / (0.002 * SR);

  let opk = 0;
  for (const v of out) opk = Math.max(opk, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= 0.98 / opk;
  // gain: the loop's RMS goes 1.5 dB under a full-scale sine (5 dB for struck notes, whose
  // strike sits above it), the same balance as the synth sounds. Capped at 3; the master limiter
  // in audio.js catches the peaks that could pass full scale near full volume.
  const loopRms = rmsOf(out, Math.round(lsS), Math.floor(leS));
  const gain = Math.min(3, (Math.SQRT1_2 * Math.pow(10, (f.struck ? -5 : -1.5) / 20)) / loopRms);

  // The pitch the player hears is the looped sound, and a note drifts as it rings, so measure the
  // final pitch on a simulated playback: the attack, then the loop repeating, as Web Audio plays
  // it. Frames cover exactly two whole loops, because an ear listening for seconds averages a
  // vibrato over whole repeats; a window that cuts a loop short tips uneven vibrato by up to 8¢.
  const N2 = Math.max(2048, Math.pow(2, Math.ceil(Math.log2(2.2 * SR / (f0 / 1.06)))));
  const span = 2 * (leS - lsS);
  const sim = simulate(out, lsS, leS, Math.max(f.inst === 'glockenspiel' ? 2.4 : 0, (lsS + span + N2 + 2) / SR));
  let fin;
  if (SPECTRAL.has(f.inst)) fin = spectralPeak(sim, SR, Math.round(0.2 * SR), f0, 32768);
  else {
    const est2 = [];
    for (let i = Math.round(lsS); i < lsS + span; i += Math.round(0.01 * SR)) {
      const p = yin(sim.subarray(i, i + N2), SR, 0.15, f0 / 1.06, f0 * 1.06);
      if (p && p.conf > 0.7) est2.push(refine(sim, SR, i, p.freq));
    }
    fin = est2.length >= 3 ? medianOf(est2) : f0;
  }
  return { ...f, f0: fin, firstGuess: f0, spread, out, loopStart: lsS / SR, loopEnd: leS / SR, gain };
}

/* ---------- main ---------- */
const files = await listFiles();
console.log(`${files.length} recordings, ${(files.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(0)} MB, cache: ${CACHE}`);
await download(files);
const results = files.map((f) => { process.stdout.write(`\rAnalysing ${f.inst.padEnd(13)}`); return process1(f); });
process.stdout.write('\n');

fs.rmSync(OUT, { recursive: true, force: true });
const index = {
  source: 'VSCO 2 Community Edition by Versilian Studios, CC0 (public domain): https://versilian-studios.com/vsco-community/',
  sampleRate: SR,
  instruments: {}
};
let totalBytes = 0;
for (const inst of new Set(SOURCES.map(([k]) => k))) {
  const [lo, hi] = BANDS[inst];
  const ok = results.filter((r) => r.inst === inst && !r.error && r.f0 >= r.range[0] && r.f0 < r.range[1]).sort((p, q) => p.f0 - q.f0);
  // keep every recording inside the band, plus the nearest one beyond each edge
  const keep = ok.filter((r) => r.f0 >= lo && r.f0 <= hi);
  const below = ok.filter((r) => r.f0 < lo).pop(), above = ok.find((r) => r.f0 > hi);
  if (below) keep.unshift(below);
  if (above) keep.push(above);
  fs.mkdirSync(path.join(OUT, inst), { recursive: true });
  index.instruments[inst] = keep.map((r) => {
    const name = noteOf(r.f0).replace('#', 's');
    const file = `${inst}/${name}.wav`;
    writeWav(path.join(OUT, file), r.out, SR);
    totalBytes += 44 + r.out.length * 2;
    return { file, f0: +r.f0.toFixed(3), loopStart: +r.loopStart.toFixed(5), loopEnd: +r.loopEnd.toFixed(5), gain: +r.gain.toFixed(3) };
  });
  for (const r of results.filter((q) => q.inst === inst)) {
    const kept = keep.includes(r) ? 'keep' : '    ';
    const lab = r.label ? r.label.name + r.label.oct : '?';
    console.log(r.error ? `  ${inst.padEnd(13)} ${lab.padEnd(4)} ERROR ${r.error}` :
      `${kept} ${inst.padEnd(13)} ${lab.padEnd(4)} → ${r.f0.toFixed(2).padStart(8)} Hz ${noteOf(r.f0).padEnd(4)} ${cents(r.f0, 440 * Math.pow(2, Math.round(12 * Math.log2(r.f0 / 440)) / 12)).toFixed(0).padStart(4)}¢  spread ${r.spread.toFixed(0).padStart(3)}¢  looped ${cents(r.f0, r.firstGuess).toFixed(1).padStart(5)}¢  loop ${r.loopStart.toFixed(2)}–${r.loopEnd.toFixed(2)} s  gain ${r.gain.toFixed(2)}`);
  }
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`Wrote ${Object.values(index.instruments).flat().length} samples to ${OUT} (${(totalBytes / 1048576).toFixed(1)} MB)`);
