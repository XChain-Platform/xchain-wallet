// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21: Step 3: Send.jsx checks balances before approval.
//
// Source-level checks that the form and Confirm Standard review now:
//   - fetch source balances for form and review stages
//   - use those balances for Available, Max, and overspend refusal
//   - show Total, facts, and warnings without the retired balance-change card
// Plus that the per-shell messaging modules expose getAddressBalances.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
const decoderIndex = join(wsRoot, 'packages', 'core', 'src', 'decoder', 'index.js');
const adapterPath = join(wsRoot, 'packages', 'core', 'src', 'decoder', 'balanceAdapter.js');
const popupMsg = join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js');
const webMsg = join(wsRoot, 'packages', 'web', 'src', 'messaging.js');

// --- 1. Decoder namespace re-exports the adapter ------------------------

const decIdx = readFileSync(decoderIndex, 'utf8');
assert.match(decIdx, /balancesFromSdk/, 'decoder/index.js re-exports balancesFromSdk');

// --- 2. balanceAdapter: basic semantic check ---------------------------

const adapter = await import(adapterPath);
assert.equal(typeof adapter.balancesFromSdk, 'function');

// 5,000,000 sats with divisibility 8 → '0.05'
{
    const out = adapter.balancesFromSdk({
        native: { tick: 'BTC', divisibility: 8, quantity: '5000000' },
        tokens: [
            { tick: 'MYTOKEN', divisibility: 0, quantity: '500' },
            { tick: 'XCP', divisibility: 8, quantity: '1200000000' },
        ],
    });
    const btc = out.find((r) => r.tick === 'BTC');
    assert.ok(btc.isCoin, 'native row marked isCoin');
    assert.equal(btc.amount, '0.05', 'sats scaled by divisibility');
    const my = out.find((r) => r.tick === 'MYTOKEN');
    assert.equal(my.amount, '500', 'divisibility=0 leaves the integer alone');
    assert.ok(!my.isCoin);
    const xcp = out.find((r) => r.tick === 'XCP');
    assert.equal(xcp.amount, '12', 'trailing zeros stripped');
}

// Empty / null shapes don't crash.
{
    assert.deepEqual(adapter.balancesFromSdk(null), []);
    assert.deepEqual(adapter.balancesFromSdk(undefined), []);
    assert.deepEqual(adapter.balancesFromSdk({}), []);
}

// Negative quantities preserved.
{
    const out = adapter.balancesFromSdk({
        native: { tick: 'BTC', divisibility: 8, quantity: '-1' },
    });
    assert.equal(out[0].amount, '-0.00000001');
}

// --- 3. Per-shell messaging exposes getAddressBalances ------------------

for (const path of [popupMsg, webMsg]) {
    const src = readFileSync(path, 'utf8');
    assert.match(
        src,
        /export function getAddressBalances\(/,
        `${path} exports getAddressBalances`,
    );
    assert.match(
        src,
        /sendMessage\('balances\.address'/,
        `${path} routes to balances.address host handler`,
    );
}

// --- 4. Send.jsx wiring -------------------------------------------------

const sendSrc = readFileSync(sendPath, 'utf8');

assert.doesNotMatch(sendSrc, /\n\s*<BalanceChanges|import \{ BalanceChanges \}/, 'G127 retires the balance-change card');
assert.match(sendSrc, /decoderLib\.balancesFromSdk/, 'feeds balances through balancesFromSdk');
assert.match(
    sendSrc,
    /messaging\.getAddressBalances\(chainId, fromAddress\.address\)/,
    'fetches single-address balances against the source',
);

// State has the three lifecycle fields.
assert.match(sendSrc, /loading:\s*false[^,]*,\s*error:\s*null[^,]*,\s*sdkShape:\s*null/);
assert.match(sendSrc, /loading:\s*true[^,]*,\s*error:\s*null/);

// Effect runs in form + review stages so Max, Available, and the safety
// checks all use a current source balance. Skips on submitting / done.
assert.match(
    sendSrc,
    /if \(stage !== 'review' && stage !== 'form'\) return undefined;|if \(\(stage !== 'review' && stage !== 'form'\) \|\| !chainId \|\| !fromAddress\) \{[\s\S]{0,160}?return undefined;/,
);

assert.match(
    sendSrc,
    /const sourceBalance = useMemo\([\s\S]{0,500}?decoderLib\.balancesFromSdk\(previewBalances\.sdkShape\)/,
    'source balance is derived from the fetched SDK shape',
);
assert.match(sendSrc, /Amount exceeds the available balance\./, 'single send refuses an overspend');
assert.match(sendSrc, /total .* across all recipients exceeds the available balance\./, 'multi-send total refuses an overspend');
assert.match(
    sendSrc,
    /balanceText=\{[\s\S]{0,700}?send\.balance\.available[\s\S]{0,180}?formatWithThousands\(sourceBalance\.amount\)/,
    'form shows the grouped Available balance before review',
);
const reviewStandardStart = sendSrc.indexOf('<ConfirmStandard', sendSrc.indexOf("stage === 'review'"));
const reviewStandardEnd = sendSrc.indexOf('</ConfirmStandard>', reviewStandardStart);
assert.ok(reviewStandardStart > 0 && reviewStandardEnd > reviewStandardStart, 'review mounts Confirm Standard');
const reviewStandard = sendSrc.slice(reviewStandardStart, reviewStandardEnd);
// No Total block (G127 revised 2026-11-16): the fee is a facts card row.
assert.doesNotMatch(reviewStandard, /total=\{/);
assert.match(reviewStandard, /facts=\{reviewFacts\}/);
assert.match(
    reviewStandard,
    /warning=\{reviewWarning\}/,
    'review warning is the short warning after the details',
);
assert.match(
    sendSrc,
    /const reviewFeeAmount = feeEstimate\?\.coinAmount[\s\S]{0,4000}?\.\.\.feeFacts\(reviewFees\)/,
    'known network fee is a row in the review facts card',
);

console.log('send-balance-preview smoke OK');
