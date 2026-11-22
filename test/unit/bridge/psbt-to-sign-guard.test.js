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
import { psbtToSignVerdict } from '../../../packages/extension/src/bridge/psbtToSignGuard.js';

const MAGIC = '70736274ff';

function uint32LE(value) {
    return [0, 8, 16, 24]
        .map((shift) => ((value >>> shift) & 0xff).toString(16).padStart(2, '0'))
        .join('');
}

function compactSize(value) {
    if (value < 0xfd) return value.toString(16).padStart(2, '0');
    if (value <= 0xffff) return `fd${uint32LE(value).slice(0, 4)}`;
    return `fe${uint32LE(value)}`;
}

function entry(key, value) {
    const keyLength = (key.length / 2).toString(16).padStart(2, '0');
    const valueLength = (value.length / 2).toString(16).padStart(2, '0');
    return `${keyLength}${key}${valueLength}${value}`;
}

function v0Psbt(transactionVersion, psbtVersion = null) {
    const unsignedTransaction = `${uint32LE(transactionVersion)}000000000000`;
    const versionEntry = psbtVersion === null ? '' : entry('fb', uint32LE(psbtVersion));
    return `${MAGIC}${versionEntry}${entry('00', unsignedTransaction)}00`;
}

function fullV0Psbt(transactionVersion, scriptSig = '') {
    const scriptLength = (scriptSig.length / 2).toString(16).padStart(2, '0');
    const input = `${'00'.repeat(32)}ffffffff${scriptLength}${scriptSig}ffffffff`;
    const output = '01000000000000000151';
    const unsignedTransaction = `${uint32LE(transactionVersion)}01${input}01${output}00000000`;
    return `${MAGIC}${entry('00', unsignedTransaction)}000000`;
}

function v2Psbt(transactionVersion, inputCount = 0, outputCount = 0, maps = '', psbtVersion = 2) {
    const versionEntry = psbtVersion === null ? '' : entry('fb', uint32LE(psbtVersion));
    return `${MAGIC}${versionEntry}${entry('02', uint32LE(transactionVersion))}`
        + `${entry('04', compactSize(inputCount))}`
        + `${entry('05', compactSize(outputCount))}00${maps}`;
}

describe('psbtToSignVerdict', () => {
    it('catches transaction version 0 in a PSBT v0 unsigned transaction', () => {
        expect(psbtToSignVerdict(v0Psbt(0))).toBe('to_sign');
        expect(psbtToSignVerdict(v0Psbt(0, 0))).toBe('to_sign');
    });

    it('catches transaction version 0 in a PSBT v2 global field', () => {
        expect(psbtToSignVerdict(v2Psbt(0))).toBe('to_sign');
    });

    it('accepts nonzero transaction versions from both PSBT formats', () => {
        expect(psbtToSignVerdict(v0Psbt(1))).toBe('ok');
        expect(psbtToSignVerdict(fullV0Psbt(1))).toBe('ok');
        expect(psbtToSignVerdict(v2Psbt(2))).toBe('ok');
        expect(psbtToSignVerdict(v2Psbt(2, 1, 1, '0000'))).toBe('ok');
        expect(psbtToSignVerdict(v2Psbt(
            2,
            1,
            1,
            `${entry('01', 'aa')}00${entry('02', 'bb')}00`,
        ))).toBe('ok');
    });

    it.each([
        ['non-string input', null],
        ['empty input', ''],
        ['odd-length hex', `${MAGIC}0`],
        ['non-hex input', `${MAGIC}gg`],
        ['wrong magic', `00736274ff${entry('02', '00000000')}00`],
        ['missing global-map separator', `${MAGIC}${entry('02', '00000000')}`],
        ['truncated key length', `${MAGIC}fd`],
        ['truncated key', `${MAGIC}02ff`],
        ['truncated value length', `${MAGIC}0102fd`],
        ['truncated value', `${MAGIC}010204000000`],
        ['non-canonical CompactSize', `${MAGIC}fd0100020000`],
        ['global map with no transaction version', `${MAGIC}${entry('01', '00')}00`],
        ['short unsigned transaction', `${MAGIC}${entry('00', '000000')}00`],
        ['unsigned transaction truncated after version', `${MAGIC}${entry('00', '00000000')}00`],
        ['unsigned transaction truncated before locktime', `${MAGIC}${entry('00', '000000000000')}00`],
        ['unsigned transaction with a truncated input', `${MAGIC}${entry('00', '000000000100')}00`],
        ['unsigned transaction with a truncated output', `${MAGIC}${entry('00', '00000000000100')}00`],
        ['unsigned transaction with trailing data', `${MAGIC}${entry('00', '0000000000000000000000')}00`],
        ['unsigned transaction with a nonempty scriptSig', fullV0Psbt(1, '51')],
        ['wrong-size v2 transaction version', `${MAGIC}${entry('02', '000000')}00`],
        ['transaction version key data', `${MAGIC}${entry('0201', '00000000')}00`],
        ['duplicate transaction version', `${MAGIC}${entry('02', '00000000')}${entry('02', '01000000')}00`],
        ['both transaction version forms', `${MAGIC}${entry('00', '00000000')}${entry('02', '01000000')}00`],
        ['v0 PSBT truncated after the global map', fullV0Psbt(1).slice(0, -4)],
        ['v0 PSBT missing its output map', fullV0Psbt(1).slice(0, -2)],
        ['v2 PSBT truncated after the global map', v2Psbt(2, 1, 1)],
        ['v2 PSBT missing its output map', v2Psbt(2, 1, 1, '00')],
        ['truncated input-map key', `${fullV0Psbt(1).slice(0, -4)}01`],
        ['data after the required maps', `${fullV0Psbt(1)}00`],
        ['v2 PSBT missing its global version', v2Psbt(2, 0, 0, '', null)],
        ['v2 PSBT with a short global version', `${MAGIC}${entry('fb', '02')}${v2Psbt(2).slice(MAGIC.length + entry('fb', '02000000').length)}`],
        ['v2 PSBT with an unsupported global version', v2Psbt(2, 0, 0, '', 3)],
        ['v2 PSBT with a conflicting global version', v2Psbt(2, 0, 0, '', 0)],
        ['global version key data', `${MAGIC}${entry('fb01', '02000000')}${v2Psbt(2).slice(MAGIC.length + entry('fb', '02000000').length)}`],
        ['v0 PSBT with a conflicting global version', v0Psbt(1, 2)],
        ['v2 PSBT missing its input count', `${MAGIC}${entry('fb', '02000000')}${entry('02', '02000000')}${entry('05', '00')}00`],
        ['v2 PSBT missing its output count', `${MAGIC}${entry('fb', '02000000')}${entry('02', '02000000')}${entry('04', '00')}00`],
        ['non-canonical v2 input count', `${MAGIC}${entry('fb', '02000000')}${entry('02', '02000000')}${entry('04', 'fd0100')}${entry('05', '00')}00`],
        ['v2 count with trailing data', `${MAGIC}${entry('fb', '02000000')}${entry('02', '02000000')}${entry('04', '0000')}${entry('05', '00')}00`],
        ['v2 input count key data', `${MAGIC}${entry('fb', '02000000')}${entry('0401', '00')}${entry('02', '02000000')}${entry('05', '00')}00`],
        ['v0 PSBT with v2 count fields', `${v0Psbt(1).slice(0, -2)}${entry('04', '00')}${entry('05', '00')}00`],
        ['duplicate input-map key', v2Psbt(2, 1, 0, `${entry('01', 'aa')}${entry('01', 'bb')}00`)],
    ])('returns unparsed for %s', (_label, input) => {
        expect(psbtToSignVerdict(input)).toBe('unparsed');
    });

    it('never throws for values outside the input contract', () => {
        const hostile = { toString() { throw new Error('no coercion allowed'); } };
        expect(() => psbtToSignVerdict(hostile)).not.toThrow();
        expect(psbtToSignVerdict(hostile)).toBe('unparsed');
    });
});
