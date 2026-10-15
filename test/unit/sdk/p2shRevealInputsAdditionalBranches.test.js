// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    assertRevealSpendsCommitLegs,
    RevealInputsRefusedError,
    revealInputsRefusal,
} from '../../../packages/core/src/sdk/p2shRevealInputs.js';

const TXID = 'ab'.repeat(32);
const VALID_INPUT = {
    prevTxHash: TXID.toUpperCase(),
    prevTxIndex: 0,
    scriptType: 'p2sh',
    redeemScriptHex: '51',
};
const OUTPUTS = [{ scriptType: 'p2sh' }];

const refusal = (revealInputs, phase1Outputs = OUTPUTS) => revealInputsRefusal({
    revealInputs,
    phase1Outputs,
    phase1Txid: TXID,
    encoding: 'P2SH',
});

describe('reveal input defensive branches', () => {
    it('refuses a duplicate commit outpoint', () => {
        expect(refusal([VALID_INPUT, { ...VALID_INPUT }])).toEqual({
            reason: 'names no single commit output',
            inputIndex: 1,
        });
    });

    it('refuses a non-integer output index', () => {
        expect(refusal([{ ...VALID_INPUT, prevTxIndex: 0.5 }])).toEqual({
            reason: 'names no single commit output',
            inputIndex: 0,
        });
    });

    it('refuses null input entries and unreadable commit outputs', () => {
        expect(refusal([null])).toEqual({
            reason: 'spends coin from outside the commit',
            inputIndex: 0,
        });
        expect(refusal([VALID_INPUT], null)).toEqual({
            reason: 'spends a commit output that is not a data leg',
            inputIndex: 0,
        });
    });

    it('turns a decomposition failure into a phase-two refusal', () => {
        const run = () => assertRevealSpendsCommitLegs({
            decomposePsbt: () => { throw new Error('unreadable PSBT'); },
            revealPsbtHex: '00',
            phase1Outputs: OUTPUTS,
            phase1Txid: TXID,
            phase1TxHex: 'deadbeef',
            chainId: 'bitcoin-regtest',
            encoding: 'P2SH',
        });

        expect(run).toThrow(RevealInputsRefusedError);
        try {
            run();
        } catch (error) {
            expect(error).toMatchObject({
                reason: 'could not be read as a set of inputs',
                inputIndex: null,
                phase: 'phase2',
                phase1Txid: TXID,
                phase1TxHex: 'deadbeef',
                chainId: 'bitcoin-regtest',
                encoding: 'P2SH',
            });
            expect(error.message).toContain('it could not be read as a set of inputs');
        }
    });
});
