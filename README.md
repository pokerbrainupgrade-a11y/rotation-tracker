# Rotation Tracker

## 1. What this is

An offline-first training log for a rolling, free-floating strength &
conditioning rotation. It runs as a web app installed to an iPhone home screen,
stores everything on the device in IndexedDB, and needs no account, no server,
and no network once installed. Its central instrument is a 28-day rolling ledger
that counts what you *actually logged* rather than what you scheduled. Nothing
in it prescribes, prompts, or blocks — it shows you numbers and you decide.

**Live:** https://pokerbrainupgrade-a11y.github.io/rotation-tracker/
**Repo:** https://github.com/pokerbrainupgrade-a11y/rotation-tracker

---

## 2. Install

1. Open the live URL **in Safari**. Not Chrome.
2. Tap the **Share** button (square with an arrow, bottom centre).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.
5. **Launch it from the home screen icon**, not from a Safari tab.

**Why Safari specifically:** on iOS, only Safari can install a web app to the
home screen. Chrome and Firefox on iOS are Safari underneath but do not expose
"Add to Home Screen" for web apps.

**Why the icon and not a tab:** launched from the icon, the app runs standalone
— full screen, its own storage, and eligible for persistent storage. In a tab it
shares Safari's storage lifecycle and is far more likely to be evicted.

---

## 3. Restore from a backup

Do this after reinstalling, after eviction, or on a new phone.

1. Open the app from the home screen.
2. Go to the **Dashboard** and tap the **gear** icon (top right).
3. Tap **IMPORT BACKUP**.
4. In the file picker, find your backup. On iOS it will usually be in:
   - **Files → iCloud Drive → Downloads**, or
   - **Files → On My iPhone → Downloads**, or
   - wherever you saved it from the share sheet.
   The filename looks like `rotation-tracker-2026-08-17.json`.
5. Select it. A confirmation appears naming exactly how many records will be
   **destroyed and replaced**. Read that number.
6. Tap **REPLACE ALL DATA**.

**If the import fails**, the screen names which store and which record failed,
and states explicitly that nothing was changed. Your existing data is intact —
the whole import runs in one transaction, so it either fully applies or fully
rolls back.

**Backups contain your training history only** — sessions, sets, conditioning
logs, maxes, test results, profile. The program definition (exercises,
templates, blocks) is rebuilt from code on import, so a restore always lands on
the current program.

---

## 4. Roll back a bad deploy

If a deploy breaks the app, roll it back from any machine with the repo:

```bash
cd rotation-tracker
git log --oneline -10          # find the last good commit
git revert <sha>               # the bad commit's sha
git push origin main
```

Then:

1. Watch **Actions** in GitHub. The redeploy takes about two minutes.
2. On the phone, force-quit the app (swipe up from the app switcher).
3. Relaunch from the icon. It should pick up the rolled-back build.
4. If it still shows the broken version, you are seeing the cached service
   worker. Force-quit again — the waiting worker activates once all windows
   close.

**Do not** `git push --force` to undo a deploy. A revert is a new commit and
leaves the history intact; a force-push can strand the deployed build in a state
no commit describes.

---

## 5. Storage was evicted

**What you'll see:** a screen saying **YOUR DATA WAS REMOVED**.

**What happened:** iOS reclaims storage from web apps it considers unused,
typically after a few weeks without opening them. This is an OS policy, not a
bug, and not something the app can override.

**What reduces the risk:**

- Launch from the home screen icon, not a tab.
- Open the app at least every couple of weeks.
- Check **Settings → storage status**. If it says *Best-effort*, the browser
  declined persistent storage and eviction is more likely. *Persistent* means
  the app is protected from routine eviction.

**The restore path:** follow §3. This is the only recovery — evicted data is
gone from the device. Export regularly; the Dashboard shows how long it has been.

---

## 6. Updating

1. **Export first.** The app prompts you to, and you should accept.
2. When a new version has deployed, an **UPDATE AVAILABLE** banner appears at
   the top of the screen.
3. Tap **Update**. You are asked whether to export first — take
   **EXPORT AND UPDATE**.
4. The app reloads on the new version. Any database migrations run at that
   point.
5. Check **Settings** — it shows the current schema version.

**Why export first:** an update can run a migration, and a migration is the one
moment where a bug can touch every record you own. The export makes that
reversible.

**You do not need to delete and re-add the home screen icon.** That was
necessary in an earlier build; it is not now. The service worker hands over
cleanly when you tap Update.

If the banner never appears and you know a deploy went out, force-quit the app
and relaunch — that lets a waiting worker activate.

---

## 7. Airplane-mode verification

Run this after any deploy that you care about.

1. Open the app from the home screen and let it load fully.
2. Force-quit it (swipe up in the app switcher).
3. Turn on **Airplane Mode**.
4. Launch from the home screen icon.
5. **The Dashboard must render.** If you get a blank screen or a Safari error
   page, offline is broken — roll back (§4).
6. Still in Airplane Mode, start a session and log a set.
7. Force-quit again, relaunch, and confirm the set is still there.
8. Turn Airplane Mode off.

---

## 8. Versions

| | Current |
| --- | --- |
| `SCHEMA_VERSION` | **3** |
| `SEED_VERSION` | **3** |

`SCHEMA_VERSION` governs the IndexedDB structure and requires a migration to
change. `SEED_VERSION` governs program content and requires none — bumping it
replaces the program definition and never touches training data. They move
independently on purpose.

**Schema migrations**

| v | What it did |
| --- | --- |
| 1 | Created all stores and indexes: profile, maxes, scheduled, setLogs, esdLogs, tests, plus the static program stores. |
| 2 | Added `checklist` and `activeTimer` to scheduled sessions, so a mid-rest force-quit restores the timer. Backfilled on every existing row. |
| 3 | Added `trainingMode` to the profile. Backfilled to `false`. |

**Seed bumps**

| v | What it did |
| --- | --- |
| 1 | Initial program definition. |
| 2 | Added `higherIsBetter`, `group`, `powerMetric` and `kind` to test definitions, and added the power-metric and movement-screen tests. No migration; no data touched. |
| 3 | **Replaced the placeholder with the real program.** Every lift, exercise, template, block, tag and test id changed. No migration; no training data touched — but any history logged against the placeholder's ids is orphaned by it. |

**If the app is older than your data** you will see a blocking screen saying so.
Do not try to get past it — export from that screen, then update the app. An
older build writing to newer data can silently drop fields it does not know
about.

---

## 9. Architecture map

| Directory | What lives there |
| --- | --- |
| `src/engine/` | **Pure functions only.** No IndexedDB, no DOM, no clock reads — the clock is always passed in. ESLint enforces this. Ledger counting, rotation sequencing, constraints, timers, load and dose resolution, instrumentation, battery. |
| `src/data/` | Persistence. IndexedDB open/migrate, the repo (all reads and writes), backup export/import, the program seed and its validator, storage persistence, the version-skew guard. |
| `src/lib/` | UI-layer helpers with no persistence: colour mapping, chart geometry, route parsing, warning copy. |
| `src/hooks/` | Preact hooks wiring data to screens. |
| `src/components/` | Reusable UI. No colour literals — every colour is a `var()` from `tokens.css`. |
| `src/screens/` | One directory or file per screen. |
| `src/styles/` | `tokens.css` is the **single source of truth for colour**; CI fails on a hex literal anywhere else. |
| `src/dev/` | Dev-only state seeder. Stripped from production builds. |
| `tests/unit/` | Vitest, run under `TZ=America/New_York` so DST cases actually execute. |
| `tests/e2e/` | Playwright against the dev server (needs the state seeder). |
| `tests/e2e-prod/` | Playwright against the real built output — service worker and offline behaviour. |
| `scripts/` | CI gates: hex literals, bundle size, precache coverage. |

**Commands**

```bash
npm run dev            # dev server
npm run build          # typecheck, build, precache + bundle gates
npm run lint           # eslint + hex-literal gate
npm run test:unit      # vitest
npm run test:e2e       # playwright, dev server
npm run test:e2e:prod  # playwright, production build (offline + service worker)
```

---

## 10. The program

`src/data/program.seed.json` is the real program: five blocks, seven session
templates, twenty-four prescribed exercises plus generated prep and recovery
rows, six substitution tags and twenty-three tests.

It is **generated**, not hand-edited. `src/data/program.source.json` is the
program as written — sections as named groups, prose prep lists, doses as
strings like `"3/side"`, and one global deload table. The seed is that document
normalised into the shape the app reads: sections as an ordered list with roles
and foreign keys, every prep line as its own exercise, and loads as a numeric
`LoadSpec`.

**To change the program, edit `program.source.json`, regenerate, and bump
`SEED_VERSION`.** Editing the seed directly works but will be overwritten the
next time the source is regenerated.

1. Edit `src/data/program.source.json`.
2. Regenerate `src/data/program.seed.json` from it.
3. Bump `SEED_VERSION` in `src/types.ts`. **A content change without a version
   bump does nothing on an installed app** — `ensureSeeded()` only reseeds when
   the stored version is behind, so the phone keeps the old program silently.
4. `npm run test:unit`. The validator fails loudly on a dangling reference, and
   a separate test asserts the engine's cadence, gate and deload constants still
   equal the program's.

Reseeding replaces the program only. Training history is untouched.

### Known caveats in the current content

- **The KB swing load is written in kg (`32-40 kg`)** while the rest of the
  program is in pounds. It is stored as the bare numbers `32–40`, so it renders
  in whatever unit the profile is set to. Read it as kilograms regardless.
- **Doses that are not rep counts** — `15 yd`, `4 min`, `30s`, `10 contacts` —
  are stored as one effort with the literal prescription in `doseLabel`. The set
  row shows the real dose, not a misleading "1".
- **Block multipliers are a pass-through (1.0).** The program defines its deload
  policy once, globally, rather than per block, so there is nothing per-block to
  apply. The resolution order is still enforced and tested.
- **`TD-A` and `TD-B-ESD` are aliases** of `TD1` and `TD3` at 2:1 density. Their
  sections are copied from the parent at generation time, so the two cannot
  drift apart.

---

## Recovery runbook — quick index

| Situation | Section |
| --- | --- |
| New phone / reinstalled | §2, then §3 |
| "YOUR DATA WAS REMOVED" | §5 |
| Deploy broke something | §4 |
| "APP VERSION IS OLDER THAN YOUR DATA" | §8 |
| Update available | §6 |
| Verifying a deploy | §7 |
| Changing the program | §10 |
