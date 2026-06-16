// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2 — Step 11 (piece 3d) — token admin surfaces.
//
// Asserts:
//   1. TokenAdminForm.jsx exists and exports a single component. Reuses
//      IssueTokenForm.module.css.
//   2. Two-stage state machine (form → review/submitting → done).
//   3. `mode` prop drives which ISSUE-variant composer runs:
//        - 'lock'        → VERSION='3', LOCK_MAX_SUPPLY + LOCK_MINT
//        - 'description' → VERSION='1', DESCRIPTION only
//        - 'transfer'    → VERSION='0', TRANSFER only
//   4. Form stage renders the permanence warning only on 'lock' mode.
//   5. Review runs through decoder.decodeAction with action: 'ISSUE'.
//   6. Sign wires through messaging.issueToken (reuses Step 5 helper —
//      no new flow / handler / messaging entry for admin actions).
//   7. Lock-mode sign button uses the danger variant.
//   8. ActionsMenu + App.jsx wire 'lock', 'description', 'transfer'
//      sub-routes for both shells.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'TokenAdminForm.jsx');
assert.ok(existsSync(formPath), 'TokenAdminForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

// --- 1. Public surface + CSS reuse ------------------------------------

assert.ok(/export function TokenAdminForm\b/.test(src), 'TokenAdminForm is a named export');
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'TokenAdminForm.jsx only exports the component');
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'TokenAdminForm reuses IssueTokenForm CSS module',
);

// --- 2. Two-stage state machine ---------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `TokenAdminForm tracks stage "${stage}"`);
}

// --- 3. mode-driven param composer -------------------------------------

const composerBlock = src.match(/function composeAdminParams\([\s\S]*?\n\}\n/);
assert.ok(composerBlock, 'composeAdminParams function found');
const composer = composerBlock[0];
assert.ok(/mode\s*===\s*'lock'/.test(composer), 'composer branches on lock mode');
assert.ok(
    /VERSION:\s*'3'[\s\S]*LOCK_MAX_SUPPLY:\s*'1'[\s\S]*LOCK_MINT:\s*'1'/.test(composer),
    'lock composer sets VERSION=3 + LOCK_MAX_SUPPLY=1 + LOCK_MINT=1',
);
assert.ok(/mode\s*===\s*'description'/.test(composer), 'composer branches on description mode');
assert.ok(
    /VERSION:\s*'1'[\s\S]*DESCRIPTION:/.test(composer),
    'description composer sets VERSION=1 + DESCRIPTION',
);
assert.ok(
    /VERSION:\s*'0'[\s\S]*TRANSFER:/.test(composer),
    'transfer composer sets VERSION=0 + TRANSFER',
);

// --- 4. Lock-only permanence warning ----------------------------------

assert.ok(
    /mode === 'lock'[\s\S]{0,400}Locking is permanent/.test(src),
    'TokenAdminForm renders the "Locking is permanent" warning only on lock mode',
);

// --- 5. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]ISSUE['"]/.test(src),
    'TokenAdminForm calls decoder with action: "ISSUE"',
);
assert.ok(/decoderLib\.decodeAction/.test(src), 'TokenAdminForm invokes decoder.decodeAction');
assert.ok(src.includes('decoded.warnings'), 'TokenAdminForm renders decoder warnings');

// --- 6. Sign wires through messaging.issueToken -----------------------

assert.ok(
    /messaging\.issueToken\s*\(/.test(src),
    'TokenAdminForm reuses messaging.issueToken — no new handler needed for admin actions',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'TokenAdminForm distinguishes wrong-password from other errors',
);

// --- 7. Lock-mode danger variant --------------------------------------
//
// §20 Cluster X Step 21 — variant flips to plain 'primary' in watcher
// mode (the "Create unsigned transaction" CTA is not destructive — destruction
// happens later when the signed PSBT broadcasts). Pin both the legacy
// shape AND the new wrapped shape. Either is acceptable.
assert.ok(
    /variant=\{mode === 'lock' \? 'danger' : 'primary'\}/.test(src)
        || /variant=\{isWatcherMode \? 'primary' : \(mode === 'lock' \? 'danger' : 'primary'\)\}/.test(src),
    'TokenAdminForm uses the danger variant only on lock mode (in non-watcher mode)',
);

// --- 8. ActionsMenu + App.jsx sub-routes ------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('TokenAdminForm'), `${shell} App.jsx imports TokenAdminForm`);
    for (const mode of ['lock', 'description', 'transfer']) {
        assert.ok(
            app.includes(`'${mode}'`),
            `${shell} App.jsx tracks the ${mode} sub-route`,
        );
        assert.ok(
            new RegExp(`id:\\s*['"]${mode}['"]`).test(app),
            `${shell} App.jsx registers the ${mode} entry in buildActionEntries`,
        );
    }
    assert.ok(
        /onLock:\s*\(\)\s*=>\s*setUnlockedView\('lock'\)/.test(app),
        `${shell} App.jsx wires onLock → 'lock' sub-route`,
    );
    assert.ok(
        /onUpdateDescription:\s*\(\)\s*=>\s*setUnlockedView\('description'\)/.test(app),
        `${shell} App.jsx wires onUpdateDescription → 'description' sub-route`,
    );
    assert.ok(
        /onTransferOwnership:\s*\(\)\s*=>\s*setUnlockedView\('transfer'\)/.test(app),
        `${shell} App.jsx wires onTransferOwnership → 'transfer' sub-route`,
    );
    assert.ok(
        /mode=\{unlockedView\}/.test(app),
        `${shell} App.jsx passes mode prop from unlockedView`,
    );
}

console.log(
    'OK — token admin form smoke (§40.5 Lock / Update description / Transfer ownership — mode-driven composers + reuses messaging.issueToken + lock permanence warning + danger-variant lock sign + popup/web wiring)',
);
