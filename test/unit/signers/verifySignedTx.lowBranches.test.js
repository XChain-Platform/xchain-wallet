// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { assertSignedTxMatchesPsbt }
    from '../../../packages/core/src/signers/verifySignedTx.js';

const INPUT = `${'00'.repeat(32)}0000000000ffffffff`;
const TX = `0100000001${INPUT}0101000000000000000000000000`;

describe('signed transaction missing-field fallback', () => {
    it('refuses an approved input without a previous transaction hash', () => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: TX,
            signerId: 'signer-1',
            decomposed: {
                txVersion: 1,
                locktime: 0,
                inputs: [{ prevTxIndex: 0, sequence: 0xffffffff }],
                outputs: [{ scriptPubKeyHex: '', value: 1 }],
            },
        })).toThrow(`the PSBT spent :0`);
    });
});
