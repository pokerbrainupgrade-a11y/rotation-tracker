#!/usr/bin/env node
/**
 * Precache coverage gate.
 *
 * Asserts every built asset appears in the Workbox precache manifest. A missing
 * entry is invisible until the one time it matters — the first offline launch
 * after a deploy, standing somewhere with no signal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');

// Assets that legitimately are not precached: the worker itself and its
// runtime, plus the registration shim that loads before it.
const EXEMPT = [/^sw\.js$/, /^workbox-[a-f0-9]+\.js$/, /^registerSW\.js$/];

const missing = [];
for (const file of walk(DIST)) {
  const rel = file.replace(DIST + '/', '');
  if (EXEMPT.some((re) => re.test(rel))) continue;
  if (!/\.(js|css|html|png|svg|woff2|json|webmanifest)$/.test(rel)) continue;
  if (!sw.includes(rel)) missing.push(rel);
}

if (missing.length > 0) {
  console.error('\ncheck-precache: assets NOT in the precache manifest:\n');
  for (const m of missing) console.error('  ' + m);
  console.error('\nThese would 404 on an offline launch.\n');
  process.exit(1);
}
console.log('check-precache: every build asset is precached');
