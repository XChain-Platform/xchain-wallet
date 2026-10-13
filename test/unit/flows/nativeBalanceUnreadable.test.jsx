// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Issue #74. The explorer answers `/address/<addr>` with HTTP 200,
// `tracker_available: false` and null amounts when its UTXO tracker is not
// answering. The wallet read that body as a zero coin balance: Home showed
// "No coins yet" for a funded address, and the Confirm preview projected the
// coin from zero (`DOGE 0 -> -0.029`). A body that says "I can't tell" must be
// marked unavailable exactly like a read that threw, and the preview must not
// invent a zero to subtract the fee from.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
    addressBalances,
    walletBalances,
    NATIVE_BALANCE_UNREADABLE_REASON,
    _resetBatchSupportMemo,
} from '../../../packages/core/src/flows/balances.js';
import { balancesFromSdk } from '../../../packages/core/src/decoder/balanceAdapter.js';
import { simulateAction } from '../../../packages/core/src/decoder/txSimulator.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { BalanceChanges } from '../../../packages/core/src/shared/components/BalanceChanges.jsx';
import { ActionIntentSummary } from '../../../packages/core/src/shared/components/ActionIntentSummary.jsx';

const CHAIN_ID = 'dogecoin-testnet';
const DESCRIPTORS = [{ id: CHAIN_ID, coin: 'dogecoin', networkKind: 'testnet' }];
const flowRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};
const ADDRESS = 'ndNNBSVgGUvHfh6k3xYmZVstV7nLRacsnH';

// The body the explorer served in the report, trimmed to the fields the
// wallet reads.
const TRACKER_DOWN = {
    address: ADDRESS,
    balances: { confirmed: null, pending: null, received: null },
    tracker_available: false,
    type: null,
    utxos: { confirmed: null, pending: null },
};
const TRACKER_UP_EMPTY = {
    address: ADDRESS,
    balances: { confirmed: '0', pending: '0', received: '0' },
    tracker_available: true,
};
const TOKENS = { total: 1, data: [{ tick: 'XCHAIN', amount: '5', decimals: 0 }] };

function perAddressSdk(addressBody) {
    return {
        getAddress: vi.fn(async () => addressBody),
        getBalances: vi.fn(async () => TOKENS),
    };
}

function memCollection(initial = []) {
    const m = new Map(initial.map((r) => [r.id, JSON.parse(JSON.stringify(r))]));
    return {
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        delete: async (id) => { m.delete(id); },
        findBy: async (field, value) => Array.from(m.values())
            .filter((r) => r[field] === value)
            .map((r) => JSON.parse(JSON.stringify(r))),
    };
}

function makeVault() {
    return {
        wallets: memCollection([{ id: 'w1', schemaVersion: 1, name: 'W', importedKeys: [] }]),
        accounts: memCollection([{ id: 'acct-1', walletId: 'w1', index: 0, name: 'Main' }]),
        addresses: memCollection([{
            id: 'addr-0', accountId: 'acct-1', chain: 'dogecoin', network: 'testnet',
            source: 'hd', addressType: 'p2pkh', derivationPath: "m/0'/0/0",
            label: 'Address 0', address: ADDRESS,
        }]),
    };
}

const readOne = (sdk) => addressBalances({
    sdkRegistry: { get: () => sdk }, chainRegistry: flowRegistry, chainId: CHAIN_ID, address: ADDRESS,
});

const readWallet = (sdk) => walletBalances({
    vault: makeVault(), walletId: 'w1', chainRegistry: flowRegistry, sdkRegistry: { get: () => sdk },
});

beforeEach(() => { _resetBatchSupportMemo(); });
afterEach(() => cleanup());

describe('issue #74: an /address/ answer without a coin balance is unavailable, not zero', () => {
    it('marks the native half unavailable when the tracker is not answering', async () => {
        const shape = await readOne(perAddressSdk(TRACKER_DOWN));
        expect(shape.native).toBeNull();
        expect(shape.unavailable).toEqual(['native']);
        expect(shape.unavailableReason).toBe(NATIVE_BALANCE_UNREADABLE_REASON);
        // The token half that did load is untouched.
        expect(shape.tokens.map((t) => t.tick)).toEqual(['XCHAIN']);
    });

    it('marks it unavailable when confirmed is null even without the flag', async () => {
        const shape = await readOne(perAddressSdk({ balances: { confirmed: null } }));
        expect(shape.native).toBeNull();
        expect(shape.unavailable).toEqual(['native']);
    });

    it('still reads a real zero balance as zero', async () => {
        const shape = await readOne(perAddressSdk(TRACKER_UP_EMPTY));
        expect(shape.native).toMatchObject({ tick: 'DOGE', quantity: '0' });
        expect(shape.unavailable).toBeUndefined();
    });

    it('marks it the same way on the batch route as on the per-address route', async () => {
        const viaPerAddress = await readWallet(perAddressSdk(TRACKER_DOWN));
        _resetBatchSupportMemo();
        const batch = perAddressSdk(TRACKER_DOWN);
        batch.getBalancesBatch = vi.fn(async (addresses) => Object.fromEntries(addresses.map((a) => [
            a, { balances: TOKENS, address: TRACKER_DOWN, error: null },
        ])));
        const viaBatch = await readWallet(batch);
        expect(batch.getBalancesBatch).toHaveBeenCalledTimes(1);
        expect(viaBatch).toEqual(viaPerAddress);
        expect(viaBatch[CHAIN_ID][0].balances.unavailable).toEqual(['native']);
    });
});

describe('issue #74: the Confirm preview does not project the coin from zero', () => {
    const chainRegistry = defaultRegistry();
    const unreadable = { native: null, tokens: [], unavailable: ['native'], unavailableReason: 'x' };

    function preview(params, extra = {}) {
        return simulateAction({
            action: 'SEND',
            params,
            balances: balancesFromSdk(unreadable),
            feeEstimate: '0.029',
            chainId: CHAIN_ID,
            chainRegistry,
            ...extra,
        });
    }

    it('balancesFromSdk emits a tick-less unknown coin marker that no tick lookup matches', () => {
        const rows = balancesFromSdk(unreadable);
        expect(rows).toEqual([{ tick: '', amount: '', isCoin: true, unknown: true }]);
        expect(rows.find((r) => String(r.tick).toUpperCase() === 'DOGE')).toBeUndefined();
    });

    it('a coin send shows the balance as unknown instead of 0 -> negative', () => {
        const r = preview({ TICK: 'DOGE', AMOUNT: '1', DESTINATION: 'nX' });
        const coin = r.deltas.find((d) => d.isCoin && !d.isFee);
        expect(coin).toMatchObject({ tick: 'DOGE', before: '', after: '', beforeUnknown: true });
        for (const d of r.deltas) {
            expect(d.before).not.toBe('0');
            expect(String(d.after)).not.toMatch(/^-/);
        }
        // The fee is still known and still stated.
        expect(r.deltas.find((d) => d.isFee).feeAmount).toBe('0.029');
        expect(r.notes.join(' ')).toMatch(/DOGE balance could not be read/);
    });

    it('a token send adds one unknown balance row beside the fee', () => {
        const r = preview({ TICK: 'XCHAIN', AMOUNT: '1', DESTINATION: 'nX' });
        const fee = r.deltas.find((d) => d.isFee);
        expect(fee).toMatchObject({ before: '', after: '', feeAmount: '0.029' });
        const coinRows = r.deltas.filter((d) => d.isCoin && !d.isFee);
        expect(coinRows).toHaveLength(1);
        expect(coinRows[0].beforeUnknown).toBe(true);
    });

    it('leaves a readable balance exactly as before', () => {
        const r = simulateAction({
            action: 'SEND',
            params: { TICK: 'DOGE', AMOUNT: '1', DESTINATION: 'nX' },
            balances: balancesFromSdk({
                native: { tick: 'DOGE', quantity: '41383000000', divisibility: 8 }, tokens: [],
            }),
            feeEstimate: '0.029',
            chainId: CHAIN_ID,
            chainRegistry,
        });
        const coin = r.deltas.find((d) => d.isCoin && !d.isFee);
        expect(coin.before).toBe('413.83');
        expect(coin.after).toBe('412.801');
        expect(coin.beforeUnknown).toBeUndefined();
    });

    it('both review surfaces say the balance is unknown and print no negative balance', () => {
        const r = preview({ TICK: 'DOGE', AMOUNT: '1', DESTINATION: 'nX' });
        const a = render(<BalanceChanges result={r} />);
        expect(a.container.querySelector('[data-before-unknown="true"]').textContent)
            .toContain('Balance unknown');
        expect(a.container.textContent).not.toMatch(/→\s*[-−]|undefined/);
        cleanup();
        const b = render(<ActionIntentSummary decoded={{ summary: 'Send 1 DOGE', details: [], warnings: [] }} simulation={r} />);
        expect(b.container.querySelector('[data-before-unknown="true"]').textContent)
            .toContain('balance unknown');
        expect(b.container.textContent).not.toMatch(/0 → -|undefined/);
    });
});
