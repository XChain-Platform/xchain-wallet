// Smoke test for the v0.34.0 Phase-2 scope change (Batch 1 piece 3).
//
// Verifies the docs + package.json updates that moved Electron desktop
// out of Phase 1 stay internally consistent. Catches accidental reverts
// if someone later re-adds desktop to Phase 1 without updating §40.12.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const wsRoot = join(pkgRoot, '..', '..');
const platformRoot = join(wsRoot, '..');
const spec = readFileSync(
    join(platformRoot, 'claude', 'reports', 'xchain-wallet', 'XCHAIN_WALLET_SPEC.md'),
    'utf8',
);
const status = readFileSync(
    join(platformRoot, 'claude', 'reports', 'xchain-wallet', 'IMPLEMENTATION_STATUS.md'),
    'utf8',
);

// --- §8.1 / §8.2 target matrix ----------------------------------------
const s8 = spec.slice(spec.indexOf('## 8. Target Matrix'), spec.indexOf('## 9. Architecture'));
const primary = s8.slice(s8.indexOf('### 8.1'), s8.indexOf('### 8.2'));
const deferred = s8.slice(s8.indexOf('### 8.2'), s8.indexOf('### 8.3'));

assert.ok(!/Electron desktop/.test(primary), '§8.1 Phase 1 table must not list Electron desktop');
assert.ok(/Electron desktop/.test(deferred), '§8.2 deferred table must list Electron desktop');
assert.ok(/\*\*Phase 2\.\*\*/.test(deferred), '§8.2 desktop row must be flagged Phase 2');

// --- §39 Phase 1 scope -------------------------------------------------
const s39 = spec.slice(spec.indexOf('## 39. Phase 1'), spec.indexOf('## 40. Phase 2'));
const inScope = s39.slice(s39.indexOf('### 39.1'), s39.indexOf('### 39.2'));
const outScope = s39.slice(s39.indexOf('### 39.2'), s39.indexOf('### 39.3'));

assert.ok(
    !/Desktop \(Electron\)/.test(inScope),
    '§39.1 Phase 1 in-scope must not claim Desktop delivery',
);
assert.ok(
    /Electron desktop shell.*Phase 2/.test(outScope),
    '§39.2 out-of-scope must call out Electron desktop → Phase 2',
);

// --- §40 Phase 2 desktop subsection -----------------------------------
assert.ok(
    spec.includes('### 40.12 Electron Desktop Shell Goes Live'),
    '§40.12 desktop subsection exists',
);

// --- IMPLEMENTATION_STATUS.md -----------------------------------------
assert.ok(
    /Scope changed to Phase 2/.test(status),
    'status doc records the scope change',
);
assert.ok(
    /§40\.12/.test(status),
    'status doc references §40.12',
);

// --- desktop/package.json ---------------------------------------------
const desktopPkg = JSON.parse(
    readFileSync(join(wsRoot, 'packages', 'desktop', 'package.json'), 'utf8'),
);
assert.ok(
    /Phase 2/.test(desktopPkg.description),
    'desktop/package.json description mentions Phase 2',
);

console.log('OK — phase-scope smoke (§8, §39, §40.12, status doc, desktop package.json)');
