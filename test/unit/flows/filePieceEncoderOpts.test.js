// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { filePieceEncoderOpts } from '../../../packages/core/src/flows/filePieceEncoderOpts.js';

const PUBLIC_KEY = `02${'ab'.repeat(32)}`;
const FUNDING_OUTPUT = {
    txid: 'cd'.repeat(32),
    vout: 2,
    value: 450000,
    scriptPubKey: '0014feed',
};

function input(overrides = {}) {
    return {
        pieceKind: 'part',
        lane: 'envelope',
        buildMode: 'one_call',
        phase: 'commit',
        source: { address: 'bc1qsource', publicKey: PUBLIC_KEY },
        fundingOutput: { ...FUNDING_OUTPUT },
        rate: 1,
        data: { VERSION: 2, FILE_HASH: 'ef'.repeat(32), PART_INDEX: 0 },
        rawData: 'piece bytes',
        ...overrides,
    };
}

function call(overrides = {}) {
    return filePieceEncoderOpts(input(overrides));
}

function expectInvalid(overrides, field) {
    try {
        call(overrides);
        throw new Error('Expected filePieceEncoderOpts to throw');
    } catch (error) {
        expect(error.code).toBe('FILE_PIECE_OPTS_INVALID');
        expect(error.message).toContain(field);
    }
}

const BASE_KEYS = [
    'change', 'compress', 'compressedPubKey', 'data', 'encoding', 'feePerKb',
    'options', 'pubkey', 'sourceAddress', 'utxos',
];

const REQUEST_CASES = [
    ['envelope one-call commit', 'envelope', 'one_call', 'commit', {
        exactInputs: true, signerSupportsTapscript: true,
    }],
    ['envelope one-call reveal', 'envelope', 'one_call', 'reveal', {
        exactInputs: true, signerSupportsTapscript: true,
    }],
    ['envelope two-step commit', 'envelope', 'two_step', 'commit', {
        exactInputs: true, signerSupportsTapscript: true, twoStepEnvelope: true,
    }],
    ['envelope two-step reveal', 'envelope', 'two_step', 'reveal', {
        envelopeCommitHex: 'aabb', signerSupportsTapscript: true,
    }],
    ['standard one-call commit', 'standard', 'one_call', 'commit', {
        exactInputs: true,
    }],
    ['standard one-call reveal', 'standard', 'one_call', 'reveal', {
        exactInputs: true,
    }],
];

describe('request shapes', () => {
    it.each(REQUEST_CASES)('builds the exact part keys for %s',
        (_name, lane, buildMode, phase, options) => {
            const result = call({ lane, buildMode, phase, signedCommitHex: 'aabb' });
            expect(Object.keys(result).sort()).toEqual([...BASE_KEYS, 'rawData'].sort());
            expect(result.options).toEqual(options);
            expect(result.encoding).toBe(lane === 'envelope' ? 'TAPROOT' : 'P2SH');
        });

    it.each(REQUEST_CASES)('builds the exact manifest keys for %s',
        (_name, lane, buildMode, phase, options) => {
            const result = call({
                pieceKind: 'manifest', lane, buildMode, phase,
                rawData: undefined, signedCommitHex: 'aabb',
            });
            expect(Object.keys(result).sort()).toEqual([...BASE_KEYS].sort());
            expect(result.options).toEqual(options);
            expect(result).not.toHaveProperty('rawData');
        });
});

describe('part bytes on the wire', () => {
    it('sends a byte array part as the binary string the encoder rebuilds', () => {
        const bytes = Uint8Array.from([0, 1, 127, 128, 200, 255]);
        const result = call({ rawData: bytes });
        expect(typeof result.rawData).toBe('string');
        expect(Buffer.from(result.rawData, 'binary').equals(Buffer.from(bytes))).toBe(true);
    });
});

describe('shared request fields', () => {
    it('maps the source, funding output, payload, and fixed fields', () => {
        const args = input();
        const result = filePieceEncoderOpts(args);
        expect(result).toMatchObject({
            pubkey: 'bc1qsource',
            compressedPubKey: PUBLIC_KEY,
            sourceAddress: 'bc1qsource',
            change: 'bc1qsource',
            utxos: [args.fundingOutput],
            compress: false,
            data: args.data,
            rawData: 'piece bytes',
        });
        expect(result).not.toHaveProperty('unconfirmed');
        expect(Object.values(result)).not.toContain(undefined);
    });

    it.each([[1, 1000], [12.5, 12500]])('converts rate %s to %s sat/kB', (rate, feePerKb) => {
        expect(call({ rate }).feePerKb).toBe(feePerKb);
    });
});

describe('two-step envelope phases', () => {
    it('changes only options between commit and reveal', () => {
        const shared = { buildMode: 'two_step', signedCommitHex: 'aabbcc' };
        const commit = call({ ...shared, phase: 'commit' });
        const reveal = call({ ...shared, phase: 'reveal' });
        const { options: commitOptions, ...commitFields } = commit;
        const { options: revealOptions, ...revealFields } = reveal;
        expect(revealFields).toEqual(commitFields);
        expect(commitOptions).toEqual({
            exactInputs: true, signerSupportsTapscript: true, twoStepEnvelope: true,
        });
        expect(revealOptions).toEqual({
            envelopeCommitHex: 'aabbcc', signerSupportsTapscript: true,
        });
        expect(revealOptions).not.toHaveProperty('exactInputs');
        expect(revealOptions).not.toHaveProperty('twoStepEnvelope');
    });
});

describe('enumerated field refusals', () => {
    it.each([
        [{ pieceKind: 'chunk' }, 'pieceKind'],
        [{ lane: 'legacy' }, 'lane'],
        [{ buildMode: 'batch' }, 'buildMode'],
        [{ phase: 'publish' }, 'phase'],
        [{ lane: 'standard', buildMode: 'two_step' }, 'buildMode'],
    ])('refuses %j and names %s', (overrides, field) => {
        expectInvalid(overrides, field);
    });
});

describe('source and funding refusals', () => {
    it.each([
        [undefined, 'source.publicKey'],
        [`04${'ab'.repeat(32)}`, 'source.publicKey'],
        [`02${'ab'.repeat(31)}`, 'source.publicKey'],
        [`03${'xy'.repeat(32)}`, 'source.publicKey'],
    ])('refuses public key %s', (publicKey, field) => {
        expectInvalid({ source: { address: 'bc1qsource', publicKey } }, field);
    });

    it.each(['txid', 'vout', 'value', 'scriptPubKey'])('refuses funding output missing %s', (field) => {
        const fundingOutput = { ...FUNDING_OUTPUT };
        delete fundingOutput[field];
        expectInvalid({ fundingOutput }, field);
    });
});

describe('rate and payload refusals', () => {
    it.each([NaN, Infinity, 0, -1])('refuses rate %s', (rate) => {
        expectInvalid({ rate }, 'rate');
    });

    it.each([undefined, null, '', [], Buffer.alloc(0)])('refuses empty part rawData %s', (rawData) => {
        expectInvalid({ rawData }, 'rawData');
    });

    it('refuses rawData on a manifest', () => {
        expectInvalid({ pieceKind: 'manifest', rawData: 'not allowed' }, 'rawData');
    });
});

describe('signed commit refusals', () => {
    it.each([undefined, '', 'abc', 'zz'])('refuses reveal signed commit hex %s', (signedCommitHex) => {
        expectInvalid({ buildMode: 'two_step', phase: 'reveal', signedCommitHex }, 'signedCommitHex');
    });
});

describe('input immutability', () => {
    it('does not mutate nested inputs', () => {
        const args = input({ buildMode: 'two_step', phase: 'reveal', signedCommitHex: 'aabb' });
        const before = structuredClone(args);
        filePieceEncoderOpts(args);
        expect(args).toEqual(before);
    });
});
