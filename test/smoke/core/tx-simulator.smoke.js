// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for §21.2 transaction simulator (Step 1 of 6).
//
// Covers:
//   1. Pure simulator: SEND token / SEND coin / SWEEP / MINT / DESTROY /
//      ISSUE (create + lock + transfer-only) / DIVIDEND / DISPENSER
//      (open + cancel + edit-refill) / BROADCAST (v0/v1/v2/v3) / AIRDROP /
//      LIST / BATCH (recursive aggregation) / generic fallback.
//   2. Decimal-string arithmetic: BTC-precision sat-level adds /
//      subtracts, no float drift.
//   3. Static wiring: core/decoder/index.js re-exports `simulateAction`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    decoder as decoderLib,
    registry as registryLib,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const chainRegistry = registryLib.defaultRegistry();
const balances = [
    { tick: 'BTC', amount: '0.05', isCoin: true },
    { tick: 'MYTOKEN', amount: '500' },
    { tick: 'XCP', amount: '12' },
];

// --- 1. Per-action simulators -------------------------------------------

// 1a. SEND token: token decremented; coin shows fee row only.
{
    const r = decoderLib.simulateAction({
        action: 'SEND',
        params: { TICK: 'MYTOKEN', AMOUNT: '100', DESTINATION: 'bc1qxyz' },
        balances,
        feeEstimate: '0.0003',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.ok(token, 'MYTOKEN delta present');
    assert.equal(token.before, '500');
    assert.equal(token.after, '400');
    assert.equal(token.isCoin, false);
    const fee = r.deltas.find((d) => d.isFee);
    assert.ok(fee, 'fee row present');
    assert.equal(fee.feeAmount, '0.0003');
    assert.equal(fee.tick, 'BTC');
    assert.equal(r.sideEffects.length, 0);
    assert.equal(r.notes.length, 0);
}

// 1b. SEND coin: fee folded into the coin row's `after`; separate
// fee-label row carries `feeAmount`.
{
    const r = decoderLib.simulateAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '0.01', DESTINATION: 'bc1qxyz' },
        balances,
        feeEstimate: '0.0003',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const coinRows = r.deltas.filter((d) => d.tick === 'BTC');
    assert.equal(coinRows.length, 2, 'one balance row + one fee-label row');
    const balRow = coinRows.find((d) => !d.isFee);
    assert.equal(balRow.before, '0.05');
    assert.equal(balRow.after, '0.0397');
    const feeRow = coinRows.find((d) => d.isFee);
    assert.equal(feeRow.feeAmount, '0.0003');
    assert.equal(feeRow.before, '');
    assert.equal(feeRow.after, '');
}

// 1c. SWEEP: every non-coin tick → 0; the coin is NOT swept (it sits in
// UTXOs and change returns to the source), so its row is the fee debit
// only; "Sweep moves..." note.
{
    const r = decoderLib.simulateAction({
        action: 'SWEEP',
        params: { DESTINATION: 'bc1qrecip' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const my = r.deltas.find((d) => d.tick === 'MYTOKEN');
    const xcp = r.deltas.find((d) => d.tick === 'XCP');
    const btc = r.deltas.find((d) => d.tick === 'BTC');
    assert.equal(my.after, '0');
    assert.equal(xcp.after, '0');
    assert.equal(btc.before, '0.05');
    assert.equal(btc.after, '0.0499');
    assert.equal(btc.isFee, true);
    assert.ok(r.notes.some((n) => /sweep moves/i.test(n)));
    assert.ok(r.notes.some((n) => /not swept/i.test(n)));
}

// 1d. MINT to self: token increments; supply side-effect.
{
    const r = decoderLib.simulateAction({
        action: 'MINT',
        params: { TICK: 'MYTOKEN', AMOUNT: '50' },
        balances,
        feeEstimate: '0.0002',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.equal(token.after, '550');
    const supply = r.sideEffects.find((s) => s.kind === 'supply');
    assert.ok(supply);
    assert.match(supply.value, /\+50/);
}

// 1e. MINT to someone else: no source balance change; still surfaces supply.
{
    const r = decoderLib.simulateAction({
        action: 'MINT',
        params: { TICK: 'MYTOKEN', AMOUNT: '50', DESTINATION: 'bc1qfriend' },
        balances,
        feeEstimate: '0.0002',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(!r.deltas.find((d) => d.tick === 'MYTOKEN' && !d.isFee));
    assert.ok(r.sideEffects.find((s) => s.kind === 'supply'));
}

// 1f. DESTROY: token down + irreversibility note.
{
    const r = decoderLib.simulateAction({
        action: 'DESTROY',
        params: { TICK: 'MYTOKEN', AMOUNT: '40' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.equal(token.after, '460');
    assert.ok(r.notes.some((n) => /irreversible/i.test(n)));
    assert.ok(r.sideEffects.some((s) => /−40/.test(s.value)));
}

// 1g. ISSUE v0 fresh-create: supply + initial mint side-effects + token row.
{
    const r = decoderLib.simulateAction({
        action: 'ISSUE',
        params: {
            VERSION: '0',
            TICK: 'NEWCOIN',
            MAX_SUPPLY: '1000000',
            MINT_SUPPLY: '1000000',
        },
        balances,
        feeEstimate: '0.0005',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'NEWCOIN');
    assert.ok(token, 'NEWCOIN row from initial mint');
    assert.equal(token.before, '0');
    assert.equal(token.after, '1000000');
    assert.ok(r.sideEffects.some((s) => s.kind === 'token-create'));
    assert.ok(r.sideEffects.some((s) => s.kind === 'supply'));
}

// 1h. ISSUE v0 transfer-only: no balance change, ownership side-effect.
{
    const r = decoderLib.simulateAction({
        action: 'ISSUE',
        params: { VERSION: '0', TICK: 'MYTOKEN', TRANSFER: 'bc1qnewowner' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(!r.deltas.find((d) => d.tick === 'MYTOKEN' && !d.isFee));
    assert.ok(r.sideEffects.some((s) => s.kind === 'ownership'));
}

// 1i. ISSUE v3 lock: note about permanence.
{
    const r = decoderLib.simulateAction({
        action: 'ISSUE',
        params: { VERSION: '3', TICK: 'MYTOKEN', LOCK_MAX_SUPPLY: '1' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.notes.some((n) => /locking is permanent/i.test(n)));
    assert.ok(r.sideEffects.some((s) => s.kind === 'lock'));
}

// 1j. DIVIDEND: pool side-effect + holder-count caveat.
{
    const r = decoderLib.simulateAction({
        action: 'DIVIDEND',
        params: { TICK: 'MYTOKEN', DIVIDEND_TICK: 'XCP', AMOUNT: '0.5' },
        balances,
        feeEstimate: '0.0002',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.sideEffects.some((s) => s.kind === 'dividend'));
    assert.ok(r.notes.some((n) => /holder count/i.test(n)));
}

// 1k. DISPENSER v0 open: escrow debit on the give-token.
{
    const r = decoderLib.simulateAction({
        action: 'DISPENSER',
        params: {
            VERSION: '0',
            GIVE_TICK: 'MYTOKEN',
            GIVE_AMOUNT: '10',
            GIVE_ESCROW: '100',
            GET_COIN: 'BTC',
            GET_AMOUNT: '0.001',
        },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.equal(token.after, '400');
    assert.ok(r.sideEffects.some((s) => /opens/i.test(s.value)));
}

// 1l. DISPENSER v1 cancel: note-only side-effect.
{
    const r = decoderLib.simulateAction({
        action: 'DISPENSER',
        params: { VERSION: '1', DISPENSER_ACTION_INDEX: '99' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.sideEffects.some((s) => /cancel/i.test(s.value)));
    assert.ok(!r.deltas.find((d) => d.tick === 'MYTOKEN' && !d.isFee));
}

// 1m. DISPENSER v2 edit-refill: debits give-tick by GIVE_ESCROW.
{
    const r = decoderLib.simulateAction({
        action: 'DISPENSER',
        params: {
            VERSION: '2',
            DISPENSER_ACTION_INDEX: '99',
            GIVE_TICK: 'MYTOKEN',
            GIVE_ESCROW: '50',
        },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.equal(token.after, '450');
    assert.ok(r.sideEffects.some((s) => /refill/i.test(s.value)));
}

// 1n. BROADCAST v0/v1/v2/v3: each gets its own labeled side-effect.
{
    for (const [version, expect] of [
        ['0', /Broadcast/],
        ['1', /Oracle/],
        ['2', /Feed/],
        ['3', /Feed result/],
    ]) {
        const r = decoderLib.simulateAction({
            action: 'BROADCAST',
            params: { VERSION: version, MESSAGE: 'feedX', VALUE: '7' },
            balances,
            feeEstimate: '0.0001',
            chainId: 'bitcoin-mainnet',
            chainRegistry,
        });
        assert.ok(r.sideEffects.some((s) => expect.test(s.label)),
            `BROADCAST v${version} side-effect label matches ${expect}`);
    }
}

// 1o. AIRDROP: note about list-size unknowability.
{
    const r = decoderLib.simulateAction({
        action: 'AIRDROP',
        params: { VERSION: '0', TICK: 'MYTOKEN', AMOUNT: '5', LIST_ACTION_INDEX: '12' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.notes.some((n) => /list size/i.test(n)));
    assert.ok(r.sideEffects.some((s) => /per recipient/i.test(s.value)));
}

// 1p. LIST: counts items, distinguishes TICK vs ADDRESS lists.
{
    const r = decoderLib.simulateAction({
        action: 'LIST',
        params: { VERSION: '0', TYPE: '2', ITEM: ['bc1q1', 'bc1q2', 'bc1q3'] },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.sideEffects.some((s) => /3 address entries/.test(s.value)));
}

// 1q. BATCH: sub-action deltas aggregate; one fee row at the end.
{
    const r = decoderLib.simulateAction({
        action: 'BATCH',
        params: {
            COMMANDS: [
                { action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '50', DESTINATION: 'bc1qa' } },
                { action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '30', DESTINATION: 'bc1qb' } },
            ],
        },
        balances,
        feeEstimate: '0.0005',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN');
    assert.equal(token.before, '500');
    assert.equal(token.after, '420', 'BATCH aggregates the two 50+30 debits');
    const feeRows = r.deltas.filter((d) => d.isFee);
    assert.equal(feeRows.length, 1, 'one fee row, not one per sub-action');
}

// 1r. Generic fallback: fee row + a "not pre-simulated" note.
{
    const r = decoderLib.simulateAction({
        action: 'ORDER',
        params: { GIVE_TICK: 'XCP', GIVE_AMOUNT: '5' },
        balances,
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(r.notes.some((n) => /not pre-simulated/i.test(n)));
    assert.equal(r.sideEffects.length, 0);
    assert.ok(r.deltas.some((d) => d.isFee));
}

// 1s. Empty / null balances + no fee → no delta rows, no crash.
{
    const r = decoderLib.simulateAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '0.01', DESTINATION: 'bc1qx' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    // Coin row reads against zero balance.
    const coinRows = r.deltas.filter((d) => d.tick === 'BTC' && !d.isFee);
    assert.equal(coinRows.length, 1);
    assert.equal(coinRows[0].before, '0');
    assert.equal(coinRows[0].after, '-0.01');
}

// --- 2. Decimal-string arithmetic --------------------------------------

// 2a. BTC sat-level precision survives a SEND that crosses scale.
{
    const r = decoderLib.simulateAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '0.00000001', DESTINATION: 'bc1qx' },
        balances: [{ tick: 'BTC', amount: '1.00000010', isCoin: true }],
        feeEstimate: '0.00000005',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const coinRow = r.deltas.find((d) => d.tick === 'BTC' && !d.isFee);
    // 1.00000010 - 0.00000001 - 0.00000005 = 1.00000004 (folded fee)
    assert.equal(coinRow.after, '1.00000004', 'sat-level precision survives');
}

// 2b. Negative result formatting (would never happen in practice but
// the formatter shouldn't drop the sign).
{
    const r = decoderLib.simulateAction({
        action: 'SEND',
        params: { TICK: 'MYTOKEN', AMOUNT: '600', DESTINATION: 'bc1qx' },
        balances: [
            { tick: 'BTC', amount: '0.05', isCoin: true },
            { tick: 'MYTOKEN', amount: '500' },
        ],
        feeEstimate: '0.0001',
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    const token = r.deltas.find((d) => d.tick === 'MYTOKEN' && !d.isFee);
    assert.equal(token.after, '-100', 'negative result preserved with leading minus');
}

// --- 3. Static wiring ---------------------------------------------------

// 3a. core/decoder/index.js re-exports simulateAction.
{
    const path = join(wsRoot, 'packages', 'core', 'src', 'decoder', 'index.js');
    const src = readFileSync(path, 'utf8');
    assert.match(src, /simulateAction/);
}

// 3b. core/src/index.js still exports `decoder` namespace and the
// decoder namespace now contains `simulateAction`.
{
    assert.equal(typeof decoderLib.simulateAction, 'function');
    assert.equal(typeof decoderLib.decodeAction, 'function');
}

console.log('OK tx-simulator.smoke');
