// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    assertSignedTxMatchesPsbt,
    enablesRelativeLock,
    isDeviceTxVersion,
    isValidSequence,
    parseRawTx,
} from '../../../packages/core/src/signers/verifySignedTx.js';

const INPUT = `${'00'.repeat(32)}0000000000ffffffff`;
const OUTPUT = '010000000000000000';

function oneInputTx(inputCount = '01') {
    return `01000000${inputCount}${INPUT}01${OUTPUT}00000000`;
}

function approved(value = 1) {
    return {
        txVersion: 1,
        locktime: 0,
        inputs: [{ prevTxHash: '00'.repeat(32), prevTxIndex: 0, sequence: 0xffffffff }],
        outputs: [{ scriptPubKeyHex: '', value }],
    };
}

describe('parseRawTx CompactSize edges', () => {
    it.each(['fd0100', 'fe01000000', 'ff0100000000000000'])(
        'accepts a one-input count encoded with %s',
        (inputCount) => {
            expect(parseRawTx(oneInputTx(inputCount))).toMatchObject({
                version: 1,
                locktime: 0,
                inputs: [{ prevTxIndex: 0, sequence: 0xffffffff }],
                outputs: [{ valueSat: 1n, scriptPubKeyHex: '' }],
            });
        },
    );

    it('rejects a CompactSize count beyond the safe integer range', () => {
        expect(() => parseRawTx('01000000ff0000000000002000')).toThrow('absurd varint');
    });

    it('rejects a transaction with zero inputs', () => {
        expect(() => parseRawTx('0100000000')).toThrow('transaction has no inputs');
    });

    it.each(['', '0', 'zz', null, 7])('rejects invalid transaction hex %j', (hex) => {
        expect(() => parseRawTx(hex)).toThrow('even-length hex string');
    });
});

describe('signed transaction comparison edges', () => {
    it.each([1n, '1'])('accepts exact satoshis represented as %s', (value) => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: oneInputTx(), decomposed: approved(value), signerId: 'signer-1',
        })).not.toThrow();
    });

    it.each([null, {}, { inputs: [], outputs: null }])(
        'refuses malformed decomposed PSBT value %#',
        (decomposed) => {
            expect(() => assertSignedTxMatchesPsbt({
                txHex: oneInputTx(), decomposed, signerId: 'signer-1',
            })).toThrow('nothing to compare against');
        },
    );

    it('refuses a mismatched input count before inspecting input fields', () => {
        const decomposed = approved();
        decomposed.inputs = [];
        expect(() => assertSignedTxMatchesPsbt({
            txHex: oneInputTx(), decomposed, signerId: 'signer-1',
        })).toThrow(/spends 1 input\(s\), the PSBT spent 0/);
    });

    it.each([-1, 1.5, '1.5'])('refuses inexact approved output value %j', (value) => {
        expect(() => assertSignedTxMatchesPsbt({
            txHex: oneInputTx(), decomposed: approved(value), signerId: 'signer-1',
        })).toThrow('not an exact satoshi amount');
    });

    it('refuses a non-finite approved locktime', () => {
        const decomposed = approved();
        decomposed.locktime = Infinity;
        expect(() => assertSignedTxMatchesPsbt({
            txHex: oneInputTx(), decomposed, signerId: 'signer-1',
        })).toThrow('locktime Infinity is not a number');
    });
});

describe('transaction policy helpers', () => {
    it.each([
        [0, true],
        [0xffffffff, true],
        [-1, false],
        [0x100000000, false],
        [1.5, false],
        ['1', false],
    ])('validates nSequence %j', (sequence, expected) => {
        expect(isValidSequence(sequence)).toBe(expected);
    });

    it('recognizes relative-lock and device-version boundaries', () => {
        expect(enablesRelativeLock(0x7fffffff)).toBe(true);
        expect(enablesRelativeLock(0x80000000)).toBe(false);
        expect(isDeviceTxVersion(1)).toBe(true);
        expect(isDeviceTxVersion(2)).toBe(true);
        expect(isDeviceTxVersion(0)).toBe(false);
        expect(isDeviceTxVersion(3)).toBe(false);
    });
});
