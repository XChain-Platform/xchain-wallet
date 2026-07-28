// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5.2.5: the confirm surface shows the fee the composed PSBT actually
// pays, not a rate-table estimate. The whole point of the single-encode
// pipeline is that what the user sees is what gets signed, and the fee is part
// of what they agree to.
//
// The load-bearing case is the REFUSAL to compute: a PSBT input carries a
// value only when it also carries the witnessUtxo or the full previous
// transaction. Subtracting outputs from a partial input total yields a number
// that looks like a fee and is too small, which on a signing screen is worse
// than admitting it is unknown.

import { describe, it, expect } from 'vitest';
import { exactNetworkFeeSats, totalNetworkFeeSats } from '../../../packages/core/src/flows/psbtNetworkFee.js';

describe('exactNetworkFeeSats', () => {
    it('computes inputs minus outputs', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, { value: 50000 }],
            outputs: [{ value: 120000 }, { value: 25000 }],
        })).toBe(5000);
    });

    it('counts a zero-value data output', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 10000 }],
            outputs: [{ value: 9000 }, { value: 0 }],
        })).toBe(1000);
    });

    it('returns null when ANY input value is missing', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, { value: null }],
            outputs: [{ value: 90000 }],
        })).toBe(null);
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, {}],
            outputs: [{ value: 90000 }],
        })).toBe(null);
    });

    it('returns null for a missing or empty decomposition', () => {
        expect(exactNetworkFeeSats(null)).toBe(null);
        expect(exactNetworkFeeSats({})).toBe(null);
        expect(exactNetworkFeeSats({ inputs: [], outputs: [] })).toBe(null);
    });

    it('returns null rather than a negative fee', () => {
        // Outputs exceeding inputs cannot happen in a well-formed tx; showing
        // "-0.001 BTC" on a signing screen would be nonsense.
        expect(exactNetworkFeeSats({
            inputs: [{ value: 1000 }],
            outputs: [{ value: 5000 }],
        })).toBe(null);
    });

    it('accepts a zero fee', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 1000 }],
            outputs: [{ value: 1000 }],
        })).toBe(0);
    });
});

// : on the P2SH/P2WSH chunk lanes an action is TWO transactions, and the
// composed PSBT the confirm screen inspects is only the first. Measured
// on-chain in wallet E2E session 20 while creating BET market #1160: the screen
// said 0.00000546 BTC and the address moved 0.00001092, because the funding tx
// paid 546 sats of miner fee AND created a 546-sat carrier output that the
// reveal then spent in full. The numbers below are that transaction pair.
describe('totalNetworkFeeSats', () => {
    // Funding tx of BET market #1160, read back from the regtest node:
    // one input, a 546-sat P2SH carrier, and change home to the source.
    const BET_1160 = {
        inputs: [{ value: 499999130 }],
        outputs: [
            { value: 546, scriptType: 'p2sh', address: '2N1oofV3qjxvuT9iK7Mt' },
            { value: 499998038, scriptType: 'p2wpkh', address: 'bcrt1qlx2eanawq23ujwhdg7txxdfpffzdvmgtxge98h' },
        ],
    };
    const OWN = ['bcrt1qlx2eanawq23ujwhdg7txxdfpffzdvmgtxge98h'];

    it('off the chunk lanes it agrees with exactNetworkFeeSats', () => {
        const single = {
            inputs: [{ value: 100000 }],
            outputs: [{ value: 95000, scriptType: 'p2wpkh', address: 'own' }],
        };
        expect(totalNetworkFeeSats(single, { carrierScripts: [], ownAddresses: ['own'] }))
            .toBe(exactNetworkFeeSats(single));
    });

    it('adds the reveal fee the carrier output pre-funds', () => {
        // The defect: 546. The chain: 1092.
        expect(exactNetworkFeeSats(BET_1160)).toBe(546);
        expect(totalNetworkFeeSats(BET_1160, {
            carrierScripts: ['52ae'],
            ownAddresses: OWN,
        })).toBe(1092);
    });

    it('does not count a p2sh CHANGE output as a carrier', () => {
        // A p2sh-p2wpkh change output classifies as plain 'p2sh' (decomposePsbt
        // has no redeemScript for outputs), so keying on the type alone would
        // treat the user's own change as a carrier and overstate the fee.
        const p2shChange = {
            inputs: [{ value: 100000 }],
            outputs: [
                { value: 546, scriptType: 'p2sh', address: 'carrier' },
                { value: 98454, scriptType: 'p2sh', address: 'my-change' },
            ],
        };
        expect(totalNetworkFeeSats(p2shChange, {
            carrierScripts: ['52ae'],
            ownAddresses: ['my-change'],
        })).toBe(1000 + 546);
    });

    it('excludes the native-coin protocol fee the reveal re-emits', () => {
        // The reveal spends the carrier to pay its miner fee AND the
        // FEE_DESTINATION output. Only the miner half is a network fee; the
        // rest is the protocol fee, which is 's to surface.
        expect(totalNetworkFeeSats({
            inputs: [{ value: 100000 }],
            outputs: [
                { value: 2546, scriptType: 'p2sh', address: 'carrier' },
                { value: 96954, scriptType: 'p2wpkh', address: 'own' },
            ],
        }, {
            carrierScripts: ['52ae'],
            ownAddresses: ['own'],
            revealOutputSats: 2000,
        })).toBe(500 + 546);
    });

    it('refuses when the carrier count disagrees with the encoder', () => {
        // Two chunks committed, one identifiable: our identification is wrong,
        // so admit it rather than quote a number that is short by a chunk.
        expect(totalNetworkFeeSats(BET_1160, {
            carrierScripts: ['52ae', '52ae'],
            ownAddresses: OWN,
        })).toBeNull();
    });

    it('stays null when the funding fee itself is unknowable', () => {
        expect(totalNetworkFeeSats({
            inputs: [{ value: null }],
            outputs: [{ value: 546, scriptType: 'p2sh', address: 'carrier' }],
        }, { carrierScripts: ['52ae'] })).toBeNull();
    });
});
