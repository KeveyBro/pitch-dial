// Pitch detection (YIN), the held-note tracker and offline recording analysis.
// Pure functions only; tests/test-pitch.js imports this module directly.
export const FMIN = 60, FMAX = 1100;

export function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }
export function yin(buf, sr, thresh = 0.15) {
  const W = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sr / FMAX));
  const tauMax = Math.min(W - 2, Math.ceil(sr / FMIN));
  const c = new Float32Array(tauMax + 2);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    run += s;
    c[tau] = run > 0 ? (s * tau) / run : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (c[t] < thresh) {
      while (t + 1 <= tauMax && c[t + 1] < c[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  const x0 = c[tau - 1], x1 = c[tau], x2 = c[tau + 1];
  const den = x0 + x2 - 2 * x1;
  const shift = den !== 0 ? Math.max(-1, Math.min(1, (x0 - x2) / (2 * den))) : 0;
  return { freq: sr / (tau + shift), conf: 1 - x1 };
}
export function medianOf(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
// Finds a held note: a stretch where nearly all frames sit within ±tol cents of their median
export function makeTracker(opts = {}) {
  const hold = opts.hold ?? 1.2, win = opts.win ?? 0.4, tol = opts.tol ?? 50;
  let frames = [], run = null, bestRun = null;
  const dur = (r) => (r ? r.end - r.start : 0);
  const close = () => { if (run && dur(run) > dur(bestRun)) bestRun = run; run = null; };
  return {
    push(t, f) {
      frames.push({ t, f });
      while (frames.length && frames[0].t < t - win) frames.shift();
      const span = frames.length > 1 ? t - frames[0].t : 0;
      const voiced = [];
      for (const fr of frames) if (fr.f) voiced.push(fr.f);
      let steady = false, m = 0;
      if (span >= win * 0.75 && voiced.length >= 3 && voiced.length >= frames.length * 0.7) {
        m = medianOf(voiced);
        let within = 0;
        for (const v of voiced) if (Math.abs(1200 * Math.log2(v / m)) <= tol) within++;
        steady = within >= voiced.length * 0.8;
      }
      if (steady) {
        if (!run) run = { start: t, end: t, vals: [] };
        run.end = t;
        if (f && Math.abs(1200 * Math.log2(f / m)) <= tol) run.vals.push(f);
      } else close();
      return { steady, progress: Math.min(1, dur(run) / hold), done: dur(run) >= hold && run.vals.length >= 3 };
    },
    current() { return run && run.vals.length ? medianOf(run.vals) : null; },
    best(minDur = 0.35) {
      const cand = dur(run) > dur(bestRun) ? run : bestRun;
      if (!cand || dur(cand) < minDur || cand.vals.length < 3) return null;
      return medianOf(cand.vals);
    },
    reset() { frames = []; run = null; bestRun = null; }
  };
}
export function analyzeRecording(audio) {
  const data = audio.getChannelData(0);
  let sr = audio.sampleRate;
  const maxLen = Math.min(data.length, Math.round(sr * 30));
  let x;
  if (sr >= 32000) {            // halve the rate to keep analysis quick
    x = new Float32Array(Math.floor(maxLen / 2));
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * (data[2 * i] + data[2 * i + 1]);
    sr = sr / 2;
  } else x = data.subarray(0, maxLen);
  const N = sr > 30000 ? 2048 : 1024;
  const hop = Math.max(1, Math.round(sr * 0.02));
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const gate = Math.max(0.002, peak * 0.05);
  const tr = makeTracker();
  for (let i = 0; i + N <= x.length; i += hop) {
    const seg = x.subarray(i, i + N);
    let f = null;
    if (rms(seg) > gate) {
      const p = yin(seg, sr);
      if (p && p.conf > 0.8 && p.freq >= FMIN && p.freq <= FMAX) f = p.freq;
    }
    tr.push(i / sr, f);
  }
  return tr.best(0.5);
}
