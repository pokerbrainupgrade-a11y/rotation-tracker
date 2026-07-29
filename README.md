# Rotation Tracker

Offline-first personal strength & conditioning log built on a rolling rotation
model. Mobile only, portrait only, installs to the iPhone home screen.

**Live:** https://pokerbrainupgrade-a11y.github.io/rotation-tracker/

---

## Status

**Phase 1 — data layer.** Typed, versioned, migratable IndexedDB layer with a
lossless export/import round trip. No UI: the app still shows five empty tabs,
which is the correct outcome. The layer boots on launch (migrate → seed →
profile → request persistence) so it actually runs on the device.

Phase 0 (deployable shell) is live with CI green. Verified: Actions green ·
site serves · service worker activated in scope · manifest `scope`/`start_url`
both `/rotation-tracker/` · shell precached.
**Still outstanding: the iPhone Airplane-Mode test (check 5 below).**

### ⚠️ The program seed is a placeholder

`src/data/program.seed.json` is a **structural placeholder, not a training
prescription**. It exists so the schema, validation and tests are exercisable.
The real program definition has not been supplied.

Exercise, lift, template, block, tag and test IDs are a **permanent contract**
the moment a session is logged against them — a `setLog` holds `exerciseId` as
a foreign key forever. **Replace this file before logging any real training.**
See "Replacing the placeholder seed" below.

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

## Data layer

```
src/data/
├─ schema.ts        IndexedDB store + index shapes
├─ migrations.ts    versioned migration registry (idempotent, additive only)
├─ db.ts            open/close/delete + hard failure states
├─ dates.ts         PURE local-date helpers, clock injected
├─ seed.ts          program.seed.json → static stores, with validation
├─ repo.ts          typed CRUD; cascade delete lives here
├─ backup.ts        export / prepare+commit import / CSV
├─ persistence.ts   navigator.storage.persist + honest reporting
├─ boot.ts          launch sequence + console debug handle
└─ program.seed.json  ⚠️ PLACEHOLDER — see above
```

### Decisions that are expensive to reverse

| Decision | Rule |
| --- | --- |
| Dates | Every user record stores both `localDate` (YYYY-MM-DD, local) and `ts` (epoch ms). `localDate` is the ledger key; `ts` orders only. |
| IDs | Exercise/template/block/lift/tag/test IDs are permanent. Never rename, never reuse, never delete — set `deprecated: true` instead. |
| Versioning | `SCHEMA_VERSION` governs IndexedDB structure. `SEED_VERSION` governs program content. Independent counters. |
| Reseeding | Replaces static stores only. Never touches user stores. |
| Backups | User stores only; static stores reseed from code on import. |
| Deletion | Deleting a `ScheduledSession` cascades to its `setLogs` and `esdLogs` in one transaction. No orphans, ever. |

### The 28-day window

`isWithinLast(n, localDate, now)` is **inclusive of today** and spans exactly
`n` distinct calendar days — today plus the previous `n-1`. Future-dated
records are excluded. All date arithmetic goes through the local-midnight
constructor, never epoch offsets: subtracting `n * 86_400_000` ms drifts by an
hour across a DST boundary, which silently changes the calendar day for
anything logged near midnight. `tests/unit/dates.test.ts` pins that bug.

Unit tests run with `TZ=America/New_York` (set in `vitest.config.ts`) so the
DST cases actually execute — a UTC-only CI box would never exercise them.

### Replacing the placeholder seed

1. Edit `src/data/program.seed.json` with the real program definition.
2. Bump `SEED_VERSION` in `src/types.ts`.
3. `npm run test:unit` — the seed's referential integrity is validated on load,
   and a dangling reference throws rather than producing wrong prescriptions.

Reseeding replaces static stores only; training history is untouched. If any
real training has already been logged, do **not** change existing IDs — add new
entries and mark retired ones `deprecated: true`.

### Verifying on the phone (Phase 1 has no Settings screen)

Connect the iPhone to macOS Safari → Develop → your device → the installed PWA,
then in the console:

```js
await __rotation.boot()                  // { ok, seeded, persisted }
await __rotation.storage.status()        // durability + usage/quota
await __rotation.profile()
const b = await __rotation.backup()
await b.downloadBackup()                 // opens the iOS share sheet
await b.prepareImport(text)              // preview: what a restore destroys
```

`prepareImport` never writes — it returns `{ destroys, incoming, migrated }`
for the destructive-replace confirmation. `commitImport(plan)` performs the
replace in a single transaction.

Storage durability is reported honestly: `persisted: false` means best-effort
and the browser may evict. It is never presented as safe when it is not.

## Engine layer (Phase 2)

```
src/engine/
├─ rotation.ts     free-floating sequencing, deferral, layoff/re-entry
├─ ledger.ts       28-day rolling counts  (100% branch, enforced)
├─ constraints.ts  seven ordering warnings, always an array
├─ load.ts         %1RM resolution, bar rounding, plate math
└─ blocks.ts       NOT BUILT — see below
```

**Everything here is a pure function over plain data.** No IndexedDB, no DOM,
no `Date.now()`, no bare `new Date()` — the clock is always an injected
argument. This is what makes DST, midnight and timezone-shift cases testable,
and those are where rolling-window counters break silently.

`eslint.config.js` enforces it: clock reads, `Math.random`, DOM/storage globals
and IO imports are all errors inside `src/engine/`. `npm run lint` runs in CI
before the tests. `src/data/dates.ts` is the one `src/data` import allowed —
it is pure and clock-injected.

Coverage thresholds in `vitest.config.ts` pin `ledger.ts` and `rotation.ts` at
100% branch. A dropped branch fails the run, it does not merely get reported.

### The ledger rule

A session counts for a quality only if what was actually **logged** earned it.
A TD1 whose throw block was cut is not a TD1 and does not count. Counting
sessions by template would over-count, and over-counting makes frequency drift
invisible — which is the entire purpose of the ledger.

Substituted sessions are judged on `metDosingSignature` instead, because the
logged movements will not match the template's.

### blocks.ts is deliberately absent

`resolveDose()` needs program data that has never been supplied: per-exercise
dose definitions, element classification (max-intent throw / grind / ballistic
/ plyo), per-block multipliers, the compression cut map for 100/75/50/25, and
the `ResolvedDose` type itself. Inventing those would be writing a training
prescription. Supply them and the module is a short build.

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
