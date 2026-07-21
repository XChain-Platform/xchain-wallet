// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// composeActionForConfirm ( §5.3): the HOST half of the single-encode
// pipeline. Wraps composeForConfirm and runs the tamper check host-side
// (decomposePsbt + decodeActionFromPsbt live here), returning a serializable,
// already-verified ComposedAction. A tamper throws.

import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

// Harness: an SDK with encoder/actions (for compose) plus wallet.decomposePsbt
// and decoder.decodeActionFromPsbt (for the tamper check). `outputs` and
// `decoded` control what the tamper check sees.
function makeHarness({ outputs, decoded } = {}) {
    const sdk = {
        encoder: { createTx: vi.fn(async () => ({ psbt: 'PSBTHEX', encoding: 'OP_RETURN' })) },
        actions: { createAction: vi.fn(() => ({ actionString: 'SEND|0|JDOG|1|addr', action: 'SEND', version: 0 })) },
        wallet: {
            decomposePsbt: vi.fn(() => ({
                outputs: outputs || [
                    { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 }, // OP_RETURN carrier
                    { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 100 },        // change to own
                ],
            })),
        },
        decoder: {
            decodeActionFromPsbt: vi.fn(() => decoded || { ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
        },
    };
    const sdkRegistry = { get: () => sdk };
    const chainRegistry = { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'XXXX' }) };
    const vault = { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } };
    return { sdk, sdkRegistry, chainRegistry, vault };
}

const ARGS = (h) => ({
    vault: h.vault, chainRegistry: h.chainRegistry, sdkRegistry: h.sdkRegistry,
    chainId: 'btc',
    actionData: { action: 'SEND', params: { TICK: 'JDOG', AMOUNT: '1', DESTINATION: 'addr' } },
    encoderOpts: { pubkey: 'pub' },
    source: 'chg',
    ownAddresses: ['chg'],
});

describe('composeActionForConfirm', () => {

    it('returns a serializable, tamper-verified ComposedAction on a clean build', async () => {
        const h = makeHarness();
        const composed = await composeActionForConfirm(ARGS(h));
        expect(composed.tamperVerified).toBe(true);
        expect(composed.psbt).toBe('PSBTHEX');
        expect(composed.actionString).toBe('SEND|0|JDOG|1|addr');
        // No encoderOpts leaks over the wire (dropped from the envelope).
        expect(composed.encoderOpts).toBeUndefined();
        expect(h.sdk.wallet.decomposePsbt).toHaveBeenCalled();
        expect(h.sdk.decoder.decodeActionFromPsbt).toHaveBeenCalled();
    });

    it('throws a tamper error when the PSBT carries an output the user did not approve', async () => {
        const h = makeHarness({
            outputs: [
                { address: null, scriptPubKeyHex: '6a20deadbeef', scriptType: 'unknown', value: 0 },
                { address: 'ATTACKER', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 999 },
            ],
        });
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(TamperDetectedError);
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(/did not approve/);
    });

    it('throws a tamper error when the encoded action bytes do not match', async () => {
        const h = makeHarness({ decoded: { ok: true, actionString: 'SEND|0|JDOG|1|ATTACKER' } });
        await expect(composeActionForConfirm(ARGS(h))).rejects.toThrow(/does not match/);
    });

    it('treats the source address as own even when ownAddresses omits it', async () => {
        const h = makeHarness();
        const composed = await composeActionForConfirm({ ...ARGS(h), ownAddresses: [] });
        // change to 'chg' (the source) must still pass as own-change.
        expect(composed.tamperVerified).toBe(true);
    });

    it('requires a pubkey in encoderOpts', async () => {
        const h = makeHarness();
        await expect(composeActionForConfirm({ ...ARGS(h), encoderOpts: {} }))
            .rejects.toThrow(/pubkey is required/);
    });
});
