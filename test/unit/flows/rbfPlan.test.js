// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { planRbfReplacement, RbfPlanError } from '../../../packages/core/src/flows/rbfPlan.js';

const SOURCE = 'bcrt1qwallet';
const DESTINATION = 'bcrt1qrecipient';
const INPUT = '11'.repeat(32);

const transaction = ({
    outputs = [
        { address: null, scriptType: 'unknown', scriptPubKeyHex: '6a0100', value: 0 },
        { address: DESTINATION, scriptType: 'p2wpkh', value: 7000 },
        { address: SOURCE, scriptType: 'p2wpkh', value: 2000 },
    ],
    sequence = 0xfffffffd,
} = {}) => ({
    inputs: [{
        prevTxHash: INPUT,
        prevTxIndex: 2,
        sequence,
        value: 10000,
        scriptPubKeyHex: `0014${'22'.repeat(20)}`,
    }],
    outputs,
});

describe('planRbfReplacement', () => {
    it('pins every input and preserves recipient outputs while spending change on the bump', () => {
        const plan = planRbfReplacement({
            strategy: 'speedup', conflict: transaction(), sourceAddress: SOURCE,
        });

        expect(plan.encoderOpts).toMatchObject({
            fee: 2000,
            rbf: true,
            options: { exactInputs: true },
            utxos: [{ txid: INPUT, vout: 2, value: 10000, confirmations: 0 }],
            customOutputs: [{ address: DESTINATION, value: 7000 }],
        });
        expect(plan.originalFeeSats).toBe('1000');
        expect(plan.feeIncreaseSats).toBe('1000');
    });

    it('cancels to one self-controlled output and no original recipient', () => {
        const plan = planRbfReplacement({
            strategy: 'cancel', conflict: transaction(), sourceAddress: SOURCE,
        });

        expect(plan.encoderOpts.customOutputs).toEqual([{ address: SOURCE, value: 8000 }]);
        expect(plan.encoderOpts.change).toBe(SOURCE);
    });

    it('funds the bump from a rotated wallet change output', () => {
        const rotated = 'bcrt1qrotatedchange';
        const plan = planRbfReplacement({
            strategy: 'speedup',
            conflict: transaction({ outputs: [
                { address: DESTINATION, scriptType: 'p2wpkh', value: 7000 },
                { address: rotated, scriptType: 'p2wpkh', value: 2000 },
            ] }),
            sourceAddress: SOURCE,
            ownAddresses: [SOURCE, rotated],
        });

        expect(plan.encoderOpts.change).toBe(rotated);
        expect(plan.encoderOpts.customOutputs).toEqual([{ address: DESTINATION, value: 7000 }]);
    });

    it('restores the original outputs while replacing the cancel', () => {
        const cancel = transaction({ outputs: [{ address: SOURCE, value: 8500 }] });
        const plan = planRbfReplacement({
            strategy: 'restore', conflict: cancel, template: transaction(), sourceAddress: SOURCE,
        });

        expect(plan.originalFeeSats).toBe('1500');
        expect(plan.encoderOpts.customOutputs).toEqual([{ address: DESTINATION, value: 7000 }]);
        expect(plan.replacementFeeSats).toBe('2500');
    });

    it('uses an explicit fee rate only when it raises the absolute fee', () => {
        expect(planRbfReplacement({
            strategy: 'speedup',
            conflict: transaction(),
            sourceAddress: SOURCE,
            feeRate: '10',
            transactionBytes: 250,
        }).replacementFeeSats).toBe('2500');

        expect(() => planRbfReplacement({
            strategy: 'speedup',
            conflict: transaction(),
            sourceAddress: SOURCE,
            feeRate: '1',
            transactionBytes: 250,
        })).toThrow(/does not increase/);
    });

    it('refuses a non-RBF conflict and a restore with different inputs', () => {
        expect(() => planRbfReplacement({
            strategy: 'speedup', conflict: transaction({ sequence: 0xffffffff }), sourceAddress: SOURCE,
        })).toThrow(RbfPlanError);

        const other = transaction();
        other.inputs[0].prevTxHash = '33'.repeat(32);
        expect(() => planRbfReplacement({
            strategy: 'restore', conflict: transaction(), template: other, sourceAddress: SOURCE,
        })).toThrow(/does not spend the cancel inputs/);
    });

    it('refuses to burn a recipient when no wallet change output can fund the bump', () => {
        expect(() => planRbfReplacement({
            strategy: 'speedup',
            conflict: transaction({ outputs: [{ address: DESTINATION, value: 9000 }] }),
            sourceAddress: SOURCE,
        })).toThrow(/no wallet change output/);
    });
});
