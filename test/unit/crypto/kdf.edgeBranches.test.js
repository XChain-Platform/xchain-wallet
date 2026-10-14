// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@noble/hashes/argon2', () => ({
    argon2id: vi.fn((password, salt, options) => {
        const byte = ((password[0] ?? 0) + (salt[0] ?? 0)) & 0xff;
        return new Uint8Array(options.dkLen).fill(byte);
    }),
}));

import { argon2id } from '@noble/hashes/argon2';
import {
    KDF_DEFAULT_PARALLELISM,
    KDF_KEY_LENGTH,
    KDF_MAX_ITERATIONS,
    KDF_MAX_MEMORY_KIB,
    KDF_MAX_PARALLELISM,
    KDF_MIN_ITERATIONS,
    KDF_MIN_MEMORY_KIB,
    KdfParamError,
    base64ToBytes,
    bytesToBase64,
    calibrateKdfParams,
    calibrateKdfParamsAsync,
    copyMasterKey,
    deriveMasterKey,
    deriveMasterKeyAsync,
    hasNativeArgon2id,
    kdfParamsEqual,
    makeFreshKdfParams,
    setNativeArgon2id,
    validateKdfParams,
} from '../../../packages/core/src/crypto/kdf.js';

const PARAMS = {
    algorithm: 'argon2id',
    salt: Buffer.alloc(8).toString('base64'),
    iterations: 1,
    memory: 8,
    parallelism: 1,
};
const NATIVE_KNOWN_KEY = '7OeLFLzPZZlGH7yt0gWieO0LVGA7YCWRFqfI14qQgk4=';

function verifiedProvider(answer) {
    let checking = true;
    return vi.fn(async (request) => {
        if (checking) {
            checking = false;
            return NATIVE_KNOWN_KEY;
        }
        return answer(request);
    });
}

beforeEach(() => {
    vi.mocked(argon2id).mockClear();
});

afterEach(() => {
    setNativeArgon2id(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('crypto/kdf parameter validation branches', () => {
    it.each([null, undefined, 'params'])('rejects non-object params %j', (params) => {
        expect(() => validateKdfParams(params)).toThrow(KdfParamError);
    });

    it('rejects an unsupported algorithm', () => {
        expect(() => validateKdfParams({ ...PARAMS, algorithm: 'scrypt' })).toThrow(/algorithm/);
    });

    it.each([
        ['iterations', 0],
        ['iterations', 1.5],
        ['iterations', '1'],
        ['memory', 0],
        ['memory', Number.POSITIVE_INFINITY],
        ['parallelism', -1],
        ['parallelism', Number.NaN],
    ])('rejects invalid %s value %j', (field, value) => {
        expect(() => validateKdfParams({ ...PARAMS, [field]: value })).toThrow(/positive integer/);
    });

    it.each([
        ['iterations', KDF_MAX_ITERATIONS + 1],
        ['memory', KDF_MAX_MEMORY_KIB + 1],
        ['parallelism', KDF_MAX_PARALLELISM + 1],
    ])('rejects %s above its ceiling', (field, value) => {
        expect(() => validateKdfParams({ ...PARAMS, [field]: value })).toThrow(/exceeds max/);
    });

    it('accepts positive safe integers at their ceilings', () => {
        expect(() => validateKdfParams({
            ...PARAMS,
            iterations: KDF_MAX_ITERATIONS,
            memory: KDF_MAX_MEMORY_KIB,
            parallelism: KDF_MAX_PARALLELISM,
        })).not.toThrow();
    });

    it('validates password and salt before invoking Argon2id', () => {
        expect(() => deriveMasterKey(null, PARAMS)).toThrow(TypeError);
        expect(() => deriveMasterKey('p', { ...PARAMS, salt: 'AQID' })).toThrow(/at least 8 bytes/);
        expect(argon2id).not.toHaveBeenCalled();
    });

    it('passes decoded inputs to Argon2id and clears its password bytes', () => {
        const key = deriveMasterKey('A', PARAMS);
        const [passwordBytes, saltBytes, options] = vi.mocked(argon2id).mock.calls[0];
        expect(key).toEqual(new Uint8Array(KDF_KEY_LENGTH).fill(65));
        expect(Array.from(passwordBytes)).toEqual([0]);
        expect(Array.from(saltBytes)).toEqual(new Array(8).fill(0));
        expect(options).toEqual({ t: 1, m: 8, p: 1, dkLen: KDF_KEY_LENGTH });
    });
});

describe('crypto/kdf native provider branches', () => {
    it('registers, verifies, and uses a native provider', async () => {
        const provider = verifiedProvider((request) => bytesToBase64(new Uint8Array(request.length).fill(9)));
        setNativeArgon2id(provider);
        expect(hasNativeArgon2id()).toBe(true);

        await expect(deriveMasterKeyAsync('p', PARAMS))
            .resolves.toEqual(new Uint8Array(KDF_KEY_LENGTH).fill(9));
        expect(provider).toHaveBeenCalledTimes(2);
        expect(argon2id).not.toHaveBeenCalled();
    });

    it('rejects invalid registration values and supports unregistering', () => {
        expect(() => setNativeArgon2id({})).toThrow(TypeError);
        setNativeArgon2id(vi.fn());
        expect(hasNativeArgon2id()).toBe(true);
        setNativeArgon2id(null);
        expect(hasNativeArgon2id()).toBe(false);
    });

    it.each([
        ['rejection', async () => { throw new Error('missing'); }],
        ['non-string reply', async () => ({ key: 'value' })],
        ['invalid base64', async () => '%'],
        ['wrong key length', async () => bytesToBase64(new Uint8Array(2))],
    ])('falls back when verification ends in %s', async (_label, provider) => {
        setNativeArgon2id(vi.fn(provider));
        await expect(deriveMasterKeyAsync('p', PARAMS))
            .resolves.toEqual(new Uint8Array(KDF_KEY_LENGTH).fill(112));
        expect(argon2id).toHaveBeenCalledOnce();
    });

    it('falls back when a verified provider rejects the wallet derivation', async () => {
        const provider = verifiedProvider(async () => { throw new Error('out of memory'); });
        setNativeArgon2id(provider);
        await expect(deriveMasterKeyAsync('p', PARAMS))
            .resolves.toEqual(new Uint8Array(KDF_KEY_LENGTH).fill(112));
        expect(provider).toHaveBeenCalledTimes(2);
        expect(argon2id).toHaveBeenCalledOnce();
    });

    it('does not use a provider removed while its verification is pending', async () => {
        let finish;
        const provider = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        setNativeArgon2id(provider);
        const pending = deriveMasterKeyAsync('p', PARAMS);
        setNativeArgon2id(null);
        finish(NATIVE_KNOWN_KEY);

        await expect(pending).resolves.toEqual(new Uint8Array(KDF_KEY_LENGTH).fill(112));
        expect(provider).toHaveBeenCalledOnce();
    });
});

describe('crypto/kdf comparison and copying branches', () => {
    it.each([
        [null, PARAMS],
        [PARAMS, null],
        ['params', PARAMS],
        [PARAMS, 'params'],
    ])('treats invalid param objects as unequal', (a, b) => {
        expect(kdfParamsEqual(a, b)).toBe(false);
    });

    it.each([
        ['algorithm', 'scrypt'],
        ['iterations', 2],
        ['memory', 9],
        ['parallelism', 2],
    ])('detects a different %s', (field, value) => {
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, [field]: value })).toBe(false);
    });

    it('rejects missing, malformed, empty, differently sized, and different salt bytes', () => {
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, salt: null })).toBe(false);
        expect(kdfParamsEqual({ ...PARAMS, salt: null }, PARAMS)).toBe(false);
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, salt: '%' })).toBe(false);
        expect(kdfParamsEqual({ ...PARAMS, salt: '' }, { ...PARAMS, salt: '' })).toBe(false);
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, salt: Buffer.alloc(9).toString('base64') })).toBe(false);
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, salt: Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]).toString('base64') }))
            .toBe(false);
    });

    it('compares decoded salt bytes instead of their encoding text', () => {
        expect(kdfParamsEqual(PARAMS, { ...PARAMS, salt: PARAMS.salt.replace(/=+$/, '') })).toBe(true);
    });

    it.each([32, new Uint8Array(31), new Array(32).fill(0), null])(
        'rejects invalid master key %j',
        (key) => {
            expect(() => copyMasterKey(key)).toThrow(/32-byte Uint8Array/);
        },
    );

    it('returns an independent master-key copy', () => {
        const key = new Uint8Array(32).fill(1);
        const copy = copyMasterKey(key);
        expect(copy).toEqual(key);
        expect(copy).not.toBe(key);
    });
});

describe('crypto/kdf generation, calibration, and encoding branches', () => {
    it('uses defaults and accepts explicit fresh-parameter overrides', () => {
        expect(makeFreshKdfParams()).toMatchObject({
            iterations: KDF_MIN_ITERATIONS,
            memory: KDF_MIN_MEMORY_KIB,
            parallelism: KDF_DEFAULT_PARALLELISM,
        });
        expect(makeFreshKdfParams({ iterations: 5, memory: 9, parallelism: 2 })).toMatchObject({
            iterations: 5,
            memory: 9,
            parallelism: 2,
        });
    });

    it.each([
        ['measured pass', [0, 100], { targetMs: 250, minIterations: 1, maxIterations: 10 }, 3],
        ['zero-time positive target', [0, 0], { targetMs: 1, minIterations: 2, maxIterations: 7 }, 7],
        ['zero-time zero target', [0, 0], { targetMs: 0, minIterations: 2, maxIterations: 7 }, 2],
    ])('sizes calibration for a %s', (_label, ticks, options, expected) => {
        vi.spyOn(performance, 'now').mockImplementation(() => ticks.shift() ?? 0);
        expect(calibrateKdfParams({ memory: 8, parallelism: 1, ...options }).iterations).toBe(expected);
    });

    it('uses default calibration options', () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        expect(calibrateKdfParams()).toMatchObject({
            iterations: 32,
            memory: KDF_MIN_MEMORY_KIB,
            parallelism: KDF_DEFAULT_PARALLELISM,
        });
    });

    it('falls back to synchronous calibration without a native provider', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        await expect(calibrateKdfParamsAsync({ targetMs: 0, memory: 8, minIterations: 1 }))
            .resolves.toMatchObject({ iterations: 1, memory: 8 });
    });

    it('calibrates from a verified native probe and caps portable iterations', async () => {
        const provider = verifiedProvider((request) => bytesToBase64(new Uint8Array(request.length).fill(1)));
        setNativeArgon2id(provider);
        const ticks = [0, 10];
        vi.spyOn(performance, 'now').mockImplementation(() => ticks.shift() ?? 10);
        await expect(calibrateKdfParamsAsync({ targetMs: 1000, memory: 8, minIterations: 1, maxIterations: 20 }))
            .resolves.toMatchObject({ iterations: 4, memory: 8 });
    });

    it('falls back when the verified native calibration probe fails', async () => {
        const provider = verifiedProvider(async () => null);
        setNativeArgon2id(provider);
        vi.spyOn(performance, 'now').mockReturnValue(0);
        await expect(calibrateKdfParamsAsync({ targetMs: 0, memory: 8, minIterations: 1 }))
            .resolves.toMatchObject({ iterations: 1, memory: 8 });
    });

    it('uses Buffer base64 fallbacks when browser helpers are absent', () => {
        vi.stubGlobal('btoa', undefined);
        expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID');
        vi.stubGlobal('atob', undefined);
        expect(base64ToBytes('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    });
});
