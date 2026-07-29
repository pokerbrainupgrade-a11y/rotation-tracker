#!/usr/bin/env node
/**
 * Fails the build on any hardcoded hex colour outside tokens.css.
 *
 * tokens.css is the single source of truth for colour. A stray #D20A0A in a
 * component is how a "warning" ends up the same red as the primary action —
 * the one confusion this design explicitly cannot afford.
 *
 * Scope is deliberately wider than the spec's src/components + src/screens:
 * the rule is "nowhere outside tokens.css", so lib, hooks, dev and the other
 * stylesheets are checked too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname — the repo path contains a space, which
// pathname leaves percent-encoded and readdirSync cannot open.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['src'];
const ALLOW = [join('src', 'styles', 'tokens.css')];
const EXT = new Set(['.ts', '.tsx', '.css', '.js', '.jsx']);

// 3, 4, 6 or 8 digit hex colours. Ignores things like `#1` or an id selector.
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

const problems = [];

for (const base of SCAN) {
  const abs = join(ROOT, base);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    if (ALLOW.includes(rel)) continue;
    if (!EXT.has(file.slice(file.lastIndexOf('.')))) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Skip SVG path data, which legitimately contains no colours but can
      // contain '#' in rare encodings, and skip comment-only mentions.
      const matches = line.match(HEX);
      if (!matches) return;
      for (const m of matches) {
        // A bare 3-8 char hex that is actually a colour literal.
        if (!/^#[0-9a-fA-F]{3}$|^#[0-9a-fA-F]{4}$|^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{8}$/.test(m)) {
          continue;
        }
        problems.push(`${rel}:${i + 1}  ${m}   ${line.trim().slice(0, 90)}`);
      }
    });
  }
}

if (problems.length > 0) {
  console.error(
    `\nHardcoded hex colours found outside ${ALLOW.join(', ')}:\n`,
  );
  for (const p of problems) console.error('  ' + p);
  console.error(
    `\n${problems.length} problem(s). Move the colour into src${sep}styles${sep}tokens.css ` +
      'and reference it with var(--name).\n',
  );
  process.exit(1);
}

console.log('check-hex: no hardcoded hex colours outside tokens.css');
