// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The encoder funds a send from the utxo-tracker's answer for the spender and
// never compares a row's script with that address. Measured in the extension
// side panel against a local venue: a get_utxos answer whose row paid another
// script (a different p2wpkh hash, or a legacy p2pkh of another chain's address
// family) reached the Confirm screen with a network fee computed from those
// coins, and Approve failed only inside the signer. The tamper check refuses
// the PSBT before Confirm instead, on both lanes that call it.

import { describe, expect, it } from 'vitest';
import {
    assertNoTamper,
    buildExpectedOutputs,
    checkInputOwnership,
    TamperDetectedError,
} from '../../../packages/core/src/flows/confirmChecks.js';

const SPENDER = 'bcrt1qzpe0rftccmlvgfmwz7ek683ma5nr9rcg6d9nkg';
const DEST = 'bcrt1qmr46t4ca5wh35k6mczdzrkepqw2d8ne956f48f';
const FOREIGN = 'bcrt1q4w4tt0g4v0yt9ae3g4amgu3gp9z3x3gu0vudxm';

const outputs = [
    { address: DEST, scriptType: 'p2wpkh', scriptPubKeyHex: '0014aa', value: 50000 },
    { address: SPENDER, scriptType: 'p2wpkh', scriptPubKeyHex: '0014bb', value: 99154 },
];
const input = (address, n) => ({ address, prevTxHash: String(n).repeat(64).slice(0, 64), prevTxIndex: 0, value: 150000 });
const decomposerFor = (inputs) => () => ({ inputs, outputs });

function check(inputs) {
    return assertNoTamper({
        psbtHex: 'psbt',
        expected: buildExpectedOutputs({ customOutputs: [{ address: DEST, value: 50000 }], encoding: null }),
        ownAddresses: [SPENDER],
        decomposePsbt: decomposerFor(inputs),
        actionString: null,
        decodeActionFromPsbt: () => null,
    });
}

describe('a PSBT funded by coins the wallet does not hold is refused before Confirm', () => {
    it('refuses an input paying another address', () => {
        expect(() => check([input(FOREIGN, 1)])).toThrow(TamperDetectedError);
        expect(() => check([input(FOREIGN, 1)])).toThrow(/spends 1 coin\(s\) this wallet does not hold/);
    });

    it('refuses a foreign input beside the spender\'s own', () => {
        let err;
        try { check([input(SPENDER, 2), input(FOREIGN, 3)]); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.inputs).toEqual([{ index: 1, address: FOREIGN, outpoint: `${'3'.repeat(64)}:0` }]);
    });

    it('passes inputs that pay the spender, and leaves an undecodable script to the signer', () => {
        expect(() => check([input(SPENDER, 4)])).not.toThrow();
        expect(checkInputOwnership({
            psbtHex: 'psbt', ownAddresses: [SPENDER], decomposePsbt: decomposerFor([input(null, 5)]),
        }).ok).toBe(true);
    });
});
