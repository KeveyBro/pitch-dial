# Pitch Dial: handoff

Pitch Dial is a single-page ear-training game. It plays a target tone, and the player matches it either by turning a tuning dial or by singing. Each round reports how far off the player was in **Hz**, as a **fraction of a tone** (for example "≈ 1/8 of a tone too high") and in **cents**.

It was inspired by matchthefreq.site. The player wanted the same game, plus the fraction-of-a-tone readout, plus a singing mode.

It's now a hostable static web app: everything the browser needs is in `public/`, with no build step, no backend and no dependencies. Deploy that folder to any HTTPS static host. `README.md` has the hosting steps.

Earlier versions, kept for reference: the claude.ai artifact (https://claude.ai/artifact/W3KBvDwk3fSpXqAKgEQw9E, private to the owner), and the single-file `pitch-dial-mic.html`. `pitch-dial-project.zip` holds the artifact-format source and its old build and test tools. The web app replaces all of them.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | Page markup, with the head tags for the manifest, icons and theme colour. |
| `public/app.css` | All styles. Every colour is a token on `:root`. |
| `public/js/main.js` | Game flow, screens, input handlers and settings. It also registers the service worker. |
| `public/js/maths.js` | Pure scoring functions. |
| `public/js/pitch.js` | Pure pitch-detection functions: YIN, the held-note tracker and recording analysis. |
| `public/js/audio.js` | Tone output. |
| `public/js/mic.js` | Microphone input. |
| `public/js/canvas.js` | Dial and oscilloscope drawing. |
| `public/sw.js` | Service worker for offline use. |
| `public/manifest.webmanifest`, `public/icons/` | Lets people install the app. Run `npm run icons` to regenerate the icons. |
| `public/_headers` | CSP, Permissions-Policy and cache headers. Netlify and Cloudflare Pages read it. |
| `tools/serve.js` | Zero-dependency dev server. It applies `_headers`, so the CSP gets exercised locally. |
| `tools/make-icons.js` | Draws the icon and writes the SVG and PNGs. |
| `tests/test-pitch.js` | Headless tests for the scoring maths, YIN, the tracker and recording analysis, using synthetic voices. It imports `maths.js` and `pitch.js` directly. |
| `.github/workflows/pages.yml` | Optional GitHub Pages deploy: it runs the tests, then publishes `public/`. |

```bash
npm run dev      # http://localhost:8080
npm test
npm run icons
```

`package.json` exists only for these scripts and `"type": "module"`. There are no dependencies. Node 18+ is enough.

## Microphone

`getUserMedia` only works in a secure context: HTTPS, or `localhost` during development. On any HTTPS host, every visitor gets live singing input after a one-time permission prompt for that site.

The page asks for the mic when a singing game starts. If the mic is refused, missing, or the prompt is left for 20 seconds, it switches to upload mode on its own. In upload mode the player records the note in any voice-memo app and uploads it, and the page analyses the file offline. The "Hear the target again" button exists only in upload mode.

Live input has been checked in Chromium by swapping `getUserMedia` for a synthetic sawtooth voice (196 Hz with ±20¢ vibrato). It was detected as 196.24 Hz and locked in about 2 seconds. Upload mode was checked by forcing a permission refusal. **A real voice through a real microphone is still untested.**

## Offline and caching

`sw.js` caches the app on first visit. App files are network-first, so a new deploy shows up on the next load without bumping a version; the cache is only used when the network fails. Google Fonts files are cache-first because their URLs never change. Bump `CACHE` in `sw.js` only when the caching logic itself changes. The service worker is registered only in a secure context.

## How the code is organised

The modules have one job each, and only `main.js` touches the DOM outside the canvases.

1. **maths.js**: `centsBetween`, `round2`, `logRandom`, `unitWord`, `fractionText` (the "≈ 1/x of a tone" wording), `fractionShort`, `noteLabel`, `points`, `grade`, `describe`, `foldOctave`, `NAMES`.
2. **pitch.js**: `FMIN`/`FMAX` (60–1100 Hz), `rms`, `yin(buf, sr)` (threshold 0.15, parabolic interpolation), `medianOf`, `makeTracker()`, `analyzeRecording(audioBuffer)`.
3. **audio.js**: a shared `AudioContext` and master gain. `playTone` handles one-shot tones, and `startTuner(freq, on)`/`setTunerFreq`/`setTunerOn`/`stopTuner` handle the dial's continuous tone. `setVolume(0–1)` maps volume as `0.5 × v²`. `audioContext()` returns the context, or null before the first `ensureAudio()`.
4. **mic.js**: `openMic` (needs `ensureAudio()` first), `readMic` (the latest frame, in a reused buffer), `micOpen`, `closeMic`. Echo cancellation, noise suppression and AGC are turned off. The analyser is connected to a zero-gain sink so it keeps processing.
5. **canvas.js**: `readTokens` reads the CSS colour tokens so the canvases follow the theme. `drawDial(canvas, freq, lo, hi, dim)` draws the amber dial at 1 px = 1 cent, with semitone ticks labelled with note name and Hz. `drawScope(canvas, t, amp)` draws the listen-screen wave.
6. **main.js, game flow**: phases are `setup → listen → tune | sing → result → … → summary`. Each async step captures `flow` and stops if it has changed; anything that leaves a phase does `flow++`.
7. **main.js, input handlers**: the dial (drag, wheel, keys, coarse slider, hold-to-repeat nudge buttons), singing (live loop, upload, skip, best attempt) and the setup form.

### Scoring rules

- The target and the answer are both rounded to 0.01 Hz before comparing, so the Hz shown always matches the arithmetic.
- `cents = 1200 · log2(answer / reference)`. The fraction is `|cents| / unit`, where unit is 200 for a whole tone or 100 for a semitone. Below 0.6 of a unit it's shown as `1/round(unit/|cents|)`; at 0.6 or above it's shown as a decimal.
- Points per round: `round(100 · e^(−|cents|/60))`.
- Grades: under 5¢ Excellent, under 15¢ Very close, under 40¢ Close, under 100¢ Off, otherwise Way off.
- In singing mode with "Count the same note in any octave" on, the reference becomes `target · 2^k`, where `k = round(cents / 1200)`. Hz-off is measured against that octave-shifted reference.
- Missed or skipped rounds score 0 and are left out of the averages.

### Singing detection

- The live loop analyses a 2048-sample frame (4096 above 50 kHz) every 30 ms or more. A frame counts as voiced when its RMS is above 0.006 and YIN confidence is above 0.8.
- `makeTracker({hold: 1.2, win: 0.4, tol: 50})`: over a 0.4 s window, at least 70% of frames must be voiced, and at least 80% of the voiced frames must sit within ±50¢ of their median. Once that steadiness lasts 1.2 s, the note locks to the median of the frames in the held run. The ±50¢ tolerance is there so normal vibrato still counts as steady.
- `analyzeRecording` halves the sample rate when it's 32 kHz or more, analyses at most 30 s, uses a gate of 5% of the file's peak, and returns the longest steady run of at least 0.5 s.
- Verified only on synthetic signals: harmonic-rich voices from 98 to 523 Hz, ±30¢ vibrato, jitter, noise, an upward scoop into the note, and a slide (which correctly doesn't lock). **It has not been tested with a real microphone and a real voice yet.**

### Storage (localStorage, every access wrapped in try/catch)

- `pitchdial.settings`: answer mode, listen time, time limit, rounds, ranges, unit, octave fold and volume.
- `pitchdial.best` and `pitchdial.best.sing`: `{avgCents, rounds}`, the best average for each mode. A best is only recorded for games with at least 5 scored rounds.
- Storage is per origin, so each deployment (and `localhost`) keeps its own settings and bests, separate from the old artifact and standalone file.

### Design

The page is meant to look like an instrument panel: quiet enamel greys, with the amber backlit tuning dial and its red needle as the only loud element. Archivo is used at 125% width for display text and at normal width for body text, and Azeret Mono is used for numbers. Every colour is a CSS token on `:root`, with dark values under `prefers-color-scheme: dark` and `[data-theme="dark"]`. The side gutter uses `max(16px, env(safe-area-inset-*))` so the layout clears notches when installed. The CSP in `_headers` allows scripts and styles only from this site, plus Google Fonts, so don't add inline `<script>`, `style="…"` attributes or other CDNs without updating it (setting `element.style` from JS is fine). The app icon is a slice of the dial with its red needle.

## Research benchmarks used in the app and chat

| Benchmark | Cents | ≈ Fraction of a whole tone | Source |
|---|---|---|---|
| Discrimination threshold at 1 kHz, best 5% of 918 adults | 6.2 | 1/32 | Sci Rep 2017 (doi 10.1038/s41598-017-16526-8) |
| Same, median of everyone | 14.5 | 1/14 | same |
| Same, people with formal music training / without | 12.9 / 19.5 | 1/16 / 1/10 | same |
| Same, worst 5% | 77.4 | about 2/5 | same |
| Non-musicians matching with a slider (target replayable) | 13 | 1/15 | Hutchins, Larrouy-Maestri & Peretz 2014 (doi 10.3758/s13414-014-0732-1) |
| Non-musicians matching by singing | 38 | 1/5 | same |
| Lab difference limens by frequency: 125 / 250 / 500 / 1000 Hz | 43–52 / 17–19 / 6–10 / ~6 | 1/5–1/4 / ~1/11 / 1/33–1/20 / 1/33 | arXiv 2307.00084, Table 1 |

Caveats to keep in mind: discrimination thresholds are not the same thing as matching errors; matching from memory, which is what Pitch Dial measures, adds error; and accuracy in cents gets much worse below about 250 Hz. The summary screen shows the 13¢ slider benchmark in dial mode and the 38¢ singing benchmark in singing mode.

## The player so far

First dial game (5 rounds, mostly low targets of 158–492 Hz): average miss **10.4 cents (≈ 1/19 of a tone)**, scoring 424 out of 500. Three of the five rounds were within 6¢. Four of the five misses were flat, which is worth watching as a possible bias.

## Ideas for next steps

1. Test singing mode with a real mic in Chrome, Edge, Firefox and Safari, including iOS Safari as an installed app. Tune the RMS gate (0.006), the confidence cut-off (0.8) and the hold time (1.2 s) against real voices.
2. Add a sharp/flat bias stat to the summary, such as the mean signed cents and the count of high vs low misses.
3. Put the research benchmarks on the summary as markers on a scale, so the player sees where their average falls.
4. Split results by frequency band (below 250 Hz vs above), because low notes are harder.
5. Add a history across games (per-viewer localStorage) with a small trend chart.
6. Offer an optional sung-vowel or complex timbre for the target, since a pure sine is hard to sing back.
7. Self-host the two font files if you want no third-party requests (for privacy, or a stricter CSP).
