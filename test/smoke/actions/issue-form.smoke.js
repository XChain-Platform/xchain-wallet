// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 8 (piece 3a): standalone ISSUE form.
//
// Asserts:
//   1. packages/core/src/shared/routes/IssueTokenForm.jsx exists and
//      exports a single named component (no incidental exports).
//   2. The form has the 2-stage shape (form → review/submitting → done)
//      mirroring Send.jsx, and wires setStage transitions accordingly.
//   3. Review stage runs the composed ISSUE params through
//      decoder.decodeAction; the sign preview must match what
//      SignApproval renders for dApp-initiated ISSUE.
//   4. Sign stage calls messaging.issueToken (the Step 5 helper), not
//      a new flow. Piece 3a intentionally does not add new messaging.
//   5. Validation blocks submit on: empty ticker, non-A/0-9 ticker,
//      missing/zero supply.
//   6. Params composer applies the same ISSUE-v0 shape as the wizard's
//      Custom composer: MAX_SUPPLY + MINT_SUPPLY from supply, DECIMALS
//      8/0 from divisible, LOCK_MAX_SUPPLY + LOCK_MINT on lock, TRANSFER
//      from transferTo. VERSION pinned to '0'.
//   7. ActionsMenu.jsx exists and renders an entries[] prop with
//      label + optional description; popup + web both pass an `issue`
//      entry wired to setUnlockedView('issue').
//   8. Home accepts onActions and wires a "More actions" button.
//   9. popup + web App.jsx import IssueTokenForm + ActionsMenu and
//      track the `'issue'` + `'actions'` sub-routes.

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

const formPath = join(sharedRoutes, 'IssueTokenForm.jsx');
const cssPath = join(sharedRoutes, 'IssueTokenForm.module.css');
const menuPath = join(sharedRoutes, 'ActionsMenu.jsx');
const menuCssPath = join(sharedRoutes, 'ActionsMenu.module.css');

assert.ok(existsSync(formPath), 'IssueTokenForm.jsx exists');
assert.ok(existsSync(cssPath), 'IssueTokenForm.module.css exists');
assert.ok(existsSync(menuPath), 'ActionsMenu.jsx exists');
assert.ok(existsSync(menuCssPath), 'ActionsMenu.module.css exists');

const src = readFileSync(formPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const menuSrc = readFileSync(menuPath, 'utf8');

// --- 1. Public surface -------------------------------------------------

assert.ok(
    /export function IssueTokenForm\b/.test(src),
    'IssueTokenForm is a named export',
);
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'IssueTokenForm.jsx only exports the component');

// --- 2. Two-stage state machine ----------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(
        src.includes(`'${stage}'`),
        `IssueTokenForm tracks stage "${stage}"`,
    );
}
for (const transition of [
    "setStage('review')",
    "setStage('submitting')",
    "setStage('done')",
    "setStage('form')",
]) {
    assert.ok(src.includes(transition), `IssueTokenForm performs ${transition}`);
}

// --- 3. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /decoder\s+as\s+decoderLib|decoderLib\.decodeAction/.test(src),
    'IssueTokenForm imports the decoder',
);
assert.ok(
    /action:\s*['"]ISSUE['"]/.test(src),
    'IssueTokenForm calls decoder with action: "ISSUE"',
);
assert.ok(
    src.includes('actionParams'),
    'IssueTokenForm computes actionParams for decoder + backend',
);
assert.ok(
    src.includes('decoded.warnings'),
    'IssueTokenForm renders the decoder warnings array',
);

// --- 4. Sign wires through messaging.issueToken -----------------------

assert.ok(
    /messaging\.issueToken\s*\(/.test(src),
    'IssueTokenForm calls messaging.issueToken (reuses Step 5 helper)',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'IssueTokenForm distinguishes wrong-password from other errors',
);

// --- 5. Validation ----------------------------------------------------

assert.ok(
    /Ticker is required/.test(src),
    'IssueTokenForm rejects empty ticker',
);
assert.ok(
    /\[A-Za-z0-9\]\+/.test(src),
    'IssueTokenForm validates ticker is A-Z/0-9',
);
assert.ok(
    /Supply must be a positive number/.test(src),
    'IssueTokenForm rejects zero/empty supply',
);

// --- 6. Params composer: ISSUE v0 shape ------------------------------

assert.ok(
    /VERSION:\s*'0'/.test(src),
    'IssueTokenForm pins VERSION=0',
);
assert.ok(
    /\.toUpperCase\(\)/.test(src),
    'IssueTokenForm uppercases the ticker',
);
assert.ok(
    /p\.MAX_SUPPLY\s*=\s*s/.test(src),
    'composer sets MAX_SUPPLY from the supply field',
);
// MINT_SUPPLY must come from its OWN field, defaulting to the
// supply. Tying it to `s` like MAX_SUPPLY did is the defect: it births
// every wallet-issued token at its cap with zero mint headroom, which
// makes the entire Mint surface unreachable for anything issued here.
assert.ok(
    /const mint = wantsMint === ''\s*\?\s*s\s*:\s*wantsMint/.test(src)
        && /p\.MINT_SUPPLY\s*=\s*mint/.test(src),
    'composer sets MINT_SUPPLY from the initial-mint field, defaulting to supply',
);
assert.ok(
    /Initial mint cannot be more than the supply/.test(src),
    'IssueTokenForm rejects an initial mint above the cap before it costs a fee',
);
assert.ok(
    /divisible\s*\?\s*'8'\s*:\s*'0'/.test(src),
    'composer maps divisible → DECIMALS 8 / 0',
);
assert.ok(
    /p\.LOCK_MAX_SUPPLY\s*=\s*'1'/.test(src)
        && /p\.LOCK_MINT\s*=\s*'1'/.test(src),
    'composer sets LOCK_MAX_SUPPLY + LOCK_MINT when lockSupply is true',
);
assert.ok(
    /p\.TRANSFER\s*=\s*transferTo/.test(src),
    'composer sets TRANSFER from transferTo',
);

// --- 7. ActionsMenu surface --------------------------------------------

assert.ok(
    /export function ActionsMenu\b/.test(menuSrc),
    'ActionsMenu is a named export',
);
assert.ok(
    /entries\.map/.test(menuSrc),
    'ActionsMenu renders entries[] as a list',
);
assert.ok(
    menuSrc.includes('useMessaging') && /screenVariantFor\(shell\)/.test(menuSrc),
    'ActionsMenu reads shell + variant from useMessaging',
);

// --- 8. Home wiring ----------------------------------------------------

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(
    /onActions/.test(home) && /onClick=\{onActions\}/.test(home),
    'Home accepts + wires onActions for the Actions menu',
);
assert.ok(
    home.includes('More actions'),
    'Home exposes a "More actions" button',
);

// --- 9. Both shells wire the new sub-routes ---------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        app.includes('IssueTokenForm'),
        `${shell} App.jsx imports IssueTokenForm`,
    );
    assert.ok(
        app.includes('ActionsMenu'),
        `${shell} App.jsx imports ActionsMenu`,
    );
    assert.ok(
        app.includes("'issue'"),
        `${shell} App.jsx tracks the issue sub-route`,
    );
    assert.ok(
        app.includes("'actions'"),
        `${shell} App.jsx tracks the actions sub-route`,
    );
    assert.ok(
        /buildActionEntries\(/.test(app),
        `${shell} App.jsx passes entries via buildActionEntries`,
    );
    assert.ok(
        /id:\s*['"]issue['"]/.test(app),
        `${shell} App.jsx includes the issue entry`,
    );
    assert.ok(
        /onActions=\{activeWalletId/.test(app)
            || /onActions=\{/.test(app),
        `${shell} App.jsx passes onActions to Home`,
    );
}

// --- 10. Uses the shared messaging + shell context --------------------

assert.ok(
    src.includes('useMessaging'),
    'IssueTokenForm reads messaging + shell via useMessaging',
);
assert.ok(
    /screenVariantFor\(shell\)/.test(src),
    'IssueTokenForm picks Screen variant from shell',
);

// --- 11. CSS module ---------------------------------------------------

for (const cls of [
    '.card',
    '.picker',
    '.fromLine',
    '.checkRow',
    '.detailsList',
    '.warnings',
    '.actions',
    '.successTitle',
]) {
    assert.ok(
        css.includes(cls),
        `IssueTokenForm.module.css defines ${cls}`,
    );
}

console.log(
    'OK: issue form smoke (standalone ISSUE §40.2 + ActionsMenu + Home "More actions" entry + popup/web wiring)',
);
