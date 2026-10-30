// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The encoder reserves a build's inputs for five minutes. A compose that the
// wallet itself refuses after the build (tamper check, compression report that
// does not match) never reaches a confirm surface, so nothing else hands the
// reservation back, and the next compose on an address with one coin fails
// "all candidate inputs are reserved". Refusing must release.

import { describe, expect, it, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';

const ACTION = 'SEND|0|JDOG|1|addr';

function harness({ carried = ACTION, compression } = {}) {
    const releaseInputs = vi.fn(async () => ({ found: true }));
    const sdk = {
        encoder: {
            createTx: vi.fn(async () => ({
                psbt: 'PSBTHEX',
                encoding: 'OP_RETURN',
                reservation: { id: 'input-1' },
                ...(compression ? { compression } : {}),
            })),
            releaseInputs,
        },
        actions: { createAction: () => ({ actionString: ACTION, action: 'SEND', version: 0 }) },
        wallet: { decomposePsbt: () => ({ outputs: [{ address: 'source', value: 100 }] }) },
        decoder: {
            decodeActionStringFromPsbt: () => ({ ok: true, actionString: carried }),
            parse: () => ({ ok: false }),
        },
    };
    return {
        releaseInputs,
        args: {
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest' }) },
            chainId: 'btc',
            actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
            encoderOpts: { pubkey: 'pub' },
            source: 'source',
        },
    };
}

describe('a refused compose gives the encoder its inputs back', () => {
    it('releases the reservation when the built bytes fail the tamper check', async () => {
        const h = harness({ carried: 'SEND|0|JDOG|9|attacker' });
        await expect(composeActionForConfirm(h.args)).rejects.toThrow();
        expect(h.releaseInputs).toHaveBeenCalledWith('input-1');
    });

    it('releases the reservation when the compression report does not match', async () => {
        const h = harness({ compression: { compressed: true, data: 'NOT|THE|ACTION', rawData: 'aa' } });
        await expect(composeActionForConfirm(h.args)).rejects.toThrow(/does not match what you approved/);
        expect(h.releaseInputs).toHaveBeenCalledWith('input-1');
    });

    it('does not release a reservation it never refused', async () => {
        const h = harness();
        const composed = await composeActionForConfirm(h.args);
        expect(composed.psbt).toBe('PSBTHEX');
        expect(h.releaseInputs).not.toHaveBeenCalled();
    });
});
