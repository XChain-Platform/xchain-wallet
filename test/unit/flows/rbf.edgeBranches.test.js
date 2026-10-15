// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    planRbfReplacement,
    RbfPlanError,
} from '../../../packages/core/src/flows/rbfPlan.js';
import {
    isEntryReplaceable,
    replaceFromHistoryEntry,
    RbfInvalidEntryError,
    RbfNotSupportedError,
    sendRbfRequest,
} from '../../../packages/core/src/flows/rbfReplace.js';

const SOURCE = 'bcrt1qsource';
const DESTINATION = 'bcrt1qdestination';
const HASH = '11'.repeat(32);

function transaction() {
    return {
        inputs: [{
            prevTxHash: HASH,
            prevTxIndex: 0,
            sequence: 0xfffffffd,
            value: 10_000,
            scriptPubKeyHex: `0014${'22'.repeat(20)}`,
        }],
        outputs: [
            { address: DESTINATION, value: 7_000 },
            { address: SOURCE, value: 2_000 },
        ],
    };
}

function plan(overrides = {}) {
    return planRbfReplacement({
        strategy: 'speedup', conflict: transaction(), sourceAddress: SOURCE, ...overrides,
    });
}

describe('RBF plan validation edges', () => {
    it.each([
        [{ strategy: 'other' }, /unknown strategy/],
        [{ sourceAddress: '' }, /sourceAddress is required/],
        [{ conflict: null }, /conflict.inputs must be a non-empty array/],
        [{ conflict: { inputs: [{}], outputs: [] } }, /conflict.outputs must be a non-empty array/],
    ])('rejects an invalid top-level shape %#', (overrides, message) => {
        expect(() => plan(overrides)).toThrow(message);
    });

    it.each([
        ['txid', (tx) => { tx.inputs[0].prevTxHash = 'xyz'; }, /invalid txid/],
        ['vout', (tx) => { tx.inputs[0].prevTxIndex = 0x1_0000_0000; }, /invalid vout/],
        ['script', (tx) => { tx.inputs[0].scriptPubKeyHex = '0'; }, /no usable scriptPubKey/],
        ['input value', (tx) => { tx.inputs[0].value = 1.5; }, /exact non-negative/],
        ['output value', (tx) => { tx.outputs[0].value = -1; }, /exact non-negative/],
    ])('rejects an invalid %s', (_name, mutate, message) => {
        const conflict = transaction();
        mutate(conflict);
        expect(() => plan({ conflict })).toThrow(message);
    });

    it('rejects a transaction with no positive original fee', () => {
        const conflict = transaction();
        conflict.outputs = [{ address: SOURCE, value: 10_000 }];
        expect(() => plan({ conflict })).toThrow(/no readable positive fee/);
    });

    it('rejects a default bump that would consume every input', () => {
        const conflict = transaction();
        conflict.outputs = [{ address: SOURCE, value: 1_000 }];
        expect(() => plan({ conflict })).toThrow(/replacement fee consumes every input/);
    });

    it('raises the effective rate by at least the incremental relay minimum', () => {
        const transactionBytes = 250;
        const originalRate = 1_000 / transactionBytes;
        const result = plan({ feeRate: '4.5', transactionBytes });
        const replacementRate = Number(result.replacementFeeSats) / transactionBytes;

        expect(replacementRate).toBeGreaterThanOrEqual(originalRate + 1);
        expect(result.encoderOpts.customOutputs).toEqual([{ address: DESTINATION, value: 7_000 }]);
    });

    it.each([
        [{ feeRate: 0, transactionBytes: 100 }, /positive satoshi-per-vbyte/],
        [{ feeRate: 20 }, /transactionBytes is required/],
        [{ feeRate: Number.MAX_VALUE, transactionBytes: 100 }, /inexact satoshi amount/],
    ])('rejects an unusable explicit fee %#', (overrides, message) => {
        expect(() => plan(overrides)).toThrow(message);
    });

    it('refuses a non-addressed non-data output it cannot reproduce', () => {
        const conflict = transaction();
        conflict.outputs = [
            { address: null, value: 1, scriptType: 'p2pkh', scriptPubKeyHex: '76' },
            { address: SOURCE, value: 8_000 },
        ];
        expect(() => plan({ conflict })).toThrow(/output 0 cannot be reproduced safely/);
    });

    it('refuses a bump larger than the wallet change output', () => {
        const conflict = transaction();
        conflict.outputs = [
            { address: DESTINATION, value: 9_000 },
            { address: SOURCE, value: 500 },
        ];
        expect(() => plan({ conflict })).toThrow(/change output cannot cover/);
    });

    it('serializes exact satoshi amounts above the safe integer boundary as strings', () => {
        const input = BigInt(Number.MAX_SAFE_INTEGER) + 10_000n;
        const conflict = transaction();
        conflict.inputs[0].value = input.toString();
        conflict.outputs = [
            { address: DESTINATION, value: (input - 2_000n).toString() },
            { address: SOURCE, value: 1_000 },
        ];

        const result = plan({ conflict, ownAddresses: null });

        expect(result.encoderOpts.utxos[0].value).toBe(input.toString());
        expect(result.encoderOpts.customOutputs[0].value).toBe((input - 2_000n).toString());
    });
});

const descriptor = { displayName: 'Bitcoin', feeStrategy: { rbfSupported: true } };
const entry = (overrides = {}) => ({
    txHash: HASH,
    chainId: 'bitcoin-regtest',
    blockIndex: 0,
    action: 'SEND',
    pending: { rbf: true },
    ...overrides,
});

describe('RBF history eligibility guards', () => {
    it.each([
        [null, {}, /entry/i],
        [entry({ txHash: '' }), { descriptor }, /hash/i],
        [entry({ blockIndex: 1 }), { descriptor }, /confirmed/i],
        [entry({ pending: { rbf: true, chainConfirmed: true } }), { descriptor }, /confirmed/i],
        [entry({ action: 'SWEEP' }), { descriptor }, /SWEEP/],
        [entry({ action: 'MINT' }), { descriptor }, /MINT/],
        [entry(), { descriptor: null }, /isn't supported/i],
        [entry({ pending: {} }), { descriptor }, /did not allow/i],
        [entry({ pending: { rbf: true, failed: true } }), { descriptor }, /did not allow/i],
        [entry({ pending: { rbf: true, replaced: true } }), { descriptor }, /did not allow/i],
    ])('refuses an ineligible entry %#', (candidate, options, reason) => {
        const result = isEntryReplaceable(candidate, options);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(reason);
    });

    it('accepts a legacy top-level RBF flag when the pending record has none', () => {
        expect(isEntryReplaceable(entry({ pending: {}, rbf: true }), { descriptor })).toEqual({ ok: true });
    });
});

describe('RBF request guard and cleanup branches', () => {
    const request = {
        chainId: 'bitcoin-regtest', originalTxHash: HASH, strategy: 'speedup',
    };

    it('reports a missing replacement capability before request validation', async () => {
        await expect(sendRbfRequest({ messaging: {}, request: null }))
            .rejects.toBeInstanceOf(RbfNotSupportedError);
    });

    it.each([
        [null, /request is required/],
        [{ ...request, chainId: '' }, /chainId is required/],
        [{ ...request, originalTxHash: '' }, /originalTxHash is required/],
    ])('rejects an invalid request %#', async (candidate, message) => {
        const replaceTx = vi.fn();
        await expect(sendRbfRequest({ messaging: { replaceTx }, request: candidate }))
            .rejects.toThrow(message);
        expect(replaceTx).not.toHaveBeenCalled();
    });

    it('forwards previews directly without claiming a broadcast lane', async () => {
        const replaceTx = vi.fn(async () => ({ preview: true }));
        const messaging = { replaceTx };

        await expect(Promise.all([
            sendRbfRequest({ messaging, request: { ...request, preview: true } }),
            sendRbfRequest({ messaging, request: { ...request, preview: true, strategy: 'cancel' } }),
        ])).resolves.toEqual([{ preview: true }, { preview: true }]);
        expect(replaceTx).toHaveBeenCalledTimes(2);
    });

    it('releases a rejected lane so the same request can be retried', async () => {
        const replaceTx = vi.fn()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ replacementTxHash: '22'.repeat(32) });
        const messaging = { replaceTx };

        await expect(sendRbfRequest({ messaging, request })).rejects.toThrow('temporary failure');
        await expect(sendRbfRequest({ messaging, request })).resolves.toMatchObject({
            replacementTxHash: '22'.repeat(32),
        });
        expect(replaceTx).toHaveBeenCalledTimes(2);
    });

    it('checks host capability before rejecting an invalid history entry', async () => {
        await expect(replaceFromHistoryEntry({ messaging: {}, entry: null, strategy: 'speedup' }))
            .rejects.toBeInstanceOf(RbfNotSupportedError);
    });

    it('rejects an ineligible history entry before calling the host', async () => {
        const replaceTx = vi.fn();
        await expect(replaceFromHistoryEntry({
            messaging: { replaceTx }, entry: entry({ blockIndex: 2 }), strategy: 'speedup', descriptor,
        })).rejects.toBeInstanceOf(RbfInvalidEntryError);
        expect(replaceTx).not.toHaveBeenCalled();
    });
});
