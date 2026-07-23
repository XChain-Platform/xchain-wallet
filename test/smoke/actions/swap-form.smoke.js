// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 10 smoke: SWAP form (§41.5).
//
// Asserts:
//   1. swapAction flow exported from @xchain-wallet/core with input guards.
//   2. SwapForm.jsx exists and wires messaging.swapAction / swapActionHw
//      with the SignCredentials gate; rejects native-coin tickers and
//      same-ticker swaps.
//   3. Background host registers action.swap + action.swap.hw.
//   4. Three shells' messaging.js expose swapAction + swapActionHw routed
//      through action.swap / action.swap.hw.
//   5. Three App.jsx files track the 'swap' sub-route and register the
//      ActionsMenu 'swap' entry.

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

// --- 1. Flow exports + guards -----------------------------------------

assert.equal(typeof flows.swapAction, 'function', 'flows.swapAction exported');

await assert.rejects(async () => flows.swapAction(), /swapAction: opts is required/);
await assert.rejects(async () => flows.swapAction({ params: null }), /params is required/);
await assert.rejects(
    async () => flows.swapAction({ params: {} }),
    /GIVE_TICK is required/,
);
await assert.rejects(
    async () => flows.swapAction({ params: { GIVE_TICK: 'A' } }),
    /GIVE_AMOUNT is required/,
);
await assert.rejects(
    async () => flows.swapAction({ params: { GIVE_TICK: 'A', GIVE_AMOUNT: '1' } }),
    /GET_TICK is required/,
);
await assert.rejects(
    async () => flows.swapAction({
        params: { GIVE_TICK: 'A', GIVE_AMOUNT: '1', GET_TICK: 'B' },
    }),
    /GET_AMOUNT is required/,
);
// Ownership trading relaxes the amount requirement on the ownership side:
// GIVE_OWNERSHIP=1 drops GIVE_AMOUNT, so the surfaced error advances to
// GET_AMOUNT (proving GIVE_AMOUNT was no longer required).
await assert.rejects(
    async () => flows.swapAction({
        params: { GIVE_TICK: 'A', GIVE_OWNERSHIP: '1', GET_TICK: 'B' },
    }),
    /GET_AMOUNT is required/,
    'GIVE_OWNERSHIP=1 drops the GIVE_AMOUNT requirement',
);

// --- 2. SwapForm.jsx ---------------------------------------------------

const formPath = join(sharedRoutes, 'SwapForm.jsx');
assert.ok(existsSync(formPath), 'SwapForm.jsx exists');
const src = readFileSync(formPath, 'utf8');
assert.ok(/export function SwapForm\b/.test(src), 'SwapForm is a named export');
assert.ok(/messaging\.swapAction\s*\(/.test(src)
    && /messaging\.swapActionHw\s*\(/.test(src),
    'SwapForm branches swapAction / swapActionHw on isHwSource');
assert.ok(/SignCredentials/.test(src) && /isHwSource/.test(src),
    'SwapForm reuses SignCredentials + isHwSource');
assert.ok(/action:\s*['"]SWAP['"]|'SWAP'|"SWAP"/.test(src) || /VERSION:\s*['"]0['"]/.test(src),
    'SwapForm composes a v0 SWAP');
assert.ok(/DISPENSER for token ↔ native coin|cannot give|cannot get/.test(src),
    'SwapForm rejects native-coin tickers with a DISPENSER hint');
assert.ok(/Give and get tickers must differ/.test(src),
    'SwapForm rejects same-ticker swaps');
assert.ok(/GIVE_OWNERSHIP/.test(src) && /GET_OWNERSHIP/.test(src),
    'SwapForm composes GIVE_OWNERSHIP / GET_OWNERSHIP for token-name trades');
assert.ok(/setGiveOwnership/.test(src) && /setGetOwnership/.test(src),
    'SwapForm wires give/get ownership toggles');

// Review stage: form goes form -> review -> submitting -> done.
assert.ok(/'form' \| 'review' \| 'submitting' \| 'done'/.test(src),
    "SwapForm stage type includes 'review'");
assert.ok(/setStage\('review'\)/.test(src),
    'SwapForm calls setStage(review) on form submit');
assert.ok(/function handleReview\b/.test(src),
    'SwapForm has a handleReview handler that gates the review transition');
// Signing must never be reachable from handleReview.  gave the software
// path a second signing lane: openConfirmScreen, whose swapAction call fires
// only from the confirm page's Approve callback. Hardware + watcher still sign
// from handleSubmit. Neither lane may be called by handleReview itself.
{
    const reviewIdx = src.indexOf('function handleReview');
    const submitIdx = src.indexOf('function handleSubmit');
    const confirmIdx = src.indexOf('function openConfirmScreen');
    assert.ok(reviewIdx !== -1, 'handleReview is present');
    assert.ok(submitIdx !== -1, 'handleSubmit is present');
    assert.ok(confirmIdx !== -1, 'openConfirmScreen ( single-encode lane) is present');
    // handleReview must appear before handleSubmit in the file.
    assert.ok(reviewIdx < submitIdx, 'handleReview is defined before handleSubmit');
    // The software lane signs inside onApprove, never at review time.
    assert.ok(/onApprove: \(prebuiltPsbt\) => messaging\.swapAction\(/.test(src),
        'messaging.swapAction fires from the confirm page Approve callback');
    assert.ok(/prebuiltPsbt,/.test(src),
        'the approved PSBT is forwarded as prebuiltPsbt (single-encode)');
    // Hardware still signs from handleSubmit.
    const swapActionHwIdx = src.indexOf('messaging.swapActionHw(');
    assert.ok(swapActionHwIdx > submitIdx,
        'messaging.swapActionHw is gated behind handleSubmit (after review)');
    // handleReview itself contains no signing call. Its body ends at whichever
    // of the two signing lanes is declared next after it.
    const nextAfterReview = [submitIdx, confirmIdx]
        .filter((i) => i > reviewIdx)
        .sort((a, b) => a - b)[0];
    assert.ok(nextAfterReview !== undefined, 'a signing lane follows handleReview');
    const reviewBody = src.slice(reviewIdx, nextAfterReview);
    assert.ok(!/messaging\.swapAction(Hw)?\(/.test(reviewBody),
        'handleReview never calls a signing flow directly');
}
// On submit error, stage returns to 'review' (not 'form'). The setStage('review')
// call must appear inside handleSubmit (after its definition) and must not be
// the initial form-stage call (which is handled by setStage('form') in handleBuildAnother).
{
    const submitIdx = src.indexOf('function handleSubmit');
    const reviewInSubmit = src.indexOf("setStage('review')", submitIdx);
    assert.ok(reviewInSubmit !== -1 && reviewInSubmit > submitIdx,
        "SwapForm returns to 'review' stage (not 'form') on submit error");
}
// Fee estimate row appears on the review screen.
assert.ok(/estimateNativeSendFee/.test(src),
    'SwapForm imports and uses estimateNativeSendFee for the review screen');
assert.ok(/Network fee/.test(src),
    'SwapForm review screen shows a Network fee row');

// --- 3. Background handlers -------------------------------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of ['action.swap', 'action.swap.hw']) {
    assert.ok(bg.includes(`'${route}'`), `background host registers ${route}`);
}

// --- 4. Three-shell messaging re-exports -------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['swapAction', 'swapActionHw']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('action\.swap'/.test(m),
        `${shell} routes swapAction via action.swap`);
    assert.ok(/sendMessage\('action\.swap\.hw'/.test(m),
        `${shell} routes swapActionHw via action.swap.hw`);
}

// --- 5. App.jsx wiring -------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('SwapForm'), `${shell} App.jsx imports SwapForm`);
    assert.ok(app.includes("'swap'"), `${shell} App.jsx tracks the swap sub-route`);
    assert.ok(/id:\s*['"]swap['"]/.test(app),
        `${shell} App.jsx registers the Swap tokens entry`);
    assert.ok(/onSwap:/.test(app), `${shell} App.jsx wires onSwap`);
}

// --- 6. "Sell name" from ManageToken → ORDER-based SellOwnershipForm ----

// ManageToken exposes the Sell-name entry.
const manageSrc = readFileSync(join(sharedRoutes, 'ManageToken.jsx'), 'utf8');
assert.ok(/onSellOwnership/.test(manageSrc), 'ManageToken accepts onSellOwnership');
assert.ok(/id:\s*['"]sell-ownership['"]/.test(manageSrc), 'ManageToken renders the Sell-name action');

// SellOwnershipForm builds an ownership ORDER (GIVE_OWNERSHIP=1) and submits
// via orderAction; supports native-coin (GET_TICK omitted) + token prices.
const sellSrc = readFileSync(join(sharedRoutes, 'SellOwnershipForm.jsx'), 'utf8');
assert.ok(/export function SellOwnershipForm\b/.test(sellSrc), 'SellOwnershipForm is a named export');
assert.ok(/GIVE_OWNERSHIP:\s*'1'/.test(sellSrc), 'SellOwnershipForm escrows ownership (GIVE_OWNERSHIP=1)');
assert.ok(/messaging\.orderAction\b/.test(sellSrc), 'SellOwnershipForm submits via orderAction (ORDER, not SWAP)');
assert.ok(/messaging\.dispenserAction\b/.test(sellSrc),
    'SellOwnershipForm can also vend the name via dispenserAction (DISPENSER)');
assert.ok(/setMechanism/.test(sellSrc) && /'dispenser'/.test(sellSrc),
    'SellOwnershipForm offers an Order/Dispenser mechanism toggle');
assert.ok(/GET_TICK:\s*getTick/.test(sellSrc) && /getMode === 'token'/.test(sellSrc),
    'SellOwnershipForm only sets GET_TICK for token prices (native coin leaves it empty)');

// Each shell wires ManageToken → SellOwnershipForm via the sell-name view.
for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(/onSellOwnership=\{/.test(app), `${shell} App.jsx wires ManageToken onSellOwnership`);
    assert.ok(/setSellNameRef\(/.test(app), `${shell} App.jsx sets sellNameRef for the sell flow`);
    assert.ok(/unlockedView === 'sell-name'/.test(app), `${shell} App.jsx renders the sell-name view`);
    assert.ok(/<SellOwnershipForm/.test(app), `${shell} App.jsx renders SellOwnershipForm`);
}

console.log(
    'OK: swap-form smoke (§41.5 SWAP: swapAction core flow + input guards + ownership trading; SwapForm rejects native-coin + same-ticker; branches swap/Hw behind SignCredentials; background handlers + 3-shell messaging + 3-shell App.jsx + ActionsMenu entry; ManageToken "Sell name" → ORDER-based SellOwnershipForm (native coin + token) across 3 shells)',
);
