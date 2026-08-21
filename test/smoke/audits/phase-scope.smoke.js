// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for the v0.34.0 Phase-2 scope change (Batch 1 piece 3).
//
// Verifies the docs + package.json updates that moved Electron desktop
// out of Phase 1 stay internally consistent. Catches accidental reverts
// if someone later re-adds desktop to Phase 1 without updating §40.12.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// here = .../xchain-wallet/test/smoke/audits → wsRoot is three up, platformRoot four.
const wsRoot = join(here, '..', '..', '..');
const platformRoot = join(wsRoot, '..');
// The spec moved to claude/specs/living/ and this path was not moved with it,
// so from then until 2026-08-03 this gate SKIPPED on every run, everywhere,
// including the dev box it exists to guard. A loud skip is honest about not
// running; it is not honest about never being able to run again. Whoever
// moves either document repoints these two lines in the same step.
const specPath = join(platformRoot, 'claude', 'specs', 'living', 'XCHAIN_WALLET_SPEC.md');
const statusPath = join(platformRoot, 'claude', 'reports', 'xchain-wallet', 'IMPLEMENTATION_STATUS.md');

// These audit the platform SPEC + STATUS docs, which live in the parent
// repo's gitignored `claude/` tree - present in a full monorepo working tree
// (dev + the old Mac gate) but ABSENT from an isolated single-repo CI
// checkout. Skip LOUDLY rather than fail: this guards dev docs, not shipped
// product, so its absence in isolated CI is not a regression (unlike the sdk
// derivation-parity guard, which fails loud in the drift-guards job that runs
// it with XCHAIN_REQUIRE_SIBLINGS=1, because it guards shipped behavior).
// Never silently pass.
if (!existsSync(specPath) || !existsSync(statusPath)) {
    console.log('SKIP: phase-scope smoke - platform spec/status docs not in this checkout '
        + `(the parent repo's claude/ tree is gitignored here and absent in an isolated CI `
        + `checkout). Looked for ${specPath} and ${statusPath}: a gate that skips because a `
        + 'document MOVED looks identical to one skipping because the checkout is isolated.');
    process.exit(0);
}

const spec = readFileSync(specPath, 'utf8');
const status = readFileSync(statusPath, 'utf8');

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

console.log('OK: phase-scope smoke (§8, §39, §40.12, status doc, desktop package.json)');
