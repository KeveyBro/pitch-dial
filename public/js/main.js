// Pitch Dial: game flow, screens and input handlers.
import { centsBetween, round2, logRandom, unitWord, fractionText, fractionShort, noteLabel, points, grade, describe, foldOctave } from './maths.js';
import { FMIN, FMAX, rms, yin, makeTracker, analyzeRecording } from './pitch.js';
import { INSTRUMENTS, FAMILIES, RANDOM_FAMILIES, pickInstrument, audioContext, ensureAudio, setVolume, playTone, stopShots, startTuner, setTunerFreq, setTunerOn, stopTuner } from './audio.js';
import { micOpen, openMic, readMic, closeMic } from './mic.js';
import { readTokens, drawDial, drawScope } from './canvas.js';

const $ = (id) => document.getElementById(id);
const RANGES = { low: [80, 320], mid: [150, 900], wide: [60, 2000] };
const VRANGES = { low: [98, 294], high: [196, 587] };
const LISTEN = { noob: 5, easy: 2.5, hard: null };

const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ---------- state ---------- */
const settings = { answer: 'dial', listen: 'easy', tunetime: '30', rounds: '10', range: 'mid', vrange: 'low', unit: '200', timbre: 'sine', octfold: true, volume: 45 };
const KEYS = ['answer', 'listen', 'tunetime', 'rounds', 'range', 'vrange', 'unit', 'timbre'];
let game = null;
let flow = 0;           // bumps to cancel stale async steps
let phase = 'setup';
const tracker = makeTracker();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bestKey = (mode) => (mode === 'sing' ? 'pitchdial.best.sing' : 'pitchdial.best');

function show(name) {
  phase = name;
  ['setup', 'listen', 'tune', 'sing', 'result', 'summary'].forEach((s) => { $('screen-' + s).hidden = s !== name; });
  $('status').hidden = name === 'setup';
}
function readForm() {
  const fd = new FormData($('setupForm'));
  KEYS.forEach((k) => { const v = fd.get(k); if (v != null) settings[k] = String(v); });
  settings.octfold = $('octFold').checked;
  settings.volume = Number($('volume').value);
  setVolume(settings.volume / 100);
}
function applyForm() {
  KEYS.forEach((k) => {
    const el = document.querySelector(`input[name="${k}"][value="${settings[k]}"]`);
    if (el) el.checked = true;
  });
  $('octFold').checked = settings.octfold !== false;
  $('volume').value = String(settings.volume);
}
function formUnit() { return Number(settings.unit) === 100 ? 100 : 200; }
function updateModeUI() {
  const sing = settings.answer === 'sing';
  $('rangeDial').hidden = sing;
  $('rangeVoice').hidden = !sing;
  $('singOpts').hidden = !sing;
}
// "Tuba below G2 · Trombone G2–G3 · French horn G3–G4 · Trumpet above G4"
const noteName = (f) => noteLabel(f).split(' ')[0];
function updateSoundHelp() {
  const fam = settings.timbre, parts = FAMILIES[fam];
  let text;
  if (fam === 'random') text = 'Each round picks one of the instrument families at random, then the instrument whose range the note sits in.';
  else if (fam === 'sine' || !parts) text = 'A pure tone with no overtones.';
  else if (parts.length === 1) text = `${INSTRUMENTS[parts[0][0]].name} across the whole range.`;
  else {
    text = parts.map(([k, top], i) => {
      const name = INSTRUMENTS[k].name;
      if (i === 0) return `${name} below ${noteName(top)}`;
      const lo = noteName(parts[i - 1][1]);
      return top === Infinity ? `${name} above ${lo}` : `${name} ${lo}–⁠${noteName(top)}`; // word joiner: don't wrap "G3–G4"
    }).join(' · ') + '. Each note is played by the instrument whose range it sits in.';
  }
  $('timbreHelp').textContent = text;
  const test = fam === 'random' ? 'Test sound plays A4 on each family in turn.'
    : parts && parts.length > 1 ? 'Test sound plays one note on each instrument, low to high.' : 'Test sound plays A4 (440 Hz).';
  $('testHelp').textContent = `${test} Headphones help, and stop the target bleeding into the microphone.`;
}
// Test sound: A4 for a single-sound choice, otherwise one note per instrument (the middle of its
// band, rounded to a semitone), low to high. Random plays A4 on each family.
function demoNotes(fam) {
  if (fam === 'random') return RANDOM_FAMILIES.map((f) => [440, pickInstrument(f, 440)]);
  const parts = FAMILIES[fam] || FAMILIES.sine;
  if (parts.length === 1) return [[440, parts[0][0]]];
  let lo = 60;
  return parts.map(([k, top]) => {
    const mid = Math.sqrt(lo * Math.min(top, 2000));
    lo = top;
    return [440 * Math.pow(2, Math.round(12 * Math.log2(mid / 440)) / 12), k];
  });
}
function updateExample() {
  const d = describe(440, 446.2, formUnit());
  $('exHz').textContent = d.hzText;
  $('exTone').textContent = d.toneText;
  $('exCents').textContent = d.centsText;
}
function updateBestLine() {
  const b = store.get(bestKey(settings.answer));
  const el = $('bestLine');
  if (b && typeof b.avgCents === 'number') {
    const what = settings.answer === 'sing' ? 'singing' : 'dial';
    el.textContent = `Your best ${what} average so far: ${b.avgCents.toFixed(1)} cents (${fractionText(b.avgCents, formUnit())}).`;
    el.hidden = false;
  } else el.hidden = true;
}
function updateStatus() {
  if (!game) return;
  $('roundLabel').textContent = `Round ${game.round} of ${game.rounds}`;
  $('scoreLabel').textContent = `${game.score} pts`;
}
function setTimer(boxId, barId, textId, total, end) {
  const left = Math.max(0, end - performance.now());
  $(barId).style.transform = `scaleX(${left / (total * 1000)})`;
  $(textId).textContent = `${Math.ceil(left / 1000)} s left`;
  $(boxId).classList.toggle('low', left < 5000);
  return left;
}

/* ---------- game flow ---------- */
async function startGame() {
  readForm();
  store.set('pitchdial.settings', settings);
  if (!ensureAudio()) { $('audioError').hidden = false; return; }
  const sing = settings.answer === 'sing';
  const [lo, hi] = sing ? (VRANGES[settings.vrange] || VRANGES.low) : (RANGES[settings.range] || RANGES.mid);
  let micMode = null;
  if (sing) {
    const btns = [$('startBtn'), $('againBtn')];
    btns.forEach((b) => { b.disabled = true; });
    $('startBtn').textContent = 'Waiting for the microphone…';
    const ok = await openMic();
    btns.forEach((b) => { b.disabled = false; });
    $('startBtn').textContent = 'Start game';
    micMode = ok ? 'live' : 'upload';
  } else closeMic();
  game = {
    mode: sing ? 'sing' : 'dial',
    micMode,
    fold: sing && settings.octfold !== false,
    lo, hi,
    unit: formUnit(),
    rounds: Number(settings.rounds) || 10,
    tuneTime: Number(settings.tunetime) || 0,
    listen: settings.listen,
    family: settings.timbre,
    round: 0, score: 0, results: [],
    sound: true, target: 0, inst: 'sine', freq: 0, lastVoiced: 0
  };
  $('coarseLo').textContent = `${lo} Hz`;
  $('coarseHi').textContent = `${hi} Hz`;
  nextRound();
}

async function nextRound() {
  const id = ++flow;
  stopShots(); stopTuner();
  game.round += 1;
  updateStatus();
  game.target = round2(logRandom(game.lo, game.hi));
  // the whole round (target, dial tone, replays) uses the instrument chosen for the target, so
  // the dial never switches instrument at a band edge and gives away where the target is
  game.inst = pickInstrument(game.family, game.target);
  const dur =LISTEN[game.listen] ?? Math.round((0.6 + Math.random() * 1.9) * 10) / 10;

  show('listen');
  const cd = $('countdown'), label = $('listenLabel'), bar = $('listenBar'), scope = $('scope');
  bar.style.transform = 'scaleX(0)';
  cd.hidden = false;
  drawScope(scope, 0, 0);
  label.textContent = 'Get ready';
  for (const n of [3, 2, 1]) {
    cd.textContent = String(n);
    await wait(650);
    if (id !== flow) return;
  }
  cd.hidden = true;
  const who = game.family === 'sine' ? '' : ` · ${INSTRUMENTS[game.inst].name}`;
  label.textContent = (game.listen === 'hard' ? 'Listen' : `Listen · ${dur} s`) + who;
  playTone(game.target, dur, 0, game.inst);
  const t0 = performance.now();
  await new Promise((res) => {
    const step = (t) => {
      if (id !== flow) return res();
      const p = Math.min(1, Math.max(0, (t - t0) / (dur * 1000)));
      bar.style.transform = `scaleX(${p})`;
      drawScope(scope, t, p < 1 ? 1 : 0);
      if (p < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  if (id !== flow) return;
  label.textContent = game.mode === 'sing' ? 'Now sing it' : 'Now match it';
  await wait(game.mode === 'sing' ? 250 : 450);
  if (id !== flow) return;
  if (game.mode === 'sing') startSing(id); else startTune(id);
}

/* dial mode */
function startTune(id) {
  let f, tries = 0;
  do { f = logRandom(game.lo, game.hi); tries++; }
  while (Math.abs(centsBetween(f, game.target)) < 250 && tries < 40);
  game.freq = f;
  show('tune');
  setSoundButton();
  startTuner(f, game.sound, game.inst);
  renderTune(false);
  $('face').focus({ preventScroll: true });

  const total = game.tuneTime;
  $('timer').classList.remove('low');
  if (!total) { $('timerBar').style.transform = 'scaleX(1)'; $('timerText').textContent = 'No time limit'; return; }
  const end = performance.now() + total * 1000;
  const tick = () => {
    if (id !== flow || phase !== 'tune') return;
    if (setTimer('timer', 'timerBar', 'timerText', total, end) <= 0) { submit(true); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function setFreq(f, fromSlider) {
  if (!game) return;
  game.freq = Math.min(game.hi, Math.max(game.lo, f));
  setTunerFreq(game.freq);
  renderTune(fromSlider);
}
const nudge = (cents) => { if (game && phase === 'tune') setFreq(game.freq * Math.pow(2, cents / 1200), false); };
function renderTune(fromSlider) {
  const f = game.freq;
  $('freqNum').textContent = f.toFixed(2);
  $('noteName').textContent = noteLabel(f);
  if (!fromSlider) {
    const pos = Math.log(f / game.lo) / Math.log(game.hi / game.lo) * 1000;
    $('coarse').value = String(Math.round(pos));
  }
  if (phase === 'tune') drawDial($('dial'), f, game.lo, game.hi, false);
}
function setSoundButton() { $('soundBtn').textContent = game && game.sound ? 'Mute your tone' : 'Unmute your tone'; }
function submit(auto) {
  if (phase !== 'tune') return;
  flow++;
  stopTuner(); endDrag();
  recordResult(round2(game.freq), auto);
}

/* singing mode */
let singStateText = '';
function setSingState(text, progress) {
  if (text !== singStateText) { $('singState').textContent = text; singStateText = text; }
  $('holdBar').style.transform = `scaleX(${progress})`;
}
function renderSing(now) {
  const live = game.freq && now - game.lastVoiced < 400;
  $('singNum').textContent = live ? game.freq.toFixed(2) : '—';
  $('singNote').textContent = live ? noteLabel(game.freq) : 'Listening…';
  drawDial($('singDial'), game.freq || Math.sqrt(game.lo * game.hi), game.lo, game.hi, !live);
}
function startSing(id) {
  show('sing');
  game.freq = 0; game.lastVoiced = 0;
  tracker.reset();
  singStateText = '';
  const live = game.micMode === 'live';
  $('singLive').hidden = !live;
  $('singTimer').hidden = !live;
  $('singUpload').hidden = live;
  $('bestBtn').hidden = !live;
  $('bestBtn').disabled = true;
  if (!live) {
    $('uploadStatus').textContent = '';
    $('uploadInput').value = '';
    return;
  }
  setSingState('Sing and hold the note', 0);
  renderSing(performance.now());
  const total = game.tuneTime;
  const end = performance.now() + total * 1000;
  const sr = audioContext().sampleRate;
  $('singTimer').classList.remove('low');
  if (!total) { $('singTimerBar').style.transform = 'scaleX(1)'; $('singTimerText').textContent = 'No time limit'; }
  let lastAnalysis = 0;
  const loop = (now) => {
    if (id !== flow || phase !== 'sing' || !micOpen()) return;
    if (now - lastAnalysis >= 30) {
      lastAnalysis = now;
      const buf = readMic();
      const r = rms(buf);
      const lvl = r > 0 ? Math.min(1, Math.max(0, (20 * Math.log10(r) + 60) / 54)) : 0;
      $('levelBar').style.transform = `scaleX(${lvl})`;
      let f = null;
      if (r > 0.006) {
        const p = yin(buf, sr);
        if (p && p.conf > 0.8 && p.freq >= FMIN && p.freq <= FMAX) f = p.freq;
      }
      const st = tracker.push(now / 1000, f);
      if (f) {
        game.freq = game.freq && now - game.lastVoiced < 400 ? game.freq * Math.pow(f / game.freq, 0.35) : f;
        game.lastVoiced = now;
      }
      renderSing(now);
      if (st.done) { setSingState('Got it', 1); finishSing(tracker.current(), false); return; }
      if (st.steady) setSingState('Keep holding…', st.progress);
      else setSingState(f ? 'Hold it steady' : 'Sing and hold the note', 0);
      $('bestBtn').disabled = !tracker.best();
    }
    if (total && setTimer('singTimer', 'singTimerBar', 'singTimerText', total, end) <= 0) {
      finishSing(tracker.best(), true);
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function finishSing(f, auto) {
  if (phase !== 'sing') return;
  flow++;
  if (!f) recordMiss(auto, false); else recordResult(round2(f), auto);
}

/* results */
function recordResult(you, auto) {
  let ref = game.target, oct = 0;
  if (game.fold) { const fo = foldOctave(game.target, you); ref = fo.ref; oct = fo.k; }
  const d = describe(ref, you, game.unit);
  const pts = points(d.abs);
  game.score += pts;
  const res = Object.assign({ round: game.round, target: game.target, inst: game.inst, ref, oct, you, pts, miss: false }, d);
  game.results.push(res);
  updateStatus();
  showResult(res, auto);
}
function recordMiss(auto, skipped) {
  const res = { round: game.round, target: game.target, inst: game.inst, miss: true, skipped, pts: 0 };
  game.results.push(res);
  updateStatus();
  showResult(res, auto);
}
function showResult(r, auto) {
  show('result');
  const sing = game.mode === 'sing';
  $('rRound').textContent = `Round ${r.round} of ${game.rounds}`;
  $('rTarget').textContent = r.target.toFixed(2);
  $('rTargetLabel').textContent = game.family === 'sine' ? 'Target' : `Target · ${INSTRUMENTS[r.inst].name}`;
  $('rYouLabel').textContent = sing ? 'You sang' : 'You';
  $('gauge').hidden = r.miss;
  $('hearYours').disabled = r.miss;
  $('hearBoth').disabled = r.miss;
  $('hearYours').textContent = sing ? 'Hear your note' : 'Hear yours';
  if (r.miss) {
    $('rYou').textContent = '—';
    $('rGrade').textContent = r.skipped ? 'Skipped' : 'No note';
    $('rGrade').dataset.grade = 'far';
    $('rHz').textContent = r.skipped ? 'Round skipped' : 'No steady note heard';
    $('rTone').textContent = r.skipped ? '' : 'Sing a little louder and hold one note for about two seconds.';
    $('rCents').textContent = '0 pts';
    $('rOct').hidden = true;
  } else {
    $('rYou').textContent = r.you.toFixed(2);
    $('rHz').textContent = r.hzText;
    $('rTone').textContent = r.toneText;
    $('rCents').textContent = `${r.centsText} · ${r.pts} pts`;
    const [label, cls] = grade(r.abs);
    $('rGrade').textContent = label;
    $('rGrade').dataset.grade = cls;
    if (r.oct) {
      const n = Math.abs(r.oct);
      $('rOct').textContent = `You sang ${n === 1 ? 'an octave' : n + ' octaves'} ${r.oct < 0 ? 'below' : 'above'} the target, so this round is scored against ${r.ref.toFixed(2)} Hz.`;
      $('rOct').hidden = false;
    } else $('rOct').hidden = true;
    drawGauge(r.c, cls);
  }
  if (auto) {
    $('rNote').textContent = !sing ? 'Time ran out, so your last dial setting was submitted.'
      : r.miss ? 'Time ran out before a steady note was heard.' : 'Time ran out, so your steadiest attempt was used.';
    $('rNote').hidden = false;
  } else $('rNote').hidden = true;
  $('nextBtn').textContent = game.round >= game.rounds ? 'See results' : 'Next round';
  $('nextBtn').focus({ preventScroll: true });
}

/* gauge: symmetric log scale so 1/16, 1/8, 1/4, 1/2, 1, 2 of the unit sit roughly evenly */
const MARKS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2];
function gaugePos(c, unit) {
  const k = unit / 16, max = unit * 2;
  const a = Math.min(Math.abs(c), max);
  return Math.sign(c) * Math.log2(1 + a / k) / Math.log2(1 + max / k);
}
function drawGauge(c, cls) {
  const track = $('gaugeTrack');
  const unit = game.unit;
  track.textContent = '';
  const narrow = track.clientWidth < 420;
  const add = (cl, left, text) => {
    const el = document.createElement('span');
    el.className = cl;
    el.style.left = left;
    if (text) el.textContent = text;
    track.appendChild(el);
    return el;
  };
  MARKS.forEach((m) => [-1, 1].forEach((s) => {
    const left = `${50 + gaugePos(s * m * unit, unit) * 50}%`;
    add('g-tick', left);
    if (!(narrow && m < 1 / 4)) add('g-label', left, m >= 1 ? String(m) : `1/${Math.round(1 / m)}`);
  }));
  add('g-target', '50%');
  add('g-target-label', '50%', 'target');
  const p = gaugePos(c, unit);
  const left = `${50 + p * 50}%`;
  const dot = add('g-you', left);
  dot.dataset.grade = cls;
  const lab = add('g-you-label', left, Math.abs(c) > unit * 2 ? 'you (off scale)' : 'you');
  lab.dataset.grade = cls;
  if (p > 0.82) lab.classList.add('edge-r');
  if (p < -0.82) lab.classList.add('edge-l');
  $('gaugeUnit').textContent = `Scale marks are fractions of a ${unitWord(unit)}, from 1/16 out to 2 ${unitWord(unit)}s either side.`;
}

function showSummary() {
  flow++;
  stopTuner(); stopShots(); closeMic();
  show('summary');
  const rs = game.results, unit = game.unit, sing = game.mode === 'sing';
  const ok = rs.filter((r) => !r.miss);
  const n = ok.length, misses = rs.length - n;
  if (n) {
    const avgC = ok.reduce((s, r) => s + r.abs, 0) / n;
    // each Hz miss is scaled to what it would be at 440 Hz before averaging, since the same
    // Hz gap is a bigger miss on a low note than on a high one
    const avgHz = ok.reduce((s, r) => s + Math.abs(r.diff) * 440 / r.ref, 0) / n;
    const best = ok.reduce((b, r) => (r.abs < b.abs ? r : b), ok[0]);
    $('sAvgHz').textContent = `${avgHz.toFixed(2)} Hz`;
    $('sAvgTone').textContent = `at 440 Hz · ${fractionText(avgC, unit)} · ${avgC.toFixed(1)} cents` + (misses ? ` · ${misses} round${misses > 1 ? 's' : ''} with no note` : '');
    $('sBest').textContent = `Round ${best.round}`;
    $('sBestSub').textContent = `${Math.abs(best.diff).toFixed(2)} Hz · ${fractionText(best.abs, unit)}`;
    const prev = store.get(bestKey(game.mode));
    const isBest = n >= 5 && (!prev || typeof prev.avgCents !== 'number' || avgC < prev.avgCents);
    if (isBest) store.set(bestKey(game.mode), { avgCents: avgC, rounds: n });
    $('sPB').hidden = !isBest;
  } else {
    $('sAvgHz').textContent = '—';
    $('sAvgTone').textContent = 'No rounds were scored';
    $('sBest').textContent = '—';
    $('sBestSub').textContent = '';
    $('sPB').hidden = true;
  }
  $('sScore').textContent = String(game.score);
  $('sScoreMax').textContent = `out of ${rs.length * 100}`;
  $('sRef').textContent = sing
    ? `For reference: in a lab study, non-musicians singing a note they had just heard missed by 38 cents on average (${fractionText(38, unit)}).`
    : `For reference: in a lab study, non-musicians matching tones with a slider missed by 13 cents on average (${fractionText(13, unit)}), and they could replay the target.`;
  $('thUnit').textContent = `Off (${unitWord(unit)}s)`;
  $('thYours').textContent = sing ? 'Sang Hz' : 'Yours Hz';
  const body = $('sRows');
  body.textContent = '';
  let anyOct = false;
  rs.forEach((r) => {
    const tr = document.createElement('tr');
    let cells;
    if (r.miss) cells = [String(r.round), r.target.toFixed(2), '—', '—', r.skipped ? 'skipped' : 'no note', '—'];
    else {
      const dir = r.exact ? '' : (r.diff > 0 ? ' high' : ' low');
      let yours = r.you.toFixed(2);
      if (r.oct) { anyOct = true; yours += ` ${r.oct < 0 ? '↓' : '↑'}${Math.abs(r.oct) > 1 ? Math.abs(r.oct) : ''}8ve`; }
      cells = [
        String(r.round), r.target.toFixed(2), yours,
        `${r.diff > 0 ? '+' : r.diff < 0 ? '−' : ''}${Math.abs(r.diff).toFixed(2)}`,
        `${fractionShort(r.abs, unit)}${dir}`,
        r.centsText.replace(' cents', '')
      ];
    }
    cells.forEach((t) => { const td = document.createElement('td'); td.textContent = t; tr.appendChild(td); });
    body.appendChild(tr);
  });
  $('sFoot').hidden = !anyOct;
  updateBestLine();
  $('againBtn').focus({ preventScroll: true });
}

/* ---------- input: dial ---------- */
const face = $('face');
let drag = null;
face.addEventListener('pointerdown', (e) => {
  if (phase !== 'tune' || e.button > 0) return;
  drag = { x: e.clientX, y: e.clientY, onDial: e.target === $('dial') };
  try { face.setPointerCapture(e.pointerId); } catch (_) {}
  face.classList.add('dragging');
});
face.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  const d = drag.onDial ? -dx : -dy;
  if (d) nudge(d * (e.shiftKey ? 0.2 : 1));
});
function endDrag() { drag = null; face.classList.remove('dragging'); }
face.addEventListener('pointerup', endDrag);
face.addEventListener('pointercancel', endDrag);
face.addEventListener('wheel', (e) => {
  if (phase !== 'tune') return;
  e.preventDefault();
  const mult = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
  const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * mult;
  nudge(-d * (e.shiftKey ? 0.01 : 0.05));
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (phase !== 'tune') return;
  const step = e.shiftKey ? 10 : 1;
  const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 100, PageDown: -100 };
  if (e.key in map) { e.preventDefault(); nudge(map[e.key]); return; }
  if (e.key === 'Enter' && !(e.target instanceof Element && e.target.closest('button'))) { e.preventDefault(); submit(false); }
});

$('coarse').addEventListener('input', (e) => {
  if (!game || phase !== 'tune') return;
  const p = Number(e.target.value) / 1000;
  setFreq(game.lo * Math.pow(game.hi / game.lo, p), true);
});

// nudge buttons: tap once, or hold to repeat
document.querySelectorAll('.nudges .btn').forEach((b) => {
  const step = Number(b.dataset.step);
  let t1 = 0, t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  b.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    nudge(step);
    stop();
    t1 = setTimeout(() => { t2 = setInterval(() => nudge(step), 60); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('click', (e) => { if (e.detail === 0) nudge(step); }); // keyboard activation
});

$('soundBtn').addEventListener('click', () => {
  if (!game) return;
  game.sound = !game.sound;
  setTunerOn(game.sound);
  setSoundButton();
});
$('submitBtn').addEventListener('click', () => submit(false));

/* ---------- input: singing ---------- */
$('bestBtn').addEventListener('click', () => { if (phase === 'sing') finishSing(tracker.best(), false); });
$('skipBtn').addEventListener('click', () => { if (phase === 'sing') { flow++; recordMiss(false, true); } });
$('hearAgain').addEventListener('click', () => { if (game && phase === 'sing') { stopShots(); playTone(game.target, 1.5, 0, game.inst); } });
$('uploadInput').addEventListener('change', async (e) => {
  const input = e.target;
  const file = input.files && input.files[0];
  if (!file || phase !== 'sing') return;
  const id = flow;
  const status = $('uploadStatus');
  status.textContent = 'Finding the note in your recording…';
  try {
    const ab = await file.arrayBuffer();
    const actx = audioContext();
    const audio = await new Promise((res, rej) => {
      const p = actx.decodeAudioData(ab, res, rej);
      if (p && typeof p.then === 'function') p.then(res, rej);
    });
    if (id !== flow || phase !== 'sing') return;
    const f = analyzeRecording(audio);
    if (!f) {
      status.textContent = "Couldn't find a steady note in that recording. Hold one note for about two seconds and upload it again.";
      input.value = '';
      return;
    }
    finishSing(f, false);
  } catch (err) {
    status.textContent = "That file couldn't be read. Try a WAV, MP3 or M4A recording.";
    input.value = '';
  }
});

/* ---------- input: result, summary, setup ---------- */
$('nextBtn').addEventListener('click', () => {
  if (!game) return;
  if (game.round >= game.rounds) showSummary(); else nextRound();
});
const last = () => game && game.results[game.results.length - 1];
$('hearTarget').addEventListener('click', () => { const r = last(); if (!r) return; stopShots(); playTone(r.target, 1, 0, r.inst); });
$('hearYours').addEventListener('click', () => { const r = last(); if (!r || r.miss) return; stopShots(); playTone(r.you, 1, 0, r.inst); });
$('hearBoth').addEventListener('click', () => { const r = last(); if (!r || r.miss) return; stopShots(); playTone(r.target, 0.9, 0, r.inst); playTone(r.you, 0.9, 1.15, r.inst); });

$('endBtn').addEventListener('click', () => {
  flow++;
  stopTuner(); stopShots(); endDrag();
  if (game && game.results.length) showSummary(); else { closeMic(); show('setup'); }
});
$('againBtn').addEventListener('click', () => startGame());
$('settingsBtn').addEventListener('click', () => { flow++; stopShots(); closeMic(); show('setup'); updateBestLine(); });

$('setupForm').addEventListener('submit', (e) => { e.preventDefault(); startGame(); });
$('setupForm').addEventListener('change', () => {
  readForm();
  store.set('pitchdial.settings', settings);
  updateModeUI(); updateSoundHelp(); updateExample(); updateBestLine();
});
$('volume').addEventListener('input', () => {
  settings.volume = Number($('volume').value);
  setVolume(settings.volume / 100);
});
$('testBtn').addEventListener('click', () => {
  if (!ensureAudio()) { $('audioError').hidden = false; return; }
  stopShots();
  demoNotes(settings.timbre).forEach(([f, inst], i) => playTone(f, 0.6, i * 0.75, inst));
});

/* ---------- boot ---------- */
const saved = store.get('pitchdial.settings');
if (saved && typeof saved === 'object') KEYS.concat('volume', 'octfold').forEach((k) => {
  if (saved[k] == null) return;
  if (KEYS.includes(k) && !document.querySelector(`input[name="${k}"][value="${saved[k]}"]`)) return; // an option that no longer exists
  settings[k] = saved[k];
});
applyForm();
readForm();
readTokens();
updateModeUI();
updateSoundHelp();
updateExample();
updateBestLine();

const redraw = () => {
  readTokens();
  if (phase === 'tune') renderTune(false);
  if (phase === 'sing' && game) renderSing(performance.now());
  if (phase === 'listen') drawScope($('scope'), 0, 0);
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
if ('ResizeObserver' in window) {
  new ResizeObserver(() => { if (phase === 'tune') renderTune(false); }).observe($('dial'));
  new ResizeObserver(() => { if (phase === 'sing' && game) renderSing(performance.now()); }).observe($('singDial'));
  new ResizeObserver(() => {
    const r = last();
    if (phase === 'result' && r && !r.miss) drawGauge(r.c, grade(r.abs)[1]);
  }).observe($('gaugeTrack'));
}

// Offline support. Service workers need a secure context, so this is skipped on plain http.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
