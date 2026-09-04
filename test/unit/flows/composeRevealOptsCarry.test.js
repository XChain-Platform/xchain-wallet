// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The compose half of the reveal carry: what the phase-1 commit was built with
// has to leave the composer and survive the serializable envelope, or the
// submit path builds the phase-2 reveal from its own opts and sends the surplus
// sweep back to the un-rotated spending address.
//
// composeActionForConfirm drops `encoderOpts` wholesale on the way to the popup
// ("not needed client-side"), which is exactly how the reveal's half of it went
// missing. This pins the slice that must NOT be dropped.

import { describe, it, expect, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';

const ROTATED = 'bcrt1qrotatedinternal';
const SPENDER = 'bcrt1qspender';

function makeHarness({ encoding = 'P2SH' } = {}) {
    const createTx = vi.fn(async () => ({ psbt: 'PSBTHEX', encoding, carrierScripts: ['aa11'] }));
    const sdk = {
        encoder: { createTx },
        actions: {
            createAction: vi.fn(() => ({
                actionString: `DEPLOY|0|${'Q'.repeat(400)}|100000`, action: 'DEPLOY', version: 0,
            })),
        },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                inputs: [{ value: 5000 }],
                // A chunk-lane commit: one P2SH data carrier plus change back
                // to the wallet's own rotated address.
                outputs: [
                    { address: null, scriptPubKeyHex: 'a914', scriptType: 'p2sh', value: 1000 },
                    { address: ROTATED, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 4000 },
                ],
            })),
        },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: 'ignored' })),
            describe: vi.fn(() => ({ summary: 'deploy', details: [], warnings: [] })),
            verifyCarrierScripts: vi.fn(() => ({ ok: true })),
        },
    };
    return {
        createTx,
        args: {
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'LTC', networkKind: 'regtest', adsDonationAddress: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }) },
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainId: 'litecoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '100000' } },
            // What the host route hands it: change already rotated onto a fresh
            // internal address, which is precisely what the reveal never saw.
            encoderOpts: { pubkey: 'pub', change: ROTATED },
            source: SPENDER,
        },
    };
}

describe('composeForConfirm states what the reveal must agree with', () => {

    it('reports the rotated change the commit was actually built with', async () => {
        const h = makeHarness();
        const composed = await composeForConfirm(h.args);
        expect(h.createTx.mock.calls[0][0].change).toBe(ROTATED);
        expect(composed.revealOpts).toEqual({ change: ROTATED, rawData: null });
    });

    it('reports the encoder default when the caller named no change', async () => {
        const h = makeHarness();
        h.args.encoderOpts = { pubkey: 'pub' };
        const composed = await composeForConfirm(h.args);
        expect(composed.revealOpts.change).toBe(SPENDER);
    });

    // Off the chunk lane there is no reveal to agree with.
    it('reports nothing for a single-transaction encoding', async () => {
        const h = makeHarness({ encoding: 'OP_RETURN' });
        const composed = await composeForConfirm(h.args);
        expect(composed.revealOpts).toBe(null);
    });
});

describe('the serializable envelope keeps it', () => {

    it('carries revealOpts to the popup while still dropping encoderOpts', async () => {
        const h = makeHarness();
        const envelope = await composeActionForConfirm({ ...h.args, ownAddresses: [ROTATED, SPENDER] });
        expect(envelope.encoderOpts).toBeUndefined();
        expect(envelope.revealOpts).toEqual({ change: ROTATED, rawData: null });
    });
});
