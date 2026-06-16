// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2 — Step 4 (piece 2b) — Token Creation Wizard
// scaffold.
//
// Asserts:
//   1. packages/core/src/shared/routes/TokenWizard.jsx exists + exports
//      the TokenWizard component + the ISSUE-v0 composer used by Step 5
//      and Step 6 is file-local (not exported from the module's
//      public surface — we don't want wallet callers composing params
//      directly; they go through messaging.issueToken).
//   2. The 5 wizard stages + 'done' + 'error' are present as state
//      literals; each stage wires to the next via setStage.
//   3. All six templates appear in the TEMPLATES table, Custom is the
//      only `interactive: true` entry in Step 4.
//   4. Preview stage consumes decoder.decodeAction with action: 'ISSUE'
//      and the composed params — that's the contract with Piece 2a.
//   5. Sign stage calls messaging.issueToken — the helper lands in
//      Step 5 (piece 2c) but the call-site wiring is in place today.
//   6. Ticker is uppercased before passing to the decoder / backend.
//   7. The CSS module ships matching class names for the stage UIs.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sharedRoutes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

const wizardPath = join(sharedRoutes, 'TokenWizard.jsx');
const cssPath = join(sharedRoutes, 'TokenWizard.module.css');

assert.ok(existsSync(wizardPath), 'TokenWizard.jsx exists');
assert.ok(existsSync(cssPath), 'TokenWizard.module.css exists');

const src = readFileSync(wizardPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

// --- 1. Public surface -------------------------------------------------

assert.ok(
    /export function TokenWizard\b/.test(src),
    'TokenWizard is a named export',
);
assert.ok(
    !/export function composeIssueParams/.test(src),
    'composeIssueParams stays file-local (not exported)',
);

// --- 2. Five stages + done + error ------------------------------------

for (const stage of ['template', 'chain', 'details', 'preview', 'sign', 'done']) {
    assert.ok(
        src.includes(`'${stage}'`),
        `wizard tracks stage "${stage}"`,
    );
}
// State transitions: template → chain, chain → details, details →
// preview, preview → sign, sign → done (the setStage calls).
for (const transition of [
    "setStage('chain')",
    "setStage('details')",
    "setStage('preview')",
    "setStage('sign')",
    "setStage('done')",
]) {
    assert.ok(src.includes(transition), `wizard performs ${transition}`);
}

// --- 3. Seven templates; all interactive ------------------------------

for (const id of ['meme', 'utility', 'collectible', 'edition', 'community', 'subtoken', 'custom']) {
    assert.ok(
        new RegExp(`id: '${id}'`).test(src),
        `TEMPLATES includes "${id}"`,
    );
}
const templateBlocks = [...src.matchAll(/\{\s*id:\s*'(\w+)',[^}]*interactive:\s*(true|false)[^}]*\}/g)];
const interactiveMap = Object.fromEntries(
    templateBlocks.map((m) => [m[1], m[2] === 'true']),
);
for (const id of ['meme', 'utility', 'community', 'collectible', 'edition', 'subtoken', 'custom']) {
    assert.equal(
        interactiveMap[id],
        true,
        `${id} template is interactive`,
    );
}

// --- 3b. Per-template composers present -----------------------------

for (const key of ['meme', 'utility', 'community', 'collectible', 'edition', 'subtoken', 'custom']) {
    assert.ok(
        new RegExp(`\\b${key}\\s*\\(form\\)\\s*\\{`).test(src),
        `TEMPLATE_COMPOSERS includes a ${key}(form) composer`,
    );
}
// Meme locks on creation.
const memeBlock = src.match(/meme\(form\)\s*\{[\s\S]*?\n\s*\},/);
assert.ok(memeBlock, 'meme composer block found');
assert.ok(
    memeBlock[0].includes("LOCK_MAX_SUPPLY = '1'"),
    'meme composer sets LOCK_MAX_SUPPLY',
);
assert.ok(
    memeBlock[0].includes("LOCK_MINT = '1'"),
    'meme composer sets LOCK_MINT',
);
assert.ok(
    memeBlock[0].includes("DECIMALS = '0'"),
    'meme composer is non-divisible',
);
// Collectible hard-wires supply=1 and locks.
const collBlock = src.match(/collectible\(form\)\s*\{[\s\S]*?\n\s*\},/);
assert.ok(collBlock, 'collectible composer block found');
assert.ok(
    /MAX_SUPPLY\s*=\s*'1'/.test(collBlock[0]),
    'collectible composer pins MAX_SUPPLY=1',
);
// Edition is the fair-mint pattern (mirrors sdk.nft.edition({mint})):
// declared cap locked at issuance, public MINT window left open.
const edBlock = src.match(/edition\(form\)\s*\{[\s\S]*?\n\s*\},/);
assert.ok(edBlock, 'edition composer block found');
assert.ok(
    edBlock[0].includes("LOCK_MAX_SUPPLY = '1'"),
    'edition composer locks the declared cap',
);
assert.ok(
    edBlock[0].includes("DECIMALS = '0'"),
    'edition composer is non-divisible',
);
assert.ok(
    /p\.MAX_MINT\s*=/.test(edBlock[0]),
    'edition composer sets MAX_MINT (the public mint window)',
);
for (const field of ['MINT_ADDRESS_MAX', 'MINT_START_BLOCK', 'MINT_STOP_BLOCK']) {
    assert.ok(
        new RegExp(`p\\.${field}\\s*=`).test(edBlock[0]),
        `edition composer supports ${field}`,
    );
}
assert.ok(
    !/p\.MINT_SUPPLY\s*=/.test(edBlock[0]),
    'edition composer does NOT pre-mint (no MINT_SUPPLY — fair mint)',
);
assert.ok(
    !/p\.LOCK_MINT\s*=/.test(edBlock[0]),
    'edition composer does NOT lock minting (the window must stay open)',
);
// Subtoken joins parent.child.
const subBlock = src.match(/subtoken\(form\)\s*\{[\s\S]*?\n\s*\},/);
assert.ok(subBlock, 'subtoken composer block found');
assert.ok(
    /parent\}\.\$\{child/.test(subBlock[0]) || /parent.*\.\$\{child/.test(subBlock[0]),
    'subtoken composer joins parent.child for TICK',
);

// --- 3c. Per-template field visibility map --------------------------

assert.ok(
    /TEMPLATE_FIELDS\s*=\s*\{/.test(src),
    'wizard defines TEMPLATE_FIELDS visibility map',
);
// Collectible hides supply (composer pins it to 1).
const fieldsBlock = src.match(/TEMPLATE_FIELDS\s*=\s*\{[\s\S]*?\n\};/);
assert.ok(fieldsBlock, 'TEMPLATE_FIELDS block found');
const collFields = fieldsBlock[0].match(/collectible:\s*\{[^}]*\}/);
assert.ok(collFields, 'collectible field map exists');
assert.ok(
    !/\bsupply:\s*true/.test(collFields[0]),
    'collectible does NOT show the supply field',
);
const edFields = fieldsBlock[0].match(/edition:\s*\{[^}]*\}/);
assert.ok(edFields, 'edition field map exists');
assert.ok(
    /\bsupply:\s*true/.test(edFields[0])
        && /\bmaxMint:\s*true/.test(edFields[0])
        && /\bperAddressMax:\s*true/.test(edFields[0]),
    'edition shows supply + mint-window fields',
);
const subFields = fieldsBlock[0].match(/subtoken:\s*\{[^}]*\}/);
assert.ok(subFields, 'subtoken field map exists');
assert.ok(
    /parentToken:\s*true/.test(subFields[0]),
    'subtoken shows the parentToken field',
);

// --- 4. Preview wires through decoder ---------------------------------

assert.ok(
    /decoder\s+as\s+decoderLib|decoderLib\.decodeAction/.test(src),
    'wizard imports the decoder',
);
assert.ok(
    /action:\s*['"]ISSUE['"]/.test(src),
    'wizard calls decoder with action: "ISSUE"',
);
assert.ok(
    src.includes('actionParams'),
    'wizard computes actionParams for the decoder + backend',
);
assert.ok(
    src.includes('decoded.warnings'),
    'wizard renders the decoder warnings array',
);

// --- 5. Sign wires through messaging.issueToken -----------------------

assert.ok(
    /messaging\.issueToken\s*\(/.test(src),
    'wizard calls messaging.issueToken from the sign stage',
);
// The password → sign flow mirrors Send.jsx's review→submit pattern.
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'wizard distinguishes wrong-password from other errors',
);

// --- 6. ISSUE v0 composer --------------------------------------------

// Ticker must be uppercased before hitting the decoder / backend —
// protocol §ISSUE rules require A-Z / 0-9 / period. The wizard does
// it in two places: the Input's onChange (so the user sees it) AND
// the composer (belt-and-suspenders).
assert.ok(
    /\.toUpperCase\(\)/.test(src),
    'wizard uppercases the ticker',
);
// MINT_SUPPLY defaults to MAX_SUPPLY on create so the initial supply
// lands in the creator's wallet. Shared across Meme/Utility/Community/
// Subtoken/Custom composers via the seedSupply helper.
assert.ok(
    /p\.MAX_SUPPLY\s*=\s*supply/.test(src)
        && /p\.MINT_SUPPLY\s*=\s*supply/.test(src),
    'seedSupply helper sets MAX_SUPPLY + MINT_SUPPLY together',
);
// Divisible toggle → DECIMALS = 8 or 0.
assert.ok(
    /form\.divisible\s*\?\s*'8'\s*:\s*'0'/.test(src),
    'composer maps divisible → DECIMALS 8 / 0',
);
// Custom template flips LOCK_MAX_SUPPLY + LOCK_MINT when lockOnCreate
// is true (Meme + Collectible set them unconditionally — covered in
// Section 3b above).
assert.ok(
    src.includes("p.LOCK_MAX_SUPPLY = '1'"),
    'composer sets LOCK_MAX_SUPPLY when lockOnCreate is true',
);
assert.ok(
    src.includes("p.LOCK_MINT = '1'"),
    'composer sets LOCK_MINT when lockOnCreate is true',
);
// Transfer-ownership (Custom-only).
assert.ok(
    /p\.TRANSFER\s*=\s*form\.transferTo/.test(src),
    'composer sets TRANSFER from form.transferTo',
);

// --- 7. CSS module -----------------------------------------------------

for (const cls of [
    '.card',
    '.templateGrid',
    '.templateCard',
    '.templateCardDisabled',
    '.detailsList',
    '.warnings',
    '.actions',
    '.successTitle',
]) {
    assert.ok(
        css.includes(cls),
        `TokenWizard.module.css defines ${cls}`,
    );
}

// --- 8. Uses the shared messaging + shell context ---------------------

assert.ok(
    src.includes('useMessaging'),
    'wizard reads messaging + shell via useMessaging',
);
assert.ok(
    /screenVariantFor\(shell\)/.test(src),
    'wizard picks Screen variant from shell',
);

// --- 9. Home entry + App.jsx routing (Step 7) ----------------------

const home = readFileSync(
    join(sharedRoutes, 'Home.jsx'),
    'utf8',
);
assert.ok(
    /onCreateToken/.test(home) && /onClick=\{onCreateToken\}/.test(home),
    'Home accepts + wires onCreateToken for the wizard entry',
);

for (const [shell, appPath] of [
    ['popup', join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx')],
    ['web', join(wsRoot, 'packages', 'web', 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        app.includes("'wizard'"),
        `${shell} App.jsx tracks the wizard sub-route`,
    );
    assert.ok(
        /<TokenWizard\b/.test(app),
        `${shell} App.jsx renders TokenWizard`,
    );
    assert.ok(
        /onCreateToken=\{activeWalletId/.test(app)
            || /onCreateToken=\{/.test(app),
        `${shell} App.jsx passes onCreateToken to Home`,
    );
}

console.log(
    'OK — token wizard smoke (file exists, 5 stages, 7 templates all interactive, per-template composers + field-visibility map, decoder wiring, messaging.issueToken call-site, Home entry + both App.jsx sub-routes, CSS classes present)',
);
