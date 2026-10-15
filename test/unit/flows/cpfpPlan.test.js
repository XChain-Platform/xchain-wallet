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
const BTC = { dustThreshold: 546, supportsSegwit: true };

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
            network: BTC,
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
            feeRate: 2, parentVbytes: 100, childVbytes: 100, network: BTC,
        });
        // parent pays 1000 (> package 400) so the child floor 200 applies
        expect(plan.childFeeSats).toBe('200');
    });

    it('refuses when the change cannot fund the child', () => {
        expect(() => planCpfpChild({
            parentTxid: PARENT, parent: parent({ change: 2000 }), sourceAddress: SOURCE,
            feeRate: 100, parentVbytes: 200, network: BTC,
        })).toThrow(/cannot cover the child fee/);
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

const DOGE = { dustThreshold: 100000, supportsSegwit: false };
const LTC = { dustThreshold: 5460, supportsSegwit: true };
const P2PKH = `76a914${'33'.repeat(20)}88ac`;

// A parent whose wallet change pays to `spk`; its fee stays 1000.
const parentPaying = (spk, change) => {
    const p = parent({ change });
    p.outputs[1].scriptPubKeyHex = spk;
    return p;
};
const plan = (p, network, extra = {}) => planCpfpChild({
    parentTxid: PARENT, parent: p, sourceAddress: SOURCE, feeRate: 10, parentVbytes: 200, network, ...extra,
});

describe('planCpfpChild chain dust floor', () => {
    it('refuses a Dogecoin child output under 100000 koinu that Bitcoin rules would pass', () => {
        // 392 B package at 10 sat/B = 3920; parent paid 1000, so the child pays 2920 and keeps 47080
        expect(() => plan(parentPaying(P2PKH, 50000), DOGE)).toThrow(/cannot cover the child fee/);
        expect(plan(parentPaying(P2PKH, 50000), { dustThreshold: 546, supportsSegwit: false })
            .encoderOpts.customOutputs).toEqual([{ address: SOURCE, value: 47080 }]);
    });

    it('sizes a funded Dogecoin child as a 192-byte P2PKH spend', () => {
        const p = plan(parentPaying(P2PKH, 200000), DOGE);
        expect(p.packageVbytes).toBe(392);
        expect(p.childFeeSats).toBe('2920');
        expect(p.encoderOpts.customOutputs).toEqual([{ address: SOURCE, value: 197080 }]);
    });

    it('refuses a Litecoin child output under 5460', () => {
        // 310 vB package = 3100; the child pays 2100 and would keep 4900
        expect(() => plan(parentPaying(SPK, 7000), LTC)).toThrow(/cannot cover the child fee/);
        expect(plan(parentPaying(SPK, 7000), BTC).childFeeSats).toBe('2100');
    });

    it('refuses without a known dust floor instead of assuming 546', () => {
        expect(() => plan(parent(), undefined)).toThrow(/dust floor is unknown/);
        expect(() => plan(parent(), { dustThreshold: 0, supportsSegwit: true })).toThrow(/dust floor is unknown/);
        expect(() => plan(parent(), { supportsSegwit: true })).toThrow(CpfpPlanError);
    });
});

describe('planCpfpChild child size and segwit', () => {
    it('sizes the child from the spent script type', () => {
        expect(plan(parentPaying(SPK, 20000), BTC).packageVbytes).toBe(310);
        expect(plan(parentPaying(`a914${'33'.repeat(20)}87`, 20000), BTC).packageVbytes).toBe(334);
        expect(plan(parentPaying(`5120${'33'.repeat(32)}`, 20000), BTC).packageVbytes).toBe(311);
    });

    it('refuses a script it cannot size unless childVbytes is passed', () => {
        const p2wsh = `0020${'33'.repeat(32)}`;
        expect(() => plan(parentPaying(p2wsh, 20000), BTC)).toThrow(/cannot size the child/);
        expect(plan(parentPaying(p2wsh, 20000), BTC, { childVbytes: 150 }).packageVbytes).toBe(350);
    });

    it('refuses a witness output on a chain without segwit', () => {
        expect(() => plan(parentPaying(SPK, 200000), DOGE)).toThrow(/no segwit/);
        expect(() => plan(parentPaying(`0020${'33'.repeat(32)}`, 200000), DOGE, { childVbytes: 150 }))
            .toThrow(/no segwit/);
    });

    it('planSpeedUp forwards the network to the CPFP branch', () => {
        expect(() => planSpeedUp({
            conflict: parentPaying(P2PKH, 50000), parentTxid: PARENT, sourceAddress: SOURCE,
            feeRate: 10, transactionBytes: 200, network: DOGE,
        })).toThrow(/cannot cover the child fee/);
    });
});

describe('planSpeedUp', () => {
    it('offers CPFP for a parent that is not RBF-flagged', () => {
        expect(signalsReplaceability(parent())).toBe(false);
        const { method, plan } = planSpeedUp({
            conflict: parent(), parentTxid: PARENT, sourceAddress: SOURCE, feeRate: 10, transactionBytes: 200,
            network: BTC,
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

    it('treats one signalling input as replaceable and routes a mixed parent to RBF', () => {
        const mixed = parent({ sequence: 0xffffffff });
        mixed.inputs.push({ ...mixed.inputs[0], prevTxHash: '55'.repeat(32), sequence: 0xfffffffd, value: 0 });
        expect(signalsReplaceability(mixed)).toBe(true);
        const { method, plan } = planSpeedUp({
            conflict: mixed, parentTxid: PARENT, sourceAddress: SOURCE, feeRate: 10, transactionBytes: 300,
        });
        expect(method).toBe('rbf');
        expect(plan.encoderOpts.rbf).toBe(true);
    });

    it('routes a parent where no input signals to CPFP', () => {
        const none = parent();
        none.inputs.push({ ...none.inputs[0], prevTxHash: '55'.repeat(32), sequence: 0xfffffffe });
        expect(signalsReplaceability(none)).toBe(false);
    });
});
