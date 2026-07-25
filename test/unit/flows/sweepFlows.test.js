// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-34 SWEEP flows: the indicative preview, the force-close cleanup
// (auto-pay consents + reservation holds), the vault key re-scope for
// migration, and the wire-params shape submitAction receives.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'sweep-txid-1' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    assertValidDestination: vi.fn(),
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { sweepToken } from '../../../packages/core/src/flows/sweepToken.js';
import { sweepPreview } from '../../../packages/core/src/flows/sweepPreview.js';
import { createReservationLedger } from '../../../packages/core/src/flows/reservationLedger.js';
import { disableAutopayForAddress } from '../../../packages/core/src/flows/autopayConsent.js';
import { copyGatedKeysToWallet } from '../../../packages/core/src/flows/gatedContent.js';
import { createAutopayOrder } from '../../../packages/core/src/schemas/autopayOrder.js';
import { createGatedKey, gatedKeyId } from '../../../packages/core/src/schemas/gatedKey.js';

const CHAIN = 'bitcoin-regtest';
const ADDR = 'addr-src-1';
const DEST = 'addr-dest-1';

function makeVault({ autopayRows = [], gatedKeyRows = [] } = {}) {
    const autopay = new Map();
    for (const r of autopayRows) autopay.set(r.id, r);
    const gated = new Map();
    for (const r of gatedKeyRows) gated.set(r.id, r);
    return {
        autopayOrders: {
            get: vi.fn(async (id) => autopay.get(id) || null),
            put: vi.fn(async (r) => { autopay.set(r.id, r); }),
            list: vi.fn(async () => Array.from(autopay.values())),
        },
        gatedKeys: {
            get: vi.fn(async (id) => gated.get(id) || null),
            put: vi.fn(async (r) => { gated.set(r.id, r); }),
            list: vi.fn(async () => Array.from(gated.values())),
        },
        _autopay: autopay,
        _gated: gated,
    };
}

function consentRow({ address = ADDR, chainId = CHAIN, txid = 'tx1', autopay = true, walletId = 'w1' } = {}) {
    return createAutopayOrder({
        walletId,
        chainId,
        sourceAddress: address,
        txid,
        giveCoinAmount: '0.05',
        getTick: 'PEPE',
        getAmount: '1000',
        autopay,
    });
}

const FROM = { address: ADDR, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", addressId: 'a1' };

function sweepOpts(vault, extra = {}) {
    return {
        vault,
        walletId: 'w1',
        password: 'pw',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: CHAIN,
        from: FROM,
        to: DEST,
        ...extra,
    };
}

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
    vi.mocked(submitAction).mockResolvedValue({ txid: 'sweep-txid-1' });
});

describe('sweepToken wire params', () => {
    it('encodes SWEEP v0 params with protocol defaults and forwards prebuiltPsbt', async () => {
        const vault = makeVault();
        const prebuilt = { psbtHex: 'dead', encoding: 'op_return', actionString: 'SWEEP|0|x', version: 0 };
        await sweepToken(sweepOpts(vault, { memo: 'bye', prebuiltPsbt: prebuilt }));
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.actionData.action).toBe('SWEEP');
        expect(call.actionData.params).toEqual({
            DESTINATION: DEST,
            BALANCES: '1',
            OWNERSHIPS: '1',
            ORDERS: '0',
            SWAPS: '0',
            DISPENSERS: '0',
            MEMO: 'bye',
        });
        expect(call.prebuiltPsbt).toBe(prebuilt);
    });

    it('refuses an all-flags-off no-op sweep', async () => {
        await expect(sweepToken(sweepOpts(makeVault(), {
            balances: false, ownerships: false,
        }))).rejects.toThrow(/no-op/);
        expect(submitAction).not.toHaveBeenCalled();
    });
});

describe('sweepToken force-close cleanup (PC-34 x PC-16)', () => {
    it('ORDERS=1 disables the swept address consents and releases its tagged holds', async () => {
        const mine = consentRow({ txid: 'tx-mine' });
        const other = consentRow({ address: 'addr-other', txid: 'tx-other' });
        const otherChain = consentRow({ chainId: 'litecoin-regtest', txid: 'tx-ltc' });
        const vault = makeVault({ autopayRows: [mine, other, otherChain] });
        const ledger = createReservationLedger();
        await ledger.reserve({ id: 'autopay:1', chainId: CHAIN, tick: 'BTC', amount: '0.1', address: ADDR });
        await ledger.reserve({ id: 'autopay:2', chainId: CHAIN, tick: 'BTC', amount: '0.2', address: 'addr-other' });
        await ledger.reserve({ id: 'untagged', chainId: CHAIN, tick: 'BTC', amount: '0.3' });

        const res = await sweepToken(sweepOpts(vault, { orders: true, reservationLedger: ledger }));

        expect(res.txid).toBe('sweep-txid-1');
        expect(res.forceClose).toEqual({ autopayDisabled: 1, holdsReleased: 1, error: null });
        expect(vault._autopay.get(mine.id).autopay).toBe(false);
        expect(vault._autopay.get(other.id).autopay).toBe(true);
        expect(vault._autopay.get(otherChain.id).autopay).toBe(true);
        const left = await ledger.all();
        expect(left.map((r) => r.id).sort()).toEqual(['autopay:2', 'untagged']);
    });

    it('runs no cleanup when ORDERS stays off', async () => {
        const mine = consentRow();
        const vault = makeVault({ autopayRows: [mine] });
        const res = await sweepToken(sweepOpts(vault));
        expect(res.forceClose).toBeUndefined();
        expect(vault._autopay.get(mine.id).autopay).toBe(true);
    });

    it('runs no cleanup when the submit produced no broadcast txid', async () => {
        vi.mocked(submitAction).mockResolvedValue({ psbtHex: 'unsigned' });
        const mine = consentRow();
        const vault = makeVault({ autopayRows: [mine] });
        const res = await sweepToken(sweepOpts(vault, { orders: true }));
        expect(res.forceClose).toBeUndefined();
        expect(vault._autopay.get(mine.id).autopay).toBe(true);
    });

    it('a cleanup failure surfaces on the result and never fails the sweep', async () => {
        const mine = consentRow();
        const vault = makeVault({ autopayRows: [mine] });
        vault.autopayOrders.list.mockRejectedValue(new Error('vault sealed'));
        const res = await sweepToken(sweepOpts(vault, { orders: true }));
        expect(res.txid).toBe('sweep-txid-1');
        expect(res.forceClose.error).toMatch(/vault sealed/);
    });
});

describe('disableAutopayForAddress', () => {
    it('flips only enabled records matching wallet+chain+address', async () => {
        const a = consentRow({ txid: 't1' });
        const already = consentRow({ txid: 't2', autopay: false });
        const otherWallet = consentRow({ txid: 't3', walletId: 'w2' });
        const vault = makeVault({ autopayRows: [a, already, otherWallet] });
        const disabled = await disableAutopayForAddress({
            vault, walletId: 'w1', chainId: CHAIN, sourceAddress: ADDR,
        });
        expect(disabled).toHaveLength(1);
        expect(disabled[0].id).toBe(a.id);
        expect(vault._autopay.get(a.id).autopay).toBe(false);
        expect(vault._autopay.get(already.id).autopay).toBe(false);
        expect(vault._autopay.get(otherWallet.id).autopay).toBe(true);
    });
});

describe('reservationLedger address tagging', () => {
    it('carries the optional address and releaseByAddress touches only tagged rows', async () => {
        const led = createReservationLedger();
        await led.reserve({ id: 'a', chainId: 'btc', tick: 'BTC', amount: '1', address: 'x' });
        await led.reserve({ id: 'b', chainId: 'btc', tick: 'BTC', amount: '2' });
        await led.reserve({ id: 'c', chainId: 'ltc', tick: 'LTC', amount: '3', address: 'x' });
        expect((await led.all()).find((r) => r.id === 'a').address).toBe('x');
        const released = await led.releaseByAddress('btc', 'x');
        expect(released).toBe(1);
        expect((await led.all()).map((r) => r.id).sort()).toEqual(['b', 'c']);
        expect(await led.releaseByAddress('btc', '')).toBe(0);
    });
});

describe('copyGatedKeysToWallet (migrate custody leg)', () => {
    const KEY = 'ab'.repeat(32);
    const HASH = 'cd'.repeat(32);
    function keyRow(walletId, tick = 'GATED', hash = HASH, chainId = CHAIN) {
        return createGatedKey({
            walletId, chainId, gateTicker: tick, keyHash: hash, keyHex: KEY, source: 'recovered',
        });
    }

    it('re-scopes rows to the target wallet without touching the originals', async () => {
        const vault = makeVault({ gatedKeyRows: [keyRow('legacy')] });
        const res = await copyGatedKeysToWallet({ vault, fromWalletId: 'legacy', toWalletId: 'fresh' });
        expect(res).toEqual({ copied: 1, skipped: 0 });
        const copied = vault._gated.get(gatedKeyId({
            walletId: 'fresh', chainId: CHAIN, gateTicker: 'GATED', keyHash: HASH,
        }));
        expect(copied.keyHex).toBe(KEY);
        expect(copied.source).toBe('recovered');
        expect(vault._gated.get(keyRow('legacy').id)).toBeTruthy();
    });

    it('never overwrites an existing target row and scopes by chain', async () => {
        const existingTarget = keyRow('fresh');
        const otherChain = keyRow('legacy', 'GATED', 'ef'.repeat(32), 'litecoin-regtest');
        const vault = makeVault({ gatedKeyRows: [keyRow('legacy'), existingTarget, otherChain] });
        const res = await copyGatedKeysToWallet({
            vault, fromWalletId: 'legacy', toWalletId: 'fresh', chainId: CHAIN,
        });
        expect(res).toEqual({ copied: 0, skipped: 1 });
        expect(vault._gated.get(existingTarget.id)).toBe(existingTarget);
    });

    it('same-wallet copy is a no-op', async () => {
        const vault = makeVault({ gatedKeyRows: [keyRow('w1')] });
        expect(await copyGatedKeysToWallet({ vault, fromWalletId: 'w1', toWalletId: 'w1' }))
            .toEqual({ copied: 0, skipped: 0 });
    });
});

describe('sweepPreview', () => {
    function makeSdk(overrides = {}) {
        return {
            getBalances: vi.fn(async () => ({ data: [
                { tick: 'PEPE', amount: '100', decimals: 0 },
                { tick: 'ZERO', amount: '0', decimals: 0 },
            ] })),
            getTokens: vi.fn(async () => ({ data: [{ tick: 'OWNED', supply: '10' }] })),
            getOrders: vi.fn(async () => ({ data: [
                { action_index: 1, source: ADDR, status: 'open', give_tick: 'PEPE', give_amount: '5', give_ownership: 0 },
                { action_index: 2, source: ADDR, status: 'cancelled', give_tick: 'PEPE', give_amount: '5', give_ownership: 0 },
                { action_index: 3, source: 'someone-else', status: 'open', give_tick: 'PEPE', give_amount: '5', give_ownership: 0 },
            ] })),
            getSwaps: vi.fn(async () => ({ data: [
                { action_index: 4, source: ADDR, status: 'open', give_tick: 'OWNED', give_amount: '2', give_ownership: 1 },
            ] })),
            getDispensers: vi.fn(async () => ({ data: [
                { action_index: 5, source: ADDR, current_status: 'open', tick: 'PEPE', give_remaining: '40', give_ownership: 0 },
                { action_index: 6, source: ADDR, current_status: 'closed', tick: 'PEPE', give_remaining: '0', give_ownership: 0 },
            ] })),
            getFiles: vi.fn(async (tick) => (tick === 'GATEDTICK' ? { data: [
                { gate_ticker: 'GATEDTICK', key_hash: 'aa'.repeat(32), action_index: '900001' },
            ] } : { data: [] })),
            ...overrides,
        };
    }
    const registryFor = (sdk) => ({ get: () => sdk });

    it('aggregates per category, filters closed/foreign/zero rows', async () => {
        const sdk = makeSdk();
        const p = await sweepPreview({ sdkRegistry: registryFor(sdk), chainId: CHAIN, address: ADDR });
        expect(p.balances.rows).toEqual([{ tick: 'PEPE', quantity: '100', divisibility: 0 }]);
        expect(p.ownerships.rows).toEqual([{ tick: 'OWNED' }]);
        expect(p.orders.rows.map((r) => r.actionIndex)).toEqual(['1']);
        expect(p.orders.rows[0].giveAmount).toBe('5');
        expect(p.swaps.rows).toEqual([{ actionIndex: '4', giveTick: 'OWNED', giveAmount: '2', giveOwnership: true }]);
        expect(p.dispensers.rows).toEqual([{ actionIndex: '5', tick: 'PEPE', escrowRemaining: '40', giveOwnership: false }]);
        expect(sdk.getDispensers).toHaveBeenCalledWith(ADDR, 'source');
        expect(p.gatedTicks.rows).toEqual([]);
    });

    it('detects gated ticks across balances and ownerships', async () => {
        const sdk = makeSdk({
            getBalances: vi.fn(async () => ({ data: [{ tick: 'GATEDTICK', amount: '3', decimals: 0 }] })),
        });
        const p = await sweepPreview({ sdkRegistry: registryFor(sdk), chainId: CHAIN, address: ADDR });
        expect(p.gatedTicks.rows).toEqual(['GATEDTICK']);
        expect(p.gatedTicks.partial).toBe(false);
    });

    it('degrades one category without failing the others', async () => {
        const sdk = makeSdk({
            getOrders: vi.fn(async () => { throw new Error('orders endpoint down'); }),
        });
        const p = await sweepPreview({ sdkRegistry: registryFor(sdk), chainId: CHAIN, address: ADDR });
        expect(p.orders.error).toMatch(/orders endpoint down/);
        expect(p.orders.rows).toEqual([]);
        expect(p.balances.rows).toHaveLength(1);
        expect(p.dispensers.rows).toHaveLength(1);
    });

    it('treats an unknown status as open (over-state, never hide)', async () => {
        const sdk = makeSdk({
            getOrders: vi.fn(async () => ({ data: [
                { action_index: 9, source: ADDR, give_tick: 'PEPE', give_amount: '1', give_ownership: 0 },
            ] })),
        });
        const p = await sweepPreview({ sdkRegistry: registryFor(sdk), chainId: CHAIN, address: ADDR });
        expect(p.orders.rows.map((r) => r.actionIndex)).toEqual(['9']);
    });
});
