// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-01: Mint-configuration editor (ISSUE v2) smoke. Mirrors
// token-admin-form.smoke.js's structure for the new `'mint-settings'`
// mode, which edits MAX_MINT / MINT_SUPPLY / TRANSFER_SUPPLY /
// MINT_ADDRESS_MAX / MINT_START_BLOCK / MINT_STOP_BLOCK.
//
// Asserts:
//   1. TokenAdminForm.jsx's AdminMode grows a 4th `'mint-settings'` mode
//      (still the single named export; no new component/file).
//   2. `composeAdminParams('mint-settings', ...)` builds ISSUE VERSION=2
//      and omits any field the owner left blank (never sends '').
//   3. Current values + lock flags are read via useTokenInfo (getToken),
//      the same hook ManageToken.jsx uses.
//   4. Fields are disabled per their governing ISSUE v3 lock flag
//      (LOCK_MAX_MINT / LOCK_MINT / LOCK_MINT_SUPPLY).
//   5. Block-height inputs get a date estimate via blockDateEstimate.js,
//      fed by messaging.getIndexerWatermark (the same read History.jsx
//      uses for its Indexed-stage timeline).
//   6. Reuses messaging.issueToken (no new handler) through the shared
//      HW / watcher / actionConfirm signing path, same as the other
//      TokenAdminForm modes.
//   7. ManageToken.jsx exposes an owner-gated "Mint settings" entry.
//   8. All three shells (popup / web / desktop) wire ManageToken's
//      onMintSettings + the 'mint-settings' TokenAdminForm sub-route.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'TokenAdminForm.jsx');
assert.ok(existsSync(formPath), 'TokenAdminForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

// --- 1. Single export, 4th mode added -----------------------------------

assert.ok(/export function TokenAdminForm\b/.test(src), 'TokenAdminForm is a named export');
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'TokenAdminForm.jsx still only exports the component');
assert.ok(
    /'lock' \| 'description' \| 'transfer' \| 'mint-settings'/.test(src),
    'AdminMode typedef grows a 4th mint-settings mode',
);

// --- 2. composeAdminParams: ISSUE v2, blank fields omitted --------------

const composerBlock = src.match(/function composeAdminParams\([\s\S]*?\n\}\n/);
assert.ok(composerBlock, 'composeAdminParams function found');
const mintBlock = composerBlock[0].match(/mode === 'mint-settings'[\s\S]*?\n\s*\}\n/);
assert.ok(mintBlock, "composeAdminParams branches on mode === 'mint-settings'");
assert.ok(/VERSION:\s*'2'/.test(mintBlock[0]), 'mint-settings composer sets ISSUE VERSION=2');
for (const field of [
    'MAX_MINT', 'MINT_SUPPLY', 'TRANSFER_SUPPLY',
    'MINT_ADDRESS_MAX', 'MINT_START_BLOCK', 'MINT_STOP_BLOCK',
]) {
    assert.ok(
        new RegExp(`if\\s*\\(form\\.\\w+\\)\\s*p\\.${field}\\s*=`).test(mintBlock[0]),
        `mint-settings composer sets ${field} only when the form field is truthy (never sends '')`,
    );
}

// --- 3. Current values + lock flags via useTokenInfo --------------------

assert.ok(
    /from '\.\.\/hooks\/useTokenInfo\.js'/.test(src),
    'TokenAdminForm imports useTokenInfo (getToken current-value + lock-flag read)',
);
assert.ok(
    /useTokenInfo\(\s*\{[^}]*skip:\s*mode !== 'mint-settings'/s.test(src),
    'useTokenInfo call is scoped to mint-settings mode only',
);
assert.ok(/assetInfo\.mintMax/.test(src), 'prefills MAX_MINT from assetInfo.mintMax');
assert.ok(/assetInfo\.mintAddressMax/.test(src), 'prefills MINT_ADDRESS_MAX from assetInfo.mintAddressMax');
assert.ok(/assetInfo\.mintStartBlock/.test(src), 'prefills MINT_START_BLOCK from assetInfo.mintStartBlock');
assert.ok(/assetInfo\.mintStopBlock/.test(src), 'prefills MINT_STOP_BLOCK from assetInfo.mintStopBlock');

// --- 4. Lock-flag-aware field disabling ----------------------------------

// PC-02 renamed the shared current-locks variable from `mintLocks` to
// `tokenLocks` (it now also backs the 'lock' mode matrix); assert the
// same underlying reads under its new name.
assert.ok(/tokenLocks\.max_mint/.test(src), 'reads locks.max_mint (LOCK_MAX_MINT)');
assert.ok(/tokenLocks\.mint\b/.test(src), 'reads locks.mint (LOCK_MINT)');
assert.ok(/tokenLocks\.mint_supply/.test(src), 'reads locks.mint_supply (LOCK_MINT_SUPPLY)');
assert.ok(/tokenLocks\.max_supply/.test(src), 'reads locks.max_supply (LOCK_MAX_SUPPLY, informational)');
assert.ok(/maxMintFieldDisabled/.test(src), 'MAX_MINT field disable flag present');
assert.ok(/mintWindowFieldsDisabled/.test(src), 'mint-window fields (address max / start / stop block) disable flag present');
assert.ok(/mintNowFieldsDisabled/.test(src), 'mint-now fields (MINT_SUPPLY / TRANSFER_SUPPLY) disable flag present');
assert.ok(/disabled=\{maxMintFieldDisabled\}/.test(src), 'Max mint input wired to its disable flag');
assert.ok(/disabled=\{mintWindowFieldsDisabled\}/.test(src), 'mint-window inputs wired to their disable flag');
assert.ok(/disabled=\{mintNowFieldsDisabled\}/.test(src), 'mint-now inputs wired to their disable flag');

// --- 5. Block-date estimate ----------------------------------------------

assert.ok(
    /from '\.\.\/utils\/blockDateEstimate\.js'/.test(src),
    'TokenAdminForm imports blockDateEstimateText',
);
assert.ok(/messaging\.getIndexerWatermark\(/.test(src), 'fetches current block via messaging.getIndexerWatermark');
assert.ok(/mintStartEstimate/.test(src) && /mintStopEstimate/.test(src), 'computes start/stop block date estimates');

const estimatePath = join(core, 'src', 'shared', 'utils', 'blockDateEstimate.js');
assert.ok(existsSync(estimatePath), 'blockDateEstimate.js exists');
const estimateSrc = readFileSync(estimatePath, 'utf8');
assert.ok(/export function estimateBlockDate\b/.test(estimateSrc), 'exports estimateBlockDate');
assert.ok(/export function blockDateEstimateText\b/.test(estimateSrc), 'exports blockDateEstimateText');
for (const coin of ['bitcoin', 'litecoin', 'dogecoin']) {
    assert.ok(new RegExp(`${coin}:\\s*\\d+`).test(estimateSrc), `defines a target block interval for ${coin}`);
}

// --- 6. Reuses messaging.issueToken (shared signing path) ----------------

assert.ok(/messaging\.issueToken\s*\(/.test(src), 'TokenAdminForm reuses messaging.issueToken');
assert.ok(/messaging\.issueTokenHw\s*\(/.test(src), 'reuses the HW signing path (messaging.issueTokenHw)');
assert.ok(/buildActionPsbtRequest/.test(src), 'reuses the watcher-mode encode-only path');

// --- 7. ManageToken owner-gated entry ------------------------------------

const manageSrc = readFileSync(join(sharedRoutes, 'ManageToken.jsx'), 'utf8');
assert.ok(/onMintSettings/.test(manageSrc), 'ManageToken accepts onMintSettings');
assert.ok(
    /id:\s*'mint-settings'[\s\S]{0,120}onSelect:\s*blockIssuerActions \? undefined : onMintSettings/.test(manageSrc),
    'ManageToken hides Mint settings from non-owners (blockIssuerActions gate, same as Description/Transfer)',
);

// --- 8. 3-shell wiring -----------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        /onMintSettings=\{\(\)\s*=>\s*openForm\('mint-settings'\)\}/.test(app),
        `${shell} App.jsx wires ManageToken onMintSettings -> 'mint-settings'`,
    );
    assert.ok(
        /unlockedView === 'mint-settings'/.test(app),
        `${shell} App.jsx routes the 'mint-settings' view to TokenAdminForm`,
    );
    assert.ok(
        // PC-03 inserted 'callback-settings' | 'execute-callback' between
        // 'mint-settings' and 'description'; the union still leads with
        // 'lock' | 'mint-settings'.
        /'lock' \| 'mint-settings' \|.*\| 'description' \| 'transfer'/.test(app),
        `${shell} App.jsx view-state type union includes 'mint-settings'`,
    );
}

console.log(
    'OK: token mint-settings form smoke (PC-01: ISSUE v2 mint-config editor; getToken current values + ISSUE v3 lock-flag-aware field disabling; block-date estimate off getIndexerWatermark; reuses messaging.issueToken/-Hw + watcher path; owner-gated ManageToken entry; 3-shell wiring)',
);
