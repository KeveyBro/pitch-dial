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
| `public/samples/` | Recorded instrument notes (16-bit mono WAV at 22.05 kHz, 5.6 MB in all) plus `index.json` (each note's measured pitch, loop points and gain). Generated; don't edit by hand. |
| `tools/build-samples.js` | Downloads the recordings from VSCO 2 Community Edition, measures and loops them, and writes `public/samples/`. See "Recorded instruments". |
| `tests/test-pitch.js` | Headless tests for the scoring maths, YIN, the tracker, recording analysis (using synthetic voices), instrument ranges and the sample set. It imports the modules directly. |
| `.github/workflows/pages.yml` | Optional GitHub Pages deploy: it runs the tests, then publishes `public/`. |

```bash
npm run dev      # http://localhost:8080
npm test
npm run icons
npm run samples  # rebuilds public/samples/ (downloads ~270 MB into a temp folder the first time)
```

`package.json` exists only for these scripts and `"type": "module"`. There are no dependencies. Node 18+ is enough.

## Microphone

`getUserMedia` only works in a secure context: HTTPS, or `localhost` during development. On any HTTPS host, every visitor gets live singing input after a one-time permission prompt for that site.

The page asks for the mic when a singing game starts. If the mic is refused, missing, or the prompt is left for 20 seconds, it switches to upload mode on its own. In upload mode the player records the note in any voice-memo app and uploads it, and the page analyses the file offline. The "Hear the target again" button exists only in upload mode.

Live input has been checked in Chromium by swapping `getUserMedia` for a synthetic sawtooth voice (196 Hz with ±20¢ vibrato). It was detected as 196.24 Hz and locked in about 2 seconds. Upload mode was checked by forcing a permission refusal. **A real voice through a real microphone is still untested.**

## Offline and caching

`sw.js` caches the app on first visit, and each instrument family's recordings the first time that family is used. App files are network-first, so a new deploy shows up on the next load without bumping a version; the cache is only used when the network fails. Google Fonts files are cache-first because their URLs never change. Bump `CACHE` in `sw.js` only when the caching logic itself changes. The service worker is registered only in a secure context.

## How the code is organised

The modules have one job each, and only `main.js` touches the DOM outside the canvases.

1. **maths.js**: `centsBetween`, `round2`, `logRandom`, `unitWord`, `fractionText` (the "≈ 1/x of a tone" wording), `fractionShort`, `noteLabel`, `points`, `grade`, `describe`, `foldOctave`, `NAMES`.
2. **pitch.js**: `FMIN`/`FMAX` (60–1100 Hz), `rms`, `yin(buf, sr, thresh, fmin, fmax)` (threshold 0.15, parabolic interpolation; the range defaults to `FMIN`–`FMAX`), `medianOf`, `makeTracker()`, `analyzeRecording(audioBuffer)`.
3. **audio.js**: a shared `AudioContext` and master gain. `playTone(freq, dur, delay, inst)` handles one-shot tones, and `startTuner(freq, on, inst)`/`setTunerFreq`/`setTunerOn`/`stopTuner` handle the dial's continuous tone. `INSTRUMENTS`, `FAMILIES`, `pickInstrument(family, freq)` and `familyInstruments(family)` define the sounds (see "Sound families" below). `loadSamples(keys)` fetches and decodes recordings; until they arrive, an instrument plays its synth voice. `buildNote(ctx, inst, freq, dest)` builds one note in any context, including an `OfflineAudioContext`, which is how pitch and loudness were checked. `setVolume(0–1)` maps volume as `0.5 × v²`, and the master runs through a peak limiter (threshold −3 dB) that only acts near full volume. `audioContext()` returns the context, or null before the first `ensureAudio()`.
4. **mic.js**: `openMic` (needs `ensureAudio()` first), `readMic` (the latest frame, in a reused buffer), `micOpen`, `closeMic`. Echo cancellation, noise suppression and AGC are turned off. The analyser is connected to a zero-gain sink so it keeps processing.
5. **canvas.js**: `readTokens` reads the CSS colour tokens so the canvases follow the theme. `drawDial(canvas, freq, lo, hi, dim)` draws the amber dial at 1 px = 1 cent, with semitone ticks labelled with note name and Hz. `drawScope(canvas, t, amp)` draws the listen-screen wave.
6. **main.js, game flow**: phases are `setup → listen → tune | sing → result → … → summary`. Each async step captures `flow` and stops if it has changed; anything that leaves a phase does `flow++`.
7. **main.js, input handlers**: the dial (drag, wheel, keys, coarse slider, hold-to-repeat nudge buttons), singing (live loop, upload, skip, best attempt) and the setup form.

### Sound families

The Sound setting picks a family: Sine, Keyboard, Strings, Woodwinds, Brass, Voices, Percussion or Random. Within a family, each note goes to the instrument whose range it sits in, so every family covers the game's 60–2000 Hz:

| Family | Instruments, low to high (band edges) |
|---|---|
| Keyboard | Piano across the whole range |
| Strings | Double bass < G2 (98 Hz) · Cello < A3 (220) · Viola < G4 (392) · Violin |
| Woodwinds | Bassoon < E3 (165) · Clarinet < G4 (392) · Oboe < G5 (784) · Flute |
| Brass | Tuba < G2 (98) · Trombone < G3 (196) · French horn < D♯4 (311) · Trumpet |
| Voices | Bass < D3 (147) · Tenor < C4 (262) · Alto < A4 (440) · Soprano |
| Percussion | Marimba < C5 (523) · Xylophone < C6 (1047) · Glockenspiel |
| Random | A random family (never Sine) for each round |

- The instrument is picked once per round from the target. The dial tone and all the Hear buttons in that round use it too, so the dial never changes instrument at a band edge and gives away where the target is. The listen screen and the result's Target label name the instrument.
- Test sound plays one note per instrument, low to high. With Random it plays A4 in each family. Picking a family starts loading its recordings; Test sound and Start wait for them (up to 8 s), showing "Loading sounds…" if it takes more than 100 ms.
- Every instrument except the voices plays recordings (see below). Each also has a synth voice: a harmonic spectrum (a `PeriodicWave`), so its waveform repeats at the fundamental and its pitch is exactly the target. The synth plays while recordings load, if they fail, and always for the voices, which add fixed "ah" formants (Csound formant tables). Synth percussion strikes, then settles to a long ring at 65% of the peak. (A mallet-roll tremolo was tried and dropped: the player preferred a plain sustained ring.) In Chromium, YIN read every synth instrument within 0.33¢ of the target. Synth loudness: steady tones 1.5 dB under the sine's RMS at the same pitch, struck tones sustaining 5 dB under it.

### Recorded instruments

- **Source:** [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/) by Versilian Studios, CC0 (public domain), from `github.com/sgossner/VSCO-2-CE` pinned at commit `4403009`. No credit is required, but the app's help text names it. Neither VSCO nor its companion library VCSL has singers, so Voices stay synthesised.
- **Which recordings:** sustained notes at one dynamic per instrument. Strings: solo double bass (no vibrato), and cello, viola and violin sections, which have vibrato but several players blend it into a steadier pitch. The violin section stops at D6, so the solo violin covers E6 and up; `SOURCES` gives each folder a measured-pitch range for that. Woodwinds: bassoon, clarinet, oboe, flute (no vibrato). Brass: tuba, tenor trombone, French horn, trumpet. Keyboard: upright piano (mf). Percussion: marimba, xylophone, glockenspiel. 100 notes in all, roughly every 3–5 semitones.
- **The library's note names can't be trusted.** Most folders are labelled an octave low (its "E0" double-bass note is really E1). Only the violin, piano and xylophone are named correctly. So every recording's pitch is measured, and the name only seeds the search.
- **Playback:** a note uses the recording nearest its pitch, played faster or slower (`playbackRate = target / measured pitch`). It keeps the recording's real attack, then loops a flattened, crossfaded stretch, so it can sustain for as long as needed. Sustained instruments loop 1 s from 0.5 s in. Struck instruments loop 0.5 s from where the ring has fallen to 40% of its peak, so they ring on steadily rather than fading. When the dial moves more than about a semitone closer to another recording, the tuner crossfades to it (joining in its loop, past its attack).
- **How pitch is measured** (this took several rounds to get right):
  - The build simulates playback (the attack, then the loop repeating) and measures over exactly two whole loops, with YIN refined over about 25 ms of cycles. Whole loops matter: a listener averages vibrato over the whole note, and a window that cut a loop short tipped uneven vibrato by up to 12¢.
  - The glockenspiel uses its spectral peak instead. Its far-from-harmonic overtones (about ×2.8 and ×5.4) threw period estimates off by up to 17¢.
  - The piano keeps YIN. Its spectral peak put low notes up to 9¢ flat, because what we hear follows the waveform's period, and the low strings' overtones are slightly stretched.
  - A real instrument's pitch isn't one number. Different reasonable methods disagreed by up to 25¢ on the low piano and the vibrato violin, and only agreed within 1¢ on steady tones. The game's definition is therefore "what its own pitch detector measures", the same detector that scores singing.
- **Checked in Chromium** by rendering each instrument across its band with `buildNote`. Every instrument came within 3¢ of the target at several moments, including after the loop wraps. The violin is measured over whole loops. Its section notes come within 2.7¢, with half-second slices varying by at most 8¢. The solo notes above D6 come within 3.7¢, though slices wander up to 20¢. The solo violin was first used across the whole range, where slices wandered up to 16¢ and one note was 7¢ off; that's why the section replaced it. Loudness matches the synth balance (steady −1.5 dB, struck −5 dB against the sine), except the piano at −5.8 dB, held down by the gain cap of 3.
- **Stretch limits:** most notes are within 3.6 semitones of a recording. Two edges stretch further and may sound unnatural. The marimba stretches 6.5 semitones down to 60 Hz (its lowest recording is F2). The trumpet stretches up to 11 semitones above C6, its top recording, to reach 2000 Hz. The French horn hands over to the trumpet at D♯4 because the horn has no recordings between C4 and D5. `tests/test-pitch.js` checks these limits.
- **Not yet done:** listening to every sound with real ears. VSCO 2 CE has no non-vibrato cello, viola or violin sustains. If steadier strings are wanted, try another source, such as the University of Iowa samples, or flatten the vibrato in the build.
- **Default sound:** Sine is the default for a new visitor, and no recordings load until a family is picked. Each browser remembers its last choice, along with the other settings.

### Scoring rules

- The target and the answer are both rounded to 0.01 Hz before comparing, so the Hz shown always matches the arithmetic.
- `cents = 1200 · log2(answer / reference)`. The fraction is `|cents| / unit`, where unit is 200 for a whole tone or 100 for a semitone. Below 0.6 of a unit it's shown as `1/round(unit/|cents|)`; at 0.6 or above it's shown as a decimal.
- Points per round: `round(100 · e^(−|cents|/60))`.
- Grades: under 5¢ Excellent, under 15¢ Very close, under 40¢ Close, under 100¢ Off, otherwise Way off.
- In singing mode with "Count the same note in any octave" on, the reference becomes `target · 2^k`, where `k = round(cents / 1200)`. Hz-off is measured against that octave-shifted reference.
- Missed or skipped rounds score 0 and are left out of the averages.
- The summary's Average miss tile leads with the average fraction of a tone and cents. Its Hz figure, in the small text, scales each round to 440 Hz first (`|Hz-off| · 440 / reference`), so a high note's bigger Hz gap doesn't outweigh an equally bad low note, and it's labelled "at 440 Hz". The table and the closest-round tile show raw Hz, since each covers one pitch.

### Singing detection

- The live loop analyses a 2048-sample frame (4096 above 50 kHz) every 30 ms or more. A frame counts as voiced when its RMS is above 0.006 and YIN confidence is above 0.8.
- `makeTracker({hold: 1.2, win: 0.4, tol: 50})`: over a 0.4 s window, at least 70% of frames must be voiced, and at least 80% of the voiced frames must sit within ±50¢ of their median. Once that steadiness lasts 1.2 s, the note locks to the median of the frames in the held run. The ±50¢ tolerance is there so normal vibrato still counts as steady.
- `analyzeRecording` halves the sample rate when it's 32 kHz or more, analyses at most 30 s, uses a gate of 5% of the file's peak, and returns the longest steady run of at least 0.5 s.
- Verified only on synthetic signals: harmonic-rich voices from 98 to 523 Hz, ±30¢ vibrato, jitter, noise, an upward scoop into the note, and a slide (which correctly doesn't lock). **It has not been tested with a real microphone and a real voice yet.**

### Storage (localStorage, every access wrapped in try/catch)

- `pitchdial.settings`: answer mode, listen time, time limit, rounds, ranges, unit, sound family (`timbre`), octave fold and volume. A saved value that no longer matches an option falls back to the default.
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
6. Done: instrument families (see "Sound families"). Next, consider showing the instrument in the summary table, and splitting bests by family, since some timbres may be easier to match than others.
7. Self-host the two font files if you want no third-party requests (for privacy, or a stricter CSP).
