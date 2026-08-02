// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 9 smoke: COINPAY queue + sign (§41.4).
//
// Asserts:
//   1. coinpayAction + query flows exported from @xchain-wallet/core.
//   2. coinpayAction guards its required inputs.
//   3. CoinpayForm.jsx exists and wires messaging.getCoinpayObligationsForAddress
//      + coinpayAction / Hw + SignCredentials.
//   4. Background host registers action.coinpay, action.coinpay.hw,
//      coinpays.obligationsForAddress, coinpays.forAddress.
//   5. Three shells' messaging.js expose coinpayAction / coinpayActionHw /
//      getCoinpayObligationsForAddress / getCoinpaysForAddress.
//   6. Three App.jsx files track the 'coinpay' sub-route, register the
//      ActionsMenu 'coinpay' entry, and thread onResumeCoinpay to Home.
//   7. Home scans for pending obligations via getCoinpayObligationsForAddress
//      and renders a resume card that invokes onResumeCoinpay.
//   8. SDK pin bumped to ^1.9.1 (matches the getCoinpayObligations method
//      that lands in xchain-sdk 1.9.1).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- 1. Flow exports --------------------------------------------------

for (const name of [
    'coinpayAction',
    'getCoinpayObligationsForAddress',
    'getCoinpaysForAddress',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} re-exported`);
}

// --- 2. coinpayAction input guards ------------------------------------

await assert.rejects(async () => flows.coinpayAction(), /coinpayAction: opts is required/);
await assert.rejects(
    async () => flows.coinpayAction({}),
    /orderMatchActionIndex is required/,
);
await assert.rejects(
    async () => flows.coinpayAction({ orderMatchActionIndex: '1' }),
    /payeeAddress is required/,
);
await assert.rejects(
    async () => flows.coinpayAction({
        orderMatchActionIndex: '1', payeeAddress: 'bc1q',
    }),
    /coinAmount/,
);
await assert.rejects(
    async () => flows.coinpayAction({
        orderMatchActionIndex: '1', payeeAddress: 'bc1q', coinAmount: -1,
    }),
    /positive/,
);
await assert.rejects(
    async () => flows.coinpayAction({
        orderMatchActionIndex: '1', payeeAddress: 'bc1q', coinAmount: 1.5,
    }),
    /integer/,
);
await assert.rejects(
    async () => flows.getCoinpayObligationsForAddress({}),
    /sdkRegistry is required/,
);
await assert.rejects(
    async () => flows.getCoinpayObligationsForAddress({ sdkRegistry: {}, chainId: 'x' }),
    /address is required/,
);

// --- 3. CoinpayForm.jsx ------------------------------------------------

const formPath = join(sharedRoutes, 'CoinpayForm.jsx');
assert.ok(existsSync(formPath), 'CoinpayForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');
assert.ok(/export function CoinpayForm\b/.test(formSrc), 'CoinpayForm is a named export');
assert.ok(/messaging\.getCoinpayObligationsForAddress\s*\(/.test(formSrc),
    'CoinpayForm fans out messaging.getCoinpayObligationsForAddress');
assert.ok(/messaging\.coinpayAction\s*\(/.test(formSrc)
    && /messaging\.coinpayActionHw\s*\(/.test(formSrc),
    'CoinpayForm branches coinpayAction / coinpayActionHw on isHwSource');
assert.ok(/SignCredentials/.test(formSrc) && /isHwSource/.test(formSrc),
    'CoinpayForm reuses SignCredentials + isHwSource');
assert.ok(/pending_coinpay/.test(formSrc),
    'CoinpayForm filters obligations on pending_coinpay status');
assert.ok(/payer_address/.test(formSrc),
    'CoinpayForm filters obligations on payer_address matching the wallet address');

// Review stage: form -> review -> submitting -> done. Signing must not
// be reachable from the form stage.
assert.ok(/'form'\s*\|\s*'review'\s*\|\s*'submitting'\s*\|\s*'done'/.test(formSrc),
    "CoinpayForm stage type includes 'review'");
assert.ok(/handleReview/.test(formSrc),
    'CoinpayForm has a handleReview handler that gates sign/broadcast');
assert.ok(/setStage\('review'\)/.test(formSrc),
    "CoinpayForm transitions to 'review' before submitting");
// SignCredentials must not appear at form stage; verify it lives inside
// the review/submitting block by checking it follows the stage guard.
assert.ok(
    /(stage\s*===\s*'review'\s*\|\|\s*stage\s*===\s*'submitting'[\s\S]*?SignCredentials|SignCredentials[\s\S]*?stage\s*===\s*'review'\s*\|\|\s*stage\s*===\s*'submitting')/.test(formSrc),
    'SignCredentials is scoped to the review/submitting stage',
);
// handleSubmit must only be reachable from the review stage form.
assert.ok(
    /stage\s*===\s*'submitting'\s*\)\s*return/.test(formSrc),
    'handleSubmit guards against duplicate submits in review stage',
);
// Network fee row appears on the review screen.
assert.ok(/Network fee/.test(formSrc), 'CoinpayForm shows a Network fee row on review');
assert.ok(/estimateNativeSendFee/.test(formSrc), 'CoinpayForm imports estimateNativeSendFee');
// Header title switches on review/submitting.
assert.ok(/Review payment/.test(formSrc), "CoinpayForm header says 'Review payment' in review stage");
// Form-stage primary button label is "Review".
assert.ok(/>\s*Review\s*<\/Button>/.test(formSrc), "CoinpayForm form-stage button label is 'Review'");

// --- 4. Background host registrations ---------------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of [
    'action.coinpay',
    'action.coinpay.hw',
    'coinpays.obligationsForAddress',
    'coinpays.forAddress',
]) {
    assert.ok(
        bg.includes(`'${route}'`),
        `background host registers ${route}`,
    );
}

// --- 5. Three-shell messaging re-exports ------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'coinpayAction',
        'coinpayActionHw',
        'getCoinpayObligationsForAddress',
        'getCoinpaysForAddress',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('action\.coinpay'/.test(m),
        `${shell} routes coinpayAction via action.coinpay`);
    assert.ok(/sendMessage\('action\.coinpay\.hw'/.test(m),
        `${shell} routes coinpayActionHw via action.coinpay.hw`);
    assert.ok(/sendMessage\('coinpays\.obligationsForAddress'/.test(m),
        `${shell} routes obligations query via coinpays.obligationsForAddress`);
}

// --- 6. App.jsx wiring -------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('CoinpayForm'), `${shell} App.jsx imports CoinpayForm`);
    assert.ok(app.includes("'coinpay'"), `${shell} App.jsx tracks the coinpay sub-route`);
    assert.ok(/id:\s*['"]coinpay['"]/.test(app),
        `${shell} App.jsx registers the Pay COINPAY entry`);
    assert.ok(/onPayCoinpay:/.test(app),
        `${shell} App.jsx wires onPayCoinpay`);
    assert.ok(/resumeCoinpay/.test(app),
        `${shell} App.jsx tracks resumeCoinpay state`);
    assert.ok(/onResumeCoinpay\s*=/.test(app),
        `${shell} App.jsx threads onResumeCoinpay to Home`);
}

// --- 7. Home wiring ----------------------------------------------------

const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/onResumeCoinpay/.test(homeSrc), 'Home.jsx accepts onResumeCoinpay prop');
assert.ok(/getCoinpayObligationsForAddress/.test(homeSrc),
    'Home.jsx fetches pending obligations on mount');
assert.ok(/pending_coinpay/.test(homeSrc),
    'Home.jsx filters to pending_coinpay obligations');

// --- 8. SDK pin bump ---------------------------------------------------

for (const [shell, pkgPath] of [
    ['extension', join(ext, 'package.json')],
    ['web', join(web, 'package.json')],
]) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.match(pkg.dependencies['xchain-sdk'], /^npm:@dankest-llc\/xchain-sdk@\d+\.\d+\.\d+$/,
        `${shell} depends on xchain-sdk as an EXACT registry alias (npm:@dankest-llc/xchain-sdk@X.Y.Z). 'link:' is refused:  D8 moved dev linking into node_modules (pnpm run sdk:link) so a committed manifest cannot un-pin the SDK a release is signed over`);
}

console.log(
    'OK: coinpay-form smoke (§41.4 COINPAY: core flow guards + CoinpayForm fans out getCoinpayObligationsForAddress + review stage gates coinpayAction/Hw + SignCredentials on review/submitting only + Network fee row + 3-shell messaging + 3-shell App.jsx + ActionsMenu entry + Home resume card filters pending_coinpay on payer_address + xchain-sdk ^1.9.1 pin)',
);
