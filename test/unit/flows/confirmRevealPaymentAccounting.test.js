// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the confirm screen calls the exact network fee, on the chunk lane.
//
// A chunk-lane action is two transactions, and the reveal's miner fee is
// pre-funded by the commit's carrier outputs - so the fee is knowable, and it is
// carrier value MINUS whatever the reveal re-emits as real outputs. The submit
// path emits the whole deferred set there (protocol fee, oracle usage fee, ADS
// donation, native payment), while this number subtracted the protocol fee
// alone, so every other reveal payment was presented to the user as miner fee.

import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';

const ACTION = 'SEND|1|^1|7|alice|3|bob|1|carol';
const ORACLE = { address: 'oracleFeeAddr', value: 5000 };
const DONATION = { address: 'donationAddr', value: 1000 };

function makeHarness() {
    const sdk = {
        encoder: {
            createTx: vi.fn(async () => ({
                psbt: 'PSBTHEX', encoding: 'P2SH', carrierScripts: ['aa11'],
            })),
        },
        actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'SEND', version: 1 })) },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                inputs: [{ value: 10000 }],
                outputs: [
                    // One P2SH data carrier, funding the reveal, and change home.
                    { address: null, scriptPubKeyHex: `a914${'11'.repeat(20)}87`, scriptType: 'p2sh', value: 8000 },
                    { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 1000 },
                ],
            })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: ACTION })),
            describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
            verifyCarrierScripts: vi.fn(() => ({ ok: true, reason: null, checked: 1 })),
        },
        config: { network: 'regtest' },
    };
    return {
        sdk,
        args: {
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'XXXX' }) },
            sdkRegistry: { get: () => sdk },
            chainId: 'btc',
            actionData: { action: 'SEND', params: { legs: [] } },
            // Two outputs the commit reserves value for and does not emit; the
            // chunk lane defers all of customOutputs to the reveal.
            encoderOpts: { pubkey: 'pub', customOutputs: [ORACLE, DONATION] },
            source: 'chg',
            ownAddresses: ['chg'],
        },
    };
}

describe('reveal payments are not counted as miner fee', () => {

    it('subtracts the WHOLE deferred set from the carrier value', async () => {
        const composed = await composeActionForConfirm(makeHarness().args);
        // The commit's own fee is 10000 in - 9000 out = 1000. The 8000-sat
        // carrier funds a reveal that pays out 6000, so 2000 of it is miner fee.
        // Subtracting the protocol fee alone (0 here) reported all 8000, and the
        // user was shown 9000 for a transaction that pays 3000.
        expect(composed.deferredOutputs).toEqual([ORACLE, DONATION]);
        expect(composed.networkFeeSats).toBe(3000);
    });

    it('still counts the protocol fee when it is the only deferred output', async () => {
        const h = makeHarness();
        h.args.encoderOpts = { pubkey: 'pub', customOutputs: [{ address: 'feeDest', value: 6000 }] };
        const composed = await composeActionForConfirm(h.args);
        expect(composed.networkFeeSats).toBe(3000);
    });

    it('leaves the single-transaction lanes exactly where they were', async () => {
        // No carriers: the commit's own fee IS the whole fee, and nothing about
        // the deferred set can move it.
        const h = makeHarness();
        h.sdk.encoder.createTx = vi.fn(async () => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' }));
        h.sdk.wallet.decomposePsbt = vi.fn(() => ({
            inputs: [{ value: 10000 }],
            outputs: [
                { address: 'oracleFeeAddr', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 5000 },
                { address: 'donationAddr', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 1000 },
                { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 3000 },
            ],
        }));
        const composed = await composeActionForConfirm(h.args);
        expect(composed.deferredOutputs).toEqual([]);
        expect(composed.networkFeeSats).toBe(1000);
    });
});
