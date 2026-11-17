// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 6 smoke: Place Order form (§41.3.4) + ORDER action
// flow + CANCEL helper (§41.3.5 prereq) + 3-shell messaging wiring +
// HW branch wired through the shared SignCredentials path.

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
const desk = join(wsRoot, 'packages', 'desktop');

// --- 1. Flow exports ---------------------------------------------

assert.equal(typeof flows.orderAction, 'function', 'flows.orderAction exported');
assert.equal(typeof flows.cancelOrder, 'function', 'flows.cancelOrder exported');

// --- 2. orderAction guard rails ---------------------------------

// PC-16: an empty GIVE_TICK is the native-coin lane (auto-pay's arming
// shape), so the guard is now the SDK's "at least one side has a TICK"
// rule rather than a hard GIVE_TICK requirement.
await assert.rejects(
    flows.orderAction({ params: {} }),
    /at least one of params\.GIVE_TICK or params\.GET_TICK is required/,
);
await assert.rejects(
    flows.orderAction({ params: { GIVE_TICK: 'A' } }),
    /GIVE_AMOUNT is required/,
);
await assert.rejects(
    flows.orderAction({
        params: { GIVE_TICK: 'A', GIVE_AMOUNT: '1', GET_TICK: 'B' },
    }),
    /GET_AMOUNT is required/,
);
// Ownership orders relax the amount requirement: GIVE_OWNERSHIP=1 drops the
// GIVE_AMOUNT requirement (so the surfaced error advances to GET_AMOUNT),
// enabling sell-name orders (native coin leaves GET_TICK empty).
await assert.rejects(
    flows.orderAction({
        params: { GIVE_TICK: 'JDOG', GIVE_OWNERSHIP: '1' },
    }),
    /GET_AMOUNT is required/,
    'GIVE_OWNERSHIP=1 drops the GIVE_AMOUNT requirement',
);

// --- 3. cancelOrder guard rails ---------------------------------

await assert.rejects(
    flows.cancelOrder({}),
    /orderActionIndex is required/,
);

// --- 4. PlaceOrderPanel static wiring ---------------------------

const panelPath = join(core, 'src', 'shared', 'components', 'PlaceOrderPanel.jsx');
assert.ok(existsSync(panelPath), 'PlaceOrderPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function PlaceOrderPanel\b/.test(src),
    'PlaceOrderPanel is a named export');
assert.ok(/messaging\.orderAction\(/.test(src)
    && /messaging\.orderActionHw\(/.test(src),
    'PlaceOrderPanel branches between orderAction and orderActionHw on isHwSource');
assert.ok(/SignCredentials/.test(src) && /isHwSource/.test(src),
    'PlaceOrderPanel uses the shared SignCredentials + isHwSource helpers');
// PC-17: EXPIRATION is a wall-clock Unix timestamp, NOT a block height
// (block counts index invalid as "past"); presets are durations converted
// to a future Unix timestamp, 'default' omits the field.
assert.ok(/EXPIRATION_PRESETS/.test(src) && /expirationUnix/.test(src),
    'PlaceOrderPanel exposes expiration presets + writes EXPIRATION as a Unix timestamp');
assert.ok(!/blocks: \d+/.test(src) && !/expirationBlocks/.test(src),
    'PlaceOrderPanel no longer emits block-count expirations');
assert.ok(/side === 'buy'/.test(src)
    && /t\('components\.placeOrderPanel\.buy'\)\} \{tick1\}/.test(src)
    && /t\('components\.placeOrderPanel\.sell'\)\} \{tick1\}/.test(src),
    'PlaceOrderPanel has a buy/sell toggle bound to tick1');
assert.ok(/prefillPrice/.test(src) && /setPrice\(prefillPrice\)/.test(src),
    'PlaceOrderPanel accepts + applies prefillPrice from the orderbook click');
// Buy vs sell param orientation.
assert.ok(/p\.GIVE_TICK = tick2/.test(src) && /p\.GET_TICK = tick1/.test(src),
    'Buy side gives tick2 to get tick1');
assert.ok(/p\.GIVE_TICK = tick1/.test(src) && /p\.GET_TICK = tick2/.test(src),
    'Sell side gives tick1 to get tick2');

// --- 4b. Confirm Standard handoff --------------------------------

assert.ok(/function handleReview\b/.test(src), 'handleReview function defined');
assert.ok(/onSubmit={handleReview}/.test(src),
    'form onSubmit is handleReview (not handleSubmit)');
assert.match(src, /if \(singleEncode\) \{ openConfirmScreen\(\); return; \}/,
    'signed orders hand the validated action directly to the shared confirm flow');
assert.match(src, /<ActionConfirmScreen\b/, 'signed orders render Confirm Standard');
assert.match(src, /<ConfirmActionModal\b/, 'watcher orders render the Confirm Standard adapter');
assert.ok(/estimateNativeSendFee/.test(src),
    'PlaceOrderPanel computes the known fee before confirmation');
assert.match(src, /networkFee=\{feeEstimate\?\.coinAmount \? \{[\s\S]{0,160}amount: String\(feeEstimate\.coinAmount\)/,
    'watcher confirmation passes the known network fee to Confirm Standard');
assert.match(src, /feeText=\{feeEstimate\?\.coinAmount[\s\S]{0,160}t\('send\.networkFeeValue'/,
    'signed confirmation passes the known network fee to Confirm Standard');

// --- 5. Background handlers --------------------------------------

const bgSrc = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    'action.order', 'action.cancelOrder',
    'action.order.hw', 'action.cancelOrder.hw',
]) {
    const re = new RegExp(`['\"]${h.replace('.', '\\.')}['\"]`);
    assert.ok(re.test(bgSrc), `background registers ${h}`);
}

// --- 6. Three-shell messaging helpers ---------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desk, 'renderer', 'messaging.js')],
]) {
    const msg = readFileSync(msgPath, 'utf8');
    for (const fn of ['orderAction', 'orderActionHw', 'cancelOrder', 'cancelOrderHw']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(msg),
            `${shell} messaging exports ${fn}`,
        );
    }
}

console.log(
    'OK: place-order smoke (order and cancel flows guard required fields; PlaceOrderPanel maps buy and sell orientation, expiration, Confirm Standard handoff and known fees; watcher and signed confirms share the standard adapters; background handlers and three-shell messaging are registered)',
);
