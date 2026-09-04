#!/usr/bin/env node
// check-staging — a page builder's own pre-flight while Phase 1 shares the tree.
//
//   node scripts/check-staging.mjs .intents-staging/NeueBuchungPage.tsx
//   node scripts/check-staging.mjs .public-staging/Zimmeranfrage.tsx   [--public]
//
// In intents-pages mode the lanes may not run `tsc`, the gates or `npm run
// build`: one tsbuildinfo, one dist/, and a tree Phase 1 is still writing.
// So their first type check used to be the integration build — long after the
// lane was gone, and every slip cost a 170 s repair agent. This script is the
// one gate-shaped command the mode allows, because it touches nothing shared:
//
//   1. tsc --noEmit over THIS page and what it imports (the blocks, the journey
//      layer, the service, the types — NOT all of src/), through a throw-away
//      tsconfig at the project root (same compilerOptions as tsconfig.app.json,
//      no tsBuildInfoFile, incremental off). Scoped on purpose: a whole-tree
//      tsc took 60–120 s in the 2-vCPU sandbox next to Phase 1's own build,
//      and a lane iterating on it ran Phase 2A into its deadline (live
//      02.09.2026). Errors are split: the page's own are reported, errors in
//      the files it imports are Phase 1's business and only counted.
//   2. The page rules of check-intents / check-public on this one file
//      (`--file`): labels, declared steps, search fields, vSQL filter, the
//      journey-layer presence, import allowlist, … Wiring rules (App.tsx,
//      registry, surface) are the integration band's and are skipped.
//   3. check-vsql: every `filter` the page sends is parsed by the REAL server
//      (aggregate_records) and, where a `where` twin exists, both are run
//      over the entity's records and must agree. Flow pages only.
//
// Exit 0 iff both halves are green — a page that has not printed
// `check-staging: OK` is not finished.

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/check-staging.mjs <.intents-staging/Page.tsx | .public-staging/Page.tsx> [--public]');
  process.exit(2);
}
if (!existsSync(target)) {
  console.error(`ERROR: ${target} does not exist — write the page first, then check it`);
  process.exit(2);
}
const rel = relative(process.cwd(), resolve(target)).replace(/\\/g, '/');
const isPublic = args.includes('--public') || rel.startsWith('.public-staging/') || rel.startsWith('src/pages/public/');
const problems = [];

// ── 1. Types: this page + what it imports, nothing written ──────────────
// One tsc at a time per tree: two lanes checking at once next to Phase 1's own
// build starved the 2-vCPU sandbox. A lock file serialises them; a stale lock
// (a killed lane) is taken over after five minutes.
const LOCK = '.check-staging.lock';
function acquireLock() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 5 * 60 * 1000) { unlinkSync(LOCK); continue; }
      } catch { continue; }
      if (attempt === 0) console.log('check-staging: another check is running — waiting for its tsc to finish');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  }
  return false;
}
function releaseLock() {
  try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK); } catch { /* not ours or gone */ }
}

const CONFIG = 'tsconfig.app.json';
const read = ts.readConfigFile(CONFIG, ts.sys.readFile);
if (read.error) {
  console.error(`ERROR: cannot read ${CONFIG}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`);
  process.exit(2);
}
const base = read.config || {};
const compilerOptions = { ...(base.compilerOptions || {}) };
delete compilerOptions.tsBuildInfoFile;
compilerOptions.noEmit = true;
compilerOptions.incremental = false;
compilerOptions.composite = false;
// Root-level so `baseUrl`/`paths`/`include` keep their meaning; unique per
// page so two lanes checking at once never share a file.
const tempConfig = `.check-staging.${basename(rel, '.tsx')}.tsconfig.json`;
writeFileSync(tempConfig, JSON.stringify({
  compilerOptions,
  // `files` only — tsc follows the page's imports; no `include`, so the rest
  // of src/ (the widgets, the overview Phase 1 is still writing) stays out.
  files: [rel],
  include: [],
}, null, 2));

let tscOutput = '';
const locked = acquireLock();
if (!locked) console.log('check-staging: lock wait expired — running anyway');
try {
  const run = spawnSync('npx', ['tsc', '-p', tempConfig, '--pretty', 'false'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  tscOutput = (run.stdout || '') + (run.stderr || '');
} finally {
  try { unlinkSync(tempConfig); } catch { /* already gone */ }
  if (locked) releaseLock();
}

const pageErrors = [];
const configErrors = [];
let treeErrors = 0;
for (const raw of tscOutput.split('\n')) {
  const line = raw.trim();
  const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
  if (m) {
    if (m[1].replace(/\\/g, '/') === rel) pageErrors.push(line);
    else treeErrors += 1;
    continue;
  }
  if (/^error TS\d+/.test(line)) configErrors.push(line);
}
for (const e of pageErrors) console.error(`ERROR: ${e}`);
for (const e of configErrors) console.error(`ERROR: ${e}`);
problems.push(...pageErrors, ...configErrors);
if (treeErrors > 0) {
  console.log(`check-staging: ${treeErrors} tsc error(s) elsewhere in the tree (files your page imports) — not yours, not counted`);
}

// ── 2. The page rules, on this file only ────────────────────────────────
const gate = isPublic ? 'scripts/check-public.mjs' : 'scripts/check-intents.mjs';
const g = spawnSync('node', [gate, '--file', rel], { encoding: 'utf8' });
if (g.stdout) process.stdout.write(g.stdout);
if (g.stderr) process.stderr.write(g.stderr);
if (g.status !== 0) problems.push(`${gate} red`);

// ── 3. The filters, parsed by the server that will run them ─────────────
if (!isPublic) {
  const v = spawnSync('node', ['scripts/check-vsql.mjs', rel], { encoding: 'utf8', env: process.env });
  if (v.stdout) process.stdout.write(v.stdout);
  if (v.stderr) process.stderr.write(v.stderr);
  if (v.status !== 0) problems.push('scripts/check-vsql.mjs red');
}

if (problems.length > 0) {
  console.error(`check-staging: ${problems.length} problem(s) in ${rel} — fix them and run this again`);
  process.exit(1);
}
console.log(`check-staging: OK (${rel} — types, page rules${isPublic ? '' : ' and server-checked filters'} green)`);
