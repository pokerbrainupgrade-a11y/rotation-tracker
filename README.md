# Rotation Tracker

Offline-first personal strength & conditioning log built on a rolling rotation
model. Mobile only, portrait only, installs to the iPhone home screen.

**Live:** https://pokerbrainupgrade-a11y.github.io/rotation-tracker/

---

## Status

**Phase 0 — deployable empty shell. Live, CI green.** No data layer, no
features. Five labeled tabs and a placeholder heading each. The point of this
phase is to prove the pipeline (build → test gate → Pages deploy → installable
→ offline) before any data exists that could be lost.

Verified: Actions green · site serves · service worker activated in scope ·
manifest `scope`/`start_url` both `/rotation-tracker/` · shell precached.
**Still outstanding: the iPhone Airplane-Mode test (check 5 below).**

---

## Stack

Vite · TypeScript (strict) · Preact · idb · vite-plugin-pwa (Workbox) ·
Vitest (unit) · Playwright (e2e).

No React proper, no charting library, no CSS framework.

---

## Commands

```bash
npm install       # once
npm run dev       # local dev server
npm run test:unit # Vitest — this gates deploy
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build locally
```

---

## The four paths that must match

A base-path mismatch is the single most common way this app breaks. The app
still loads, but the service worker 404s and offline is silently dead.

| Setting | Value | File |
| --- | --- | --- |
| Vite `base` | `/rotation-tracker/` | `vite.config.ts` |
| Manifest `scope` | `/rotation-tracker/` | `vite.config.ts` |
| Manifest `start_url` | `/rotation-tracker/` | `vite.config.ts` |
| Workbox `navigateFallback` | `/rotation-tracker/index.html` | `vite.config.ts` |

All four need both leading and trailing slashes. If offline breaks, check these first.

---

## Project constraints

These hold for every phase, not just this one.

- **TypeScript strict. No `any`.**
- **`src/engine/` is pure functions over plain data.** No IndexedDB, no DOM, no
  `Date.now()` — pass the clock in as an argument. This is what makes the ledger
  math testable.
- Bundle under 150kb gzipped.
- Portrait only, mobile only, 390–430px. No desktop layout.
- Motion ≤120ms, `opacity`/`transform` only.
- All numerals `font-variant-numeric: tabular-nums`.
- Minimum tap target 56px.
- `--brand` red is **primary actions only** — never warnings or errors. Those
  use `--alert` amber-orange.
- All color comes from `src/styles/tokens.css`. No hardcoded hex anywhere else.

---

## Updates are prompted, not automatic

`registerType: 'prompt'` is deliberate. It is what makes an "export your data
before updating" flow possible later. Do not change it to `autoUpdate` — this
app holds training history that cannot be recreated.

---

## Recovery runbook

> **Stub — fill in as real failures occur.**

### Deploy went red

1. Repo → **Actions** → open the failed run.
2. Failed on `npm run test:unit`? A test is broken. Deploy is *supposed* to be
   blocked. Fix the test, don't bypass the gate.
3. Failed on `npm run build`? Almost always a TypeScript error — `npm run build`
   runs `tsc --noEmit` first. Reproduce locally.
4. Failed on `actions/deploy-pages`? Confirm Settings → Pages → Source is
   **GitHub Actions**, not "Deploy from a branch".

### App loads but offline doesn't work

Nearly always a base-path mismatch. Verify the four paths in the table above,
then:

1. DevTools → Application → **Service Workers** — should read *activated and
   running*. If it 404s, the scope is wrong.
2. DevTools → Application → **Manifest** — `scope` and `start_url` both
   `/rotation-tracker/`.
3. On iPhone, a stale install can pin an old service worker. Delete the home
   screen icon, clear Safari website data for the domain, re-add.

### Push rejected: "refusing to allow an OAuth App to create or update workflow"

The saved git credential is an OAuth App token without the `workflow` scope, so
it cannot push any change to `.github/workflows/`. Everything else pushes fine.
This will recur every time `deploy.yml` is edited.

Workarounds, cheapest first:

1. **Edit `deploy.yml` in the GitHub web UI**, then `git pull --rebase`. Fine
   for the rare workflow tweak.
2. **Push that one file via GitHub Desktop**, which holds its own token with
   `workflow` scope.
3. **Replace the stored credential** with a token that has `workflow` scope
   (GitHub → Settings → Developer settings → Personal access tokens). Then
   `git credential-osxkeychain erase` the old one. Do this only if workflow
   edits become frequent — a token that can rewrite CI is worth keeping scarce.

To create a workflow file from a local copy without retyping it in the browser,
URL-encode the contents into the new-file editor:

```bash
python3 -c "import urllib.parse;c=open('.github/workflows/deploy.yml').read();print('https://github.com/pokerbrainupgrade-a11y/rotation-tracker/new/main?filename='+urllib.parse.quote('.github/workflows/deploy.yml',safe='')+'&value='+urllib.parse.quote(c,safe=''))"
```

### Data recovery

> To be written in Phase 1, alongside the export format. Until there is a data
> layer there is nothing to recover.

---

## Phase 0 definition of done

1. Actions run is green.
2. The Pages URL loads in a desktop browser.
3. Service worker shows **activated**.
4. Manifest panel shows no errors; `scope` and `start_url` both `/rotation-tracker/`.
5. **The one that matters:** iPhone → open URL in Safari → Share → Add to Home
   Screen → launch from the icon → enable Airplane Mode → force-quit → relaunch
   from the icon. The shell must load.

Checks 1–4 are how you diagnose check 5 when it fails.
