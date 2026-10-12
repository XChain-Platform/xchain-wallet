// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { planCpfpChild, CpfpPlanError } from '../../../packages/core/src/flows/cpfpPlan.js';
import { planSpeedUp, signalsReplaceability } from '../../../packages/core/src/flows/rbfPlan.js';

const SOURCE = 'bcrt1qwallet';
const DESTINATION = 'bcrt1qrecipient';
const PARENT = 'aa'.repeat(32);
const SPK = `0014${'33'.repeat(20)}`;

const parent = ({ sequence = 0xffffffff, change = 20000 } = {}) => ({
    // parent fee is fixed at 1000 sats whatever the change is
    inputs: [{
        prevTxHash: '11'.repeat(32), prevTxIndex: 0, sequence, value: 7000 + change + 1000,
        scriptPubKeyHex: `0014${'22'.repeat(20)}`,
    }],
    outputs: [
        { address: DESTINATION, scriptType: 'p2wpkh', value: 7000, scriptPubKeyHex: `0014${'44'.repeat(20)}` },
        { address: SOURCE, scriptType: 'p2wpkh', value: change, scriptPubKeyHex: SPK },
    ],
});

describe('planCpfpChild feeRate', () => {
    it('spends only the wallet change and covers parent plus child at the feeRate', () => {
        const plan = planCpfpChild({
            parentTxid: PARENT, parent: parent(), sourceAddress: SOURCE, feeRate: 20, parentVbytes: 200,
        });
        // parent paid 1000; package 310 vB at 20 sat/vB = 6200; child pays 5200
        expect(plan.parentFeeSats).toBe('1000');
        expect(plan.childFeeSats).toBe('5200');
        expect(plan.packageFeeSats).toBe('6200');
        expect(plan.encoderOpts.utxos).toEqual([
            { txid: PARENT, vout: 1, value: 20000, scriptPubKey: SPK, confirmations: 0 },
        ].map((u) => ({ ...u })));
        expect(plan.encoderOpts.customOutputs).toEqual([{ address: SOURCE, value: 14800 }]);
    });

    it('never pays the child less than the feeRate on its own bytes', () => {
        const plan = planCpfpChild({
            parentTxid: PARENT, parent: parent(), sourceAddress: SOURCE,
            feeRate: 2, parentVbytes: 100, childVbytes: 100,
        });
        // parent pays 1000 (> package 400) so the child floor 200 applies
        expect(plan.childFeeSats).toBe('200');
    });

    it('refuses when the change cannot fund the child', () => {
        expect(() => planCpfpChild({
            parentTxid: PARENT, parent: parent({ change: 2000 }), sourceAddress: SOURCE,
            feeRate: 100, parentVbytes: 200,
        })).toThrow(CpfpPlanError);
    });

    it('refuses a parent with no wallet-owned output', () => {
        const p = parent();
        p.outputs[1].address = 'bcrt1qother';
        expect(() => planCpfpChild({
            parentTxid: PARENT, parent: p, sourceAddress: SOURCE, feeRate: 5, parentVbytes: 200,
        })).toThrow(/wallet-owned/);
    });

    it('rejects a missing or invalid feeRate', () => {
        expect(() => planCpfpChild({
            parentTxid: PARENT, parent: parent(), sourceAddress: SOURCE, parentVbytes: 200,
        })).toThrow(/feeRate/);
    });
});

describe('planSpeedUp', () => {
    it('offers CPFP for a parent that is not RBF-flagged', () => {
        expect(signalsReplaceability(parent())).toBe(false);
        const { method, plan } = planSpeedUp({
            conflict: parent(), parentTxid: PARENT, sourceAddress: SOURCE, feeRate: 10, transactionBytes: 200,
        });
        expect(method).toBe('cpfp');
        expect(plan.encoderOpts.options.exactInputs).toBe(true);
    });

    it('keeps replacing an RBF-flagged parent', () => {
        const { method } = planSpeedUp({
            conflict: parent({ sequence: 0xfffffffd }), parentTxid: PARENT, sourceAddress: SOURCE,
        });
        expect(method).toBe('rbf');
    });
});
