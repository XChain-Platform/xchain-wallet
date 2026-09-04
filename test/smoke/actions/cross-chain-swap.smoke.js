// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 15 of 23: Cross-chain swap form
// (§42.8.3).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'CrossChainSwapForm.jsx');
assert.ok(existsSync(formPath), 'CrossChainSwapForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function CrossChainSwapForm\b/.test(src),
    'CrossChainSwapForm is a named export');

// Two chain pickers (give-chain + get-chain) with auto-filled
// receiver on the get-chain.
assert.ok(/giveChainId/.test(src), 'CrossChainSwapForm tracks giveChainId');
assert.ok(/getChainId/.test(src), 'CrossChainSwapForm tracks getChainId');
assert.ok(/getNewestAddress/.test(src),
    'CrossChainSwapForm auto-fills the receiver via getNewestAddress');
assert.ok(/getAddressTouched/.test(src),
    'CrossChainSwapForm preserves the user-entered receiver address when touched');

// Cross-chain SWAP requires GIVE_COIN ≠ GET_COIN.
assert.ok(/Give and get chains must differ/.test(src),
    'CrossChainSwapForm rejects same-chain swaps and points users to Swap tokens');

// Native-coin rule still enforced (DISPENSER lane, humanized copy).
assert.ok(/cannot give/i.test(src),
    'CrossChainSwapForm preserves the native-coin DISPENSER rule on the give side');
assert.ok(/cannot get/i.test(src),
    'CrossChainSwapForm preserves the native-coin DISPENSER rule on the get side');

// Reuses the existing swapAction handler; no new core flow needed.
for (const call of [
    'messaging.swapAction',
    'messaging.swapActionHw',
    'messaging.getAddressesByChain',
    'messaging.getNewestAddress',
]) {
    assert.ok(src.includes(call), `CrossChainSwapForm calls ${call}`);
}

// HW vs software signing branches.
assert.ok(/SignCredentials/.test(src), 'CrossChainSwapForm uses SignCredentials');
assert.ok(/isHwSource/.test(src), 'CrossChainSwapForm branches on isHwSource');

// EXPIRATION + GET_ADDRESS appear in the SWAP params.
assert.ok(/GET_ADDRESS/.test(src),
    'CrossChainSwapForm sets GET_ADDRESS on the SWAP params');
assert.ok(/EXPIRATION/.test(src),
    'CrossChainSwapForm sets EXPIRATION on the SWAP params');

// Review/confirm stage: signing is gated behind a review screen.
assert.ok(/'form' \| 'review' \| 'submitting' \| 'done'/.test(src),
    'CrossChainSwapForm stage type includes review');
assert.ok(/setStage\('review'\)/.test(src),
    'CrossChainSwapForm advances to review stage before signing');
assert.ok(/function handleReview\b/.test(src),
    'CrossChainSwapForm form submit handler is handleReview (not handleSubmit)');
assert.ok(/onSubmit=\{handleReview\}/.test(src),
    'CrossChainSwapForm form element uses handleReview as its onSubmit');
// handleSubmit is only reachable from the review stage form.
assert.ok(/stage === 'review' \|\| stage === 'submitting'/.test(src),
    'CrossChainSwapForm renders sign block only in review/submitting stage');
// On error, stage reverts to review (not form).
assert.ok(/setStage\('review'\)/.test(src),
    'CrossChainSwapForm reverts to review stage on submit error');
// Review screen shows fee estimate from the give chain.
assert.ok(/estimateNativeSendFee/.test(src),
    'CrossChainSwapForm imports and calls estimateNativeSendFee for the review screen');
assert.ok(/Network fee/.test(src),
    'CrossChainSwapForm review screen includes a Network fee row');
// Header title switches on stage.
assert.ok(/Review swap/.test(src),
    'CrossChainSwapForm header title says "Review swap" in review/submitting stage');
// Form-stage primary button label: the action verb on the confirm lane,
// "Review" only on the watcher lane that still has a review stage. The
// same shape SwapForm carries, which is the point of migrating this form.
assert.ok(/singleEncode \? 'Swap' : 'Review'/.test(src),
    'CrossChainSwapForm labels its primary button "Swap" on the confirm lane');

// §5.6 confirm lane: the cross-chain GET_ADDRESS is a destination on ANOTHER
// chain, and the confirm page's output-set cross-check is the only thing
// binding the address the user read to the bytes that get signed. SwapForm,
// the other caller of this same action pair, has been on the lane for longer.
assert.ok(/useActionConfirmFlow/.test(src),
    'CrossChainSwapForm is on the shared confirm lane');
assert.ok(/const singleEncode = !isWatcherMode/.test(src),
    'CrossChainSwapForm single-encodes on every non-watcher lane, hardware included');
assert.ok(/software: 'swapAction'[\s\S]{0,80}hardware: 'swapActionHw'/.test(src),
    'CrossChainSwapForm dispatches Approve through useConfirmSubmit');
assert.ok(/prebuiltPsbt,/.test(src),
    'CrossChainSwapForm submits the previewed PSBT rather than rebuilding it');

// --- App.jsx wiring (all three shells) ---

// The web shell keeps its DEX routing in `packages/web/src/surfaces/dex.jsx`
// rather than inline in App.jsx: a store-profile build swaps that
// module for a twin that imports nothing, which is how the surface is
// compiled out. The two files together are that shell's wiring, so read them
// as one - asserting on App.jsx alone would go green on a shell that has no
// DEX at all.
const WEB_DEX_SURFACE = join(web, 'src', 'surfaces', 'dex.jsx');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8')
        + (shell === 'web' ? readFileSync(WEB_DEX_SURFACE, 'utf8') : '');
    assert.ok(app.includes('CrossChainSwapForm'),
        `${shell} App.jsx imports CrossChainSwapForm`);
    assert.ok(app.includes("'cross-chain-swap'"),
        `${shell} tracks 'cross-chain-swap' sub-route`);
    assert.ok(/onCrossChainSwap: (?:DEX_SURFACE_ENABLED \? )?\(\) => setUnlockedView\('cross-chain-swap'\)/.test(app),
        `${shell} ActionsMenu wires onCrossChainSwap → 'cross-chain-swap'`);
    assert.ok(/<CrossChainSwapForm\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <CrossChainSwapForm> with the active walletId`);
    assert.ok(surfacesEntry(app, 'cross-chain-swap', 'Cross-chain swap'),
        `${shell} ActionsMenu surfaces the "Cross-chain swap" entry`);
}

console.log(
    'OK: cross-chain swap smoke (CrossChainSwapForm §42.8.3 give-chain + get-chain pickers + auto-filled receiver via getNewestAddress + GIVE_COIN/GET_COIN asymmetry validation + native-coin DISPENSER rule retained + reuses swapAction core flow + HW vs software signing + review/confirm stage gates signing + network fee on review + 3-shell App.jsx + ActionsMenu entry)',
);
