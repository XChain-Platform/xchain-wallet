// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { toTrezorSignTransaction } from '../../../packages/signers-trezor/src/trezorFormat.js';

const prevTx = (hash, version) => ({ hash, inputs: [], outputs: [], version, locktime: 0 });

function mixedInputs(secondPrevTxInfo) {
    return {
        inputs: [
            {
                scriptType: 'p2pkh', prevTxHash: 'a'.repeat(64), prevTxIndex: 0,
                prevTxInfo: prevTx('a'.repeat(64), 1), value: 600, sequence: 0xffffffff,
            },
            {
                scriptType: 'p2wpkh', prevTxHash: 'b'.repeat(64), prevTxIndex: 1,
                prevTxInfo: secondPrevTxInfo, value: 500, sequence: 0xffffffff,
            },
        ],
        outputs: [{
            value: 1000,
            scriptPubKeyHex: `0014${'c'.repeat(40)}`,
            address: 'bc1qrecipient',
        }],
        txVersion: 2,
    };
}

const signingPaths = [
    { inputIndex: 0, path: "m/44'/0'/0'/0/0" },
    { inputIndex: 1, path: "m/84'/0'/0'/0/1" },
];

describe('toTrezorSignTransaction mixed previous transactions', () => {
    it('omits the whole reference list when one input lacks its previous transaction', () => {
        const payload = toTrezorSignTransaction({
            decomposed: mixedInputs(null), coin: 'btc', signingPaths,
        });
        expect(payload.refTxs).toBeUndefined();
    });

    it('includes every distinct reference when every input carries one', () => {
        const payload = toTrezorSignTransaction({
            decomposed: mixedInputs(prevTx('b'.repeat(64), 2)), coin: 'btc', signingPaths,
        });
        expect(payload.refTxs.map(({ hash }) => hash)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    });
});
