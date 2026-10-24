// Canvas drawing. readTokens copies the CSS colour tokens so the canvases follow the theme.
import { NAMES, centsBetween } from './maths.js';

const MONO = '"Azeret Mono", ui-monospace, Menlo, Consolas, monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const tok = {};

export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  ['ink', 'muted', 'rule', 'panel', 'dial', 'dial-deep', 'dial-ink', 'needle'].forEach((k) => {
    tok[k.replace('-', '_')] = cs.getPropertyValue('--' + k).trim();
  });
}
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

// Backlit dial: 1 px = 1 cent, semitone ticks labelled with note name and Hz
export function drawDial(cv, f, lo, hi, dim) {
  const c = fitCanvas(cv);
  if (!c) return;
  const { ctx, w, h } = c;
  const bg = ctx.createLinearGradient(0, 0, w, 0);
  bg.addColorStop(0, tok.dial_deep); bg.addColorStop(0.5, tok.dial); bg.addColorStop(1, tok.dial_deep);
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  const C = centsBetween(f, 440);
  const x0 = w / 2 - C;
  const xl = x0 + centsBetween(lo, 440), xr = x0 + centsBetween(hi, 440);
  ctx.fillStyle = tok.dial_ink; ctx.globalAlpha = 0.2;
  if (xl > 0) ctx.fillRect(0, 0, Math.min(xl, w), h);
  if (xr < w) ctx.fillRect(Math.max(xr, 0), 0, w - Math.max(xr, 0), h);

  ctx.strokeStyle = tok.dial_ink; ctx.fillStyle = tok.dial_ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const start = Math.ceil((C - w / 2) / 10) * 10, end = C + w / 2;
  for (let k = start; k <= end; k += 10) {
    const x = Math.round(x0 + k) + 0.5;
    const mod = ((k % 100) + 100) % 100;
    const len = mod === 0 ? h * 0.36 : mod === 50 ? h * 0.24 : h * 0.13;
    ctx.lineWidth = mod === 0 ? 1.5 : 1;
    ctx.globalAlpha = mod === 0 ? 0.95 : 0.55;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, len); ctx.stroke();
    if (mod === 0) {
      const n = 69 + k / 100;
      ctx.globalAlpha = 0.95;
      ctx.font = `600 13px ${MONO}`;
      ctx.fillText(NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1), x, h * 0.62);
      ctx.globalAlpha = 0.72;
      ctx.font = `400 10.5px ${MONO}`;
      const hz = 440 * Math.pow(2, k / 1200);
      ctx.fillText(hz < 1000 ? hz.toFixed(1) : hz.toFixed(0), x, h * 0.86);
    }
  }
  ctx.globalAlpha = 1;
  const gl = ctx.createLinearGradient(0, 0, 0, h);
  gl.addColorStop(0, 'rgba(255,255,255,0.26)');
  gl.addColorStop(0.45, 'rgba(255,255,255,0)');
  gl.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);

  if (dim) {
    ctx.globalAlpha = 0.5; ctx.fillStyle = tok.panel; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = tok.needle;
  ctx.fillRect(Math.round(w / 2) - 1, 0, 2, h);
  ctx.beginPath(); ctx.moveTo(w / 2 - 6, 0); ctx.lineTo(w / 2 + 6, 0); ctx.lineTo(w / 2, 8); ctx.closePath(); ctx.fill();
}

// Listen-screen oscilloscope: a flat line, or a breathing sine while the target plays
export function drawScope(cv, t, amp) {
  const c = fitCanvas(cv);
  if (!c) return;
  const { ctx, w, h } = c;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = tok.rule; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, h / 2 + 0.5); ctx.lineTo(w, h / 2 + 0.5); ctx.stroke();
  if (!amp) return;
  ctx.strokeStyle = tok.ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  const ph = reduceMotion.matches ? 0 : t / 160;
  for (let x = 0; x <= w; x += 2) {
    const env = Math.sin(Math.PI * x / w);
    const y = h / 2 - Math.sin((x / w) * Math.PI * 2 * 4 - ph) * (h * 0.36) * env * amp;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
