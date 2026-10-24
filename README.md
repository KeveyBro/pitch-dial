# Pitch Dial

An ear-training game. It plays a target tone and you match it, either by turning a tuning dial or by singing. Each round shows how far off you were in hertz, as a fraction of a tone, and in cents.

It's a static web app: plain HTML, CSS and JavaScript modules in `public/`, with no build step, no backend and no dependencies. It installs as an app on phones and desktops, and it works offline after the first visit.

## Run it locally

```bash
npm run dev
```

Then open http://localhost:8080. The microphone works there because browsers treat `localhost` as secure. To use another port, set `PORT` first: `$env:PORT=3000; npm run dev` in PowerShell, or `PORT=3000 npm run dev` in bash.

```bash
npm test
```

The tests cover the scoring maths and pitch detection using synthetic voices. You need Node 18 or newer.

## Host it

Upload the `public/` folder to any static host. **It must be served over HTTPS**, because browsers only allow microphone access and service workers on secure pages. All the hosts below give you HTTPS automatically.

| Host | How |
|---|---|
| **Netlify** | Drag the `public` folder onto https://app.netlify.com/drop. Or connect a Git repo, leave the build command empty and set the publish directory to `public`. |
| **Cloudflare Pages** | Connect a Git repo, leave the build command empty and set the output directory to `public`. Or run `npx wrangler pages deploy public`. |
| **GitHub Pages** | Push to GitHub, then go to Settings → Pages and set Source to "GitHub Actions". `.github/workflows/pages.yml` runs the tests and deploys `public/` on every push to `main`. |
| **Anything else** | Serve `public/` as static files. |

On Netlify and Cloudflare Pages, `public/_headers` adds a Content-Security-Policy, a Permissions-Policy that allows the microphone for this site only, and a no-cache rule for the service worker. Other hosts ignore that file, and the app works without it.

The app uses relative paths, so it works at a domain root or under a subpath such as `user.github.io/pitch-dial/`.

## Project layout

| Path | What it is |
|---|---|
| `public/` | The whole site. This is the folder you deploy. |
| `public/js/` | `main.js` (game flow and UI), `maths.js` (scoring), `pitch.js` (YIN pitch detection), `audio.js` (tone output), `mic.js` (microphone), `canvas.js` (dial drawing). |
| `public/sw.js` | Service worker for offline use. |
| `tools/serve.js` | Dev server. It applies `public/_headers` so you test with the production CSP. |
| `tools/make-icons.js` | Regenerates `public/icons/` (`npm run icons`). |
| `tests/test-pitch.js` | Headless tests. |

`HANDOFF.md` has the design notes, the scoring and detection rules, and the research benchmarks.
