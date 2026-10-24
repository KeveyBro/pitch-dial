// Scoring maths. Pure functions only; tests/test-pitch.js imports this module directly.
export const NAMES = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

export const centsBetween = (a, b) => 1200 * Math.log2(a / b);
export const round2 = (x) => Math.round(x * 100) / 100;
export const logRandom = (lo, hi) => lo * Math.pow(hi / lo, Math.random());
export const unitWord = (unit) => (unit === 200 ? 'tone' : 'semitone');

// "≈ 1/8 of a tone", "≈ 0.70 of a tone", "≈ 1.35 tones"
export function fractionText(absCents, unit) {
  const word = unitWord(unit);
  if (absCents < 0.01) return 'spot on';
  const f = absCents / unit;
  if (f >= 0.6) {
    const v = f.toFixed(2);
    if (v === '1.00') return `≈ 1 ${word}`;
    return f < 1 ? `≈ ${v} of a ${word}` : `≈ ${v} ${word}s`;
  }
  return `≈ 1/${Math.round(1 / f)} of a ${word}`;
}
export function fractionShort(absCents, unit) {
  if (absCents < 0.01) return '0';
  const f = absCents / unit;
  return f >= 0.6 ? f.toFixed(2) : `1/${Math.round(1 / f)}`;
}
export function noteLabel(f) {
  const m = 69 + 12 * Math.log2(f / 440);
  const n = Math.round(m);
  const off = Math.round((m - n) * 100);
  const name = NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  return `${name} ${off < 0 ? '−' : '+'}${Math.abs(off)}¢`;
}
export const points = (absCents) => Math.round(100 * Math.exp(-absCents / 60));
export function grade(absCents) {
  if (absCents < 5) return ['Excellent', 'good'];
  if (absCents < 15) return ['Very close', 'good'];
  if (absCents < 40) return ['Close', 'fair'];
  if (absCents < 100) return ['Off', 'far'];
  return ['Way off', 'far'];
}
// target and you are both rounded to 0.01 Hz, exactly as displayed
export function describe(target, you, unit) {
  const diff = round2(you - target);
  const c = centsBetween(you, target);
  const abs = Math.abs(c);
  const exact = Math.abs(diff) < 0.005;
  const dir = diff > 0 ? 'too high' : 'too low';
  return {
    diff, c, abs, exact,
    hzText: exact ? 'Exact match' : `${Math.abs(diff).toFixed(2)} Hz ${dir}`,
    toneText: exact ? 'Spot on' : `${fractionText(abs, unit)} ${dir}`,
    centsText: `${c < 0 ? '−' : '+'}${abs.toFixed(1)} cents`
  };
}
// the same note in the octave nearest to what was sung
export function foldOctave(target, you) {
  const k = Math.round(centsBetween(you, target) / 1200);
  return { k, ref: round2(target * Math.pow(2, k)) };
}
