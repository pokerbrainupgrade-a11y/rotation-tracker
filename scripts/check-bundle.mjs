#!/usr/bin/env node
/**
 * Bundle size gate. Fails the build over the budget.
 *
 * The budget exists because this app has to boot from cache on a phone with no
 * signal. Every kilobyte is one more thing that has to have been cached
 * correctly before you needed it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const BUDGET_KB = 150;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Everything the browser must download to boot: JS + CSS + HTML.
const COUNTED = new Set(['.js', '.css', '.html']);

let total = 0;
const rows = [];
for (const file of walk(DIST)) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!COUNTED.has(ext)) continue;
  // Service worker internals are cache plumbing, not app payload, but they do
  // ship — count them rather than flatter the number.
  const gz = gzipSync(readFileSync(file)).length;
  total += gz;
  rows.push([file.replace(DIST + '/', ''), gz]);
}

rows.sort((a, b) => b[1] - a[1]);
for (const [name, gz] of rows) {
  console.log(`  ${(gz / 1024).toFixed(2).padStart(8)} kB gz  ${name}`);
}

const totalKb = total / 1024;
console.log(`\n  TOTAL: ${totalKb.toFixed(2)} kB gzipped (budget ${BUDGET_KB} kB)`);

if (totalKb > BUDGET_KB) {
  console.error(`\ncheck-bundle: OVER BUDGET by ${(totalKb - BUDGET_KB).toFixed(2)} kB\n`);
  process.exit(1);
}
console.log('check-bundle: within budget\n');
