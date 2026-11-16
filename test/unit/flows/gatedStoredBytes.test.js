// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
    GATED_IV_BYTES,
    encryptGatedStoredBytes,
    freshGatedIv,
} from '../../../packages/core/src/flows/gatedStoredBytes.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });

const makeInputs = () => ({
    stored: new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]),
    key: new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1)),
    iv: new Uint8Array(Array.from({ length: 12 }, (_, index) => index + 41)),
});

function expectInvalid(args, field) {
    try {
        encryptGatedStoredBytes(args);
        throw new Error('expected encryption to refuse invalid input');
    } catch (error) {
        expect(error).toMatchObject({ code: 'GATED_STORED_INVALID' });
        expect(error.message).toContain(field);
    }
}

describe('gated stored byte compatibility', () => {
    it('decrypts through the pinned SDK and places the IV first', () => {
        const inputs = makeInputs();
        const output = encryptGatedStoredBytes(inputs);
        const decrypted = sdk.gatedFile.decryptFileBytes(
            Buffer.from(output),
            Buffer.from(inputs.key),
        );

        expect(new Uint8Array(decrypted)).toEqual(inputs.stored);
        expect(output.slice(0, GATED_IV_BYTES)).toEqual(inputs.iv);
    });

    it('is identical for the same inputs and changes with the IV', () => {
        const inputs = makeInputs();
        const repeated = encryptGatedStoredBytes(inputs);
        const changedIv = new Uint8Array(inputs.iv);
        changedIv[0] ^= 0xff;

        expect(encryptGatedStoredBytes(inputs)).toEqual(repeated);
        expect(encryptGatedStoredBytes({ ...inputs, iv: changedIv })).not.toEqual(repeated);
    });
});

describe('fresh gated IVs', () => {
    it('returns distinct 12-byte Uint8Arrays', () => {
        const first = freshGatedIv();
        const second = freshGatedIv();

        expect(first).toBeInstanceOf(Uint8Array);
        expect(first).toHaveLength(GATED_IV_BYTES);
        expect(second).toHaveLength(GATED_IV_BYTES);
        expect(second).not.toEqual(first);
    });
});

describe('gated stored byte validation', () => {
    it.each([
        ['key type', { ...makeInputs(), key: Array(32).fill(1) }, 'key'],
        ['key length', { ...makeInputs(), key: new Uint8Array(31) }, 'key'],
        ['iv type', { ...makeInputs(), iv: Array(12).fill(1) }, 'iv'],
        ['iv length', { ...makeInputs(), iv: new Uint8Array(11) }, 'iv'],
        ['stored type', { ...makeInputs(), stored: [1] }, 'stored'],
        ['empty stored bytes', { ...makeInputs(), stored: new Uint8Array() }, 'stored'],
    ])('refuses an invalid %s', (_label, args, field) => {
        expectInvalid(args, field);
    });

    it('accepts Buffers as Uint8Arrays', () => {
        const inputs = makeInputs();
        expect(encryptGatedStoredBytes({
            stored: Buffer.from(inputs.stored),
            key: Buffer.from(inputs.key),
            iv: Buffer.from(inputs.iv),
        })).toBeInstanceOf(Uint8Array);
    });
});

describe('gated stored byte input ownership', () => {
    it('returns new bytes without mutating any input', () => {
        const inputs = makeInputs();
        const snapshots = Object.fromEntries(
            Object.entries(inputs).map(([field, value]) => [field, new Uint8Array(value)]),
        );
        const output = encryptGatedStoredBytes(inputs);

        expect(inputs).toEqual(snapshots);
        expect(output).not.toBe(inputs.stored);
        expect(output).not.toBe(inputs.key);
        expect(output).not.toBe(inputs.iv);
    });
});
