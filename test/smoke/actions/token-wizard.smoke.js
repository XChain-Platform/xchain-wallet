// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the Issue a Token route and its one form.
//
// Asserts:
//   1. TokenWizard.jsx is a thin route that renders IssueTokenForm; it holds
//      no composer and has no stylesheet of its own.
//   2. The "Start from" presets (Meme, Utility, Collectible, Limited edition,
//      Subtoken) exist, and "Community" is NOT one of them: it composed a
//      byte-identical ISSUE to Utility and sold "dividend-enabled" as a
//      choice when every token can pay dividends.
//   3. Each preset fills the settings its kind of token needs: Meme locks all
//      supply paths, Collectible is a locked 1 of 1, Limited edition is a fair
//      mint (cap locked, nothing minted, minting left open).
//   4. A subtoken's ISSUE carries TICK = PARENT.CHILD, neither half recased.
//   5. Review consumes decoder.decodeAction with action: 'ISSUE' and the
//      composed params, then continues into the shared confirmation flow,
//      whose approval calls messaging.issueToken with the prebuilt transaction.
//   6. The ticker passes through unchanged and the divisible switch maps to
//      DECIMALS 8 or 0.
//   7. The wallet menu opens the route and both shells render it.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sharedRoutes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

const routePath = join(sharedRoutes, 'TokenWizard.jsx');
const formPath = join(sharedRoutes, 'IssueTokenForm.jsx');

assert.ok(existsSync(routePath), 'TokenWizard.jsx exists');
assert.ok(existsSync(formPath), 'IssueTokenForm.jsx exists');

const route = readFileSync(routePath, 'utf8');
const src = readFileSync(formPath, 'utf8');

// --- 1. The route is a thin host ----------------------------------------

assert.ok(/export function TokenWizard\b/.test(route), 'TokenWizard is a named export');
assert.ok(/return <IssueTokenForm\b/.test(route), 'TokenWizard renders IssueTokenForm');
assert.ok(
    !/composeIssueParams|TEMPLATE_COMPOSERS|setStage\(/.test(route),
    'the route holds no composer and no step state',
);
assert.ok(
    !existsSync(join(sharedRoutes, 'TokenWizard.module.css'))
        && !existsSync(join(sharedRoutes, 'tokenWizardIcons.jsx')),
    'the retired wizard stylesheet and icon module are gone',
);
assert.ok(
    /export function IssueTokenForm\b/.test(src),
    'IssueTokenForm is a named export',
);

// --- 2. Presets; no Community ------------------------------------------

const presetBlock = src.match(/const ISSUE_PRESETS = \{[\s\S]*?\n\};/);
assert.ok(presetBlock, 'ISSUE_PRESETS found');
for (const id of ['meme', 'utility', 'collectible', 'edition', 'subtoken']) {
    assert.ok(
        new RegExp(`\\b${id}:`).test(presetBlock[0]),
        `ISSUE_PRESETS includes "${id}"`,
    );
    assert.ok(
        new RegExp(`value: '${id}'`).test(src),
        `the Start from picker offers "${id}"`,
    );
}
assert.ok(
    !/community/i.test(presetBlock[0]) && !/value: 'community'/.test(src),
    'Community is NOT a preset (merged into Utility)',
);
const utilityOption = src.match(/value: 'utility'[^}]*\}/);
assert.ok(utilityOption, 'utility option found');
assert.ok(
    /dividend/i.test(utilityOption[0]) && /every token/i.test(utilityOption[0]),
    'the Utility option says dividends work on every token',
);

// --- 3. What each preset fills in ---------------------------------------

const meme = presetBlock[0].match(/meme:\s*\{[^\n]*\}/);
assert.ok(meme, 'meme preset found');
assert.ok(/divisible: false/.test(meme[0]), 'meme is non-divisible');
for (const lock of ['maxSupply', 'maxMint', 'minting', 'mintSupply']) {
    assert.ok(
        new RegExp(`${lock}: true`).test(meme[0]),
        `meme locks ${lock} (fixed supply must be the token's own promise)`,
    );
}
const collectible = presetBlock[0].match(/collectible:\s*\{[^\n]*\}/);
assert.ok(collectible, 'collectible preset found');
assert.ok(
    /supply: '1'/.test(collectible[0]) && /initialMint: '1'/.test(collectible[0]),
    'collectible is a 1 of 1',
);
for (const lock of ['maxSupply', 'minting', 'mintSupply']) {
    assert.ok(
        new RegExp(`${lock}: true`).test(collectible[0]),
        `collectible locks ${lock}`,
    );
}
const edition = presetBlock[0].match(/edition:\s*\{[^\n]*\}/);
assert.ok(edition, 'edition preset found');
assert.ok(
    /initialMint: '0'/.test(edition[0]),
    'edition mints nothing at issuance (fair mint: no MINT_SUPPLY)',
);
assert.ok(
    /maxSupply: true/.test(edition[0]) && !/minting: true/.test(edition[0]),
    'edition locks the declared cap but leaves minting open',
);
assert.ok(
    /mintAddressMax: '1'/.test(edition[0]),
    'edition limits each address to one mint',
);
for (const field of ['MINT_ADDRESS_MAX', 'MINT_START_BLOCK', 'MINT_STOP_BLOCK', 'MAX_MINT']) {
    assert.ok(
        new RegExp(`p\\.${field} = `).test(src),
        `composition supports ${field}`,
    );
}

// --- 4. Subtoken ticker --------------------------------------------------

assert.ok(
    /`\$\{parentToken\.trim\(\)\}\.\$\{ticker\.trim\(\)\}`/.test(src),
    'a subtoken joins PARENT.CHILD for TICK',
);

// --- 5. Review wires through the decoder and shared confirmation --------

assert.ok(
    /decoder\s+as\s+decoderLib|decoderLib\.decodeAction/.test(src),
    'the form imports the decoder',
);
assert.ok(
    /action:\s*['"]ISSUE['"]/.test(src),
    'the form calls the decoder with action: "ISSUE"',
);
assert.ok(
    src.includes('actionParams'),
    'the form computes actionParams for the decoder and the backend',
);
assert.ok(
    src.includes('decoded.warnings'),
    'the form renders the decoder warnings array',
);
assert.ok(
    /messaging\.issueToken\s*\(/.test(src),
    'the form calls messaging.issueToken from the confirmed approval',
);
assert.ok(
    /prebuiltPsbt/.test(src) && /actionConfirm\.run/.test(src),
    'the form signs the same prebuilt transaction shown by shared confirmation',
);

// --- 6. Composition ------------------------------------------------------

// The chain records ticker case verbatim, so the form must not rewrite it.
assert.ok(
    /TICK: issueTick,/.test(src) && !/TICK: issueTick\.toUpperCase/.test(src),
    'the form preserves ticker case in the ISSUE',
);
assert.ok(
    /p\.DECIMALS = divisible \? '8' : '0'/.test(src),
    'composition maps divisible to DECIMALS 8 or 0',
);
assert.ok(
    /if \(transferTo\.trim\(\)\) p\.TRANSFER = transferTo\.trim\(\)/.test(src),
    'composition sets TRANSFER from the ownership field',
);
assert.ok(
    /p\.MINT_SUPPLY = /.test(src) && /p\.MAX_SUPPLY = /.test(src),
    'composition sets MAX_SUPPLY and MINT_SUPPLY',
);
assert.ok(
    !/export function composeIssueParams/.test(src),
    'composeIssueParams is not exported',
);

// --- 7. Shared messaging + shell context ---------------------------------

assert.ok(src.includes('useMessaging'), 'the form reads messaging + shell via useMessaging');
assert.ok(/screenVariantFor\(shell\)/.test(src), 'the form picks the Screen variant from the shell');
assert.ok(
    /<FormFrame\b/.test(src) && /<FromSection\b/.test(src) && /<FeeSection\b/.test(src) && /<FormAction\b/.test(src),
    'the form is built from the Form Standard parts',
);
assert.ok(!/<button\b/.test(src), 'the form has no raw button');

// --- 8. Wallet menu entry + App.jsx routing ------------------------------
// Home has no bottom action row; Create token is a wallet menu row that
// opens the route.

const home = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(!/onCreateToken/.test(home), 'Home carries no Create token entry of its own');
const walletMenuSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'walletMenu.js'),
    'utf8',
);
assert.ok(
    /id: 'wizard', labelKey: 'walletMenu\.row\.createToken'/.test(walletMenuSrc),
    'the wallet menu carries the Create token row that opens the route',
);

for (const [shell, appPath] of [
    ['popup', join(wsRoot, 'packages', 'extension', 'src', 'popup', 'App.jsx')],
    ['web', join(wsRoot, 'packages', 'web', 'src', 'App.jsx')],
    ['desktop', join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes("'wizard'"), `${shell} App.jsx tracks the wizard sub-route`);
    assert.ok(/<TokenWizard\b/.test(app), `${shell} App.jsx renders TokenWizard`);
    assert.ok(!/onCreateToken=\{/.test(app), `${shell} App.jsx passes no onCreateToken to Home`);
    // Issue subtoken on a token's page opens the wizard with that token as the
    // parent, and only that entry does: every Create token entry clears the
    // form source first, so a stale token never prefills a new token.
    const wizardBlock = app.match(/<TokenWizard\b[\s\S]*?\/>/)?.[0] || '';
    assert.ok(
        /initialChainId=\{subtokenParentFromToken \? tokenDetailRef\?\.chainId : undefined\}/.test(wizardBlock)
            && /initialParentTick=\{subtokenParentFromToken \? tokenDetailRef\?\.tick : undefined\}/.test(wizardBlock),
        `${shell} App.jsx prefills the wizard's parent from the token it was opened on`,
    );
    assert.ok(
        /const subtokenParentFromToken = formSource === 'manage-token' \|\| formSource === 'token-detail';/.test(app),
        `${shell} App.jsx takes the parent only from a token page source`,
    );
    assert.ok(/onIssueSubtoken[=:][^\n]*'wizard'/.test(app), `${shell} App.jsx opens Issue subtoken on the wizard`);
    const createEntries = app.split('\n').filter((line) => line.includes("setUnlockedView('wizard')"));
    assert.ok(
        createEntries.length >= 2 && createEntries.every((line) => line.includes('setFormSource(null); setUnlockedView(\'wizard\')')),
        `${shell} App.jsx clears the form source on every Create token entry`,
    );
}

console.log(
    'OK: issue token route smoke (thin route over IssueTokenForm, 5 presets and no Community, preset locks and fair mint, subtoken ticker, decoder and shared confirmation wiring, menu entry + both App.jsx sub-routes)',
);
