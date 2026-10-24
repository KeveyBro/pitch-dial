# Pitch Dial

An ear-training game. It plays a target tone and you match it, either by turning a tuning dial or by singing. Each round shows how far off you were in hertz, as a fraction of a tone, and in cents.

It's a web app: plain HTML, CSS and JavaScript modules in `public/`, with no build step. It installs as an app on phones and desktops, and it works offline after the first visit. A small Cloudflare Worker adds community results: games are shared anonymously (players can turn this off), and each summary compares the player with everyone else and with published research. Each mode starts with 50 research-modelled games, always labelled as such, so the comparison works from launch; they drop out once a mode has 100 real games.

## Run it locally

```bash
npm install
```

You only need this once. It installs wrangler, Cloudflare's tool for running and deploying the Worker.

```bash
npm run dev
```

Then open http://localhost:8787. This runs the game, the results API and a local practice database. The first time, it asks to set up the database tables; answer yes. The microphone works there because browsers treat `localhost` as secure.

```bash
npm test
```

The tests cover the scoring maths, pitch detection using synthetic voices, the instruments and recordings, and the community results' checks and statistics. You need Node 20 or newer.

To run the game alone, without the results API, use `npm run dev:static` and open http://localhost:8080.

## Host it

**Cloudflare Workers** (the full app, with community results). In the Cloudflare dashboard, open **Workers & Pages**, select **Create application**, and import this GitHub repo. Set the deploy commands:

| Branch | Deploy command |
|---|---|
| `main` (production) | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |
| Other branches (previews) | `npx wrangler d1 migrations apply DB --remote --env preview && npx wrangler deploy --env preview` |

First create the two D1 databases (`npx wrangler d1 create pitch-dial-results` and `npx wrangler d1 create pitch-dial-results-preview`), and put their IDs in `wrangler.jsonc`. Previews deploy to a separate Worker with its own database, so testing never mixes into the real results.

**Any static host** (the game only, without community results). Upload `public/` to Netlify, GitHub Pages or similar; `.github/workflows/pages.yml` does this for GitHub Pages. The summary then compares players with the research only. **It must be served over HTTPS**, because browsers only allow microphone access and service workers on secure pages.

`public/_headers` adds a Content-Security-Policy, a Permissions-Policy that allows the microphone for this site only, and a no-cache rule for the service worker. Cloudflare and Netlify read it; other hosts ignore it, and the app works without it. The app uses relative paths, so it works at a domain root or under a subpath.

## Project layout

| Path | What it is |
|---|---|
| `public/` | The whole site. This is the folder you deploy. |
| `public/js/` | `main.js` (game flow and UI), `maths.js` (scoring), `pitch.js` (YIN pitch detection), `audio.js` (tone output), `mic.js` (microphone), `canvas.js` (dial drawing), `community.js` (community results logic, shared with the Worker). |
| `public/sw.js` | Service worker for offline use. |
| `worker/index.js` | The results API, run by Cloudflare Workers. |
| `migrations/` | The results database's tables. |
| `wrangler.jsonc` | Cloudflare config. |
| `tools/serve.js` | Static dev server for the game alone (`npm run dev:static`). It applies `public/_headers`. |
| `tools/make-icons.js` | Regenerates `public/icons/` (`npm run icons`). |
| `public/samples/` | Recorded instrument notes, about 5.6 MB in all. Each family loads only when it's picked. |
| `tools/build-samples.js` | Rebuilds `public/samples/` (`npm run samples`). It downloads about 270 MB of source recordings into a temp folder the first time. |
| `tests/test-pitch.js` | Headless tests. |

`HANDOFF.md` has the design notes, the scoring and detection rules, and the research benchmarks.

## Credits

Instrument recordings come from [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/) by Versilian Studios, released under CC0 (public domain).
