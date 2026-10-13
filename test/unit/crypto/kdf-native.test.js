// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The native Argon2id seam in core's KDF: the golden vectors through both
// JS entry points, the provider path, every fallback, the ceilings that run
// before a provider sees a request, and native-timed calibration.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { argon2id } from '@noble/hashes/argon2';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import vectorFile from '../../fixtures/crypto/argon2id-vectors.json';
import {
    deriveMasterKey,
    deriveMasterKeyAsync,
    setNativeArgon2id,
    hasNativeArgon2id,
    calibrateKdfParamsAsync,
    KdfParamError,
    bytesToBase64,
    base64ToBytes,
    KDF_KEY_LENGTH,
    KDF_MIN_ITERATIONS,
    KDF_MIN_MEMORY_KIB,
    KDF_MAX_ITERATIONS,
    KDF_MAX_MEMORY_KIB,
    KDF_MAX_PARALLELISM,
    KDF_NATIVE_CALIBRATION_MAX_ITERATIONS,
} from '../../../packages/core/src/crypto/kdf.js';

// The 64 MiB vectors pay a real production-cost derivation per case.
vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const VECTORS = vectorFile.vectors;
// The 8 MiB vector: cheap enough to run many times below.
const SMALL = VECTORS.find((v) => v.memoryKib === 8192);

const toParams = (v) => ({
    algorithm: 'argon2id',
    salt: v.salt,
    iterations: v.iterations,
    memory: v.memoryKib,
    parallelism: v.parallelism,
});
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** A faithful native stand-in: the JS reference behind the plugin's contract. */
function referenceAnswer(req) {
    const key = argon2id(new TextEncoder().encode(req.password), base64ToBytes(req.salt), {
        t: req.iterations, m: req.memoryKib, p: req.parallelism, dkLen: req.length,
    });
    return bytesToBase64(key);
}

/**
 * A provider that answers core's known-answer check correctly and lets the
 * test decide what every other request gets.
 */
function providerWith(onRequest) {
    let checked = false;
    return vi.fn(async (req) => {
        if (!checked) {
            checked = true;
            return referenceAnswer(req);
        }
        return onRequest(req);
    });
}

afterEach(() => {
    setNativeArgon2id(null);
    vi.restoreAllMocks();
});

describe('golden vectors through the JS paths (no provider)', () => {
    it.each(VECTORS.map((v) => [v.name, v]))('deriveMasterKey: %s', (_name, v) => {
        expect(hex(deriveMasterKey(v.password, toParams(v)))).toBe(v.keyHex);
    });

    it.each(VECTORS.map((v) => [v.name, v]))('deriveMasterKeyAsync: %s', async (_name, v) => {
        expect(hasNativeArgon2id()).toBe(false);
        expect(hex(await deriveMasterKeyAsync(v.password, toParams(v)))).toBe(v.keyHex);
    });

    it('keyBase64 and keyHex in the fixture name the same bytes', () => {
        for (const v of VECTORS) {
            expect(hex(base64ToBytes(v.keyBase64))).toBe(v.keyHex);
        }
    });
});

describe('deriveMasterKeyAsync with a native provider', () => {
    it('sends the contract request and returns the right key from a correct provider', async () => {
        const provider = providerWith(async (req) => referenceAnswer(req));
        setNativeArgon2id(provider);
        expect(hasNativeArgon2id()).toBe(true);

        const key = await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(hex(key)).toBe(SMALL.keyHex);
        // One known-answer check, then the real derivation.
        expect(provider).toHaveBeenCalledTimes(2);
        expect(provider.mock.calls[1][0]).toEqual({
            password: SMALL.password,
            salt: SMALL.salt,
            iterations: SMALL.iterations,
            memoryKib: SMALL.memoryKib,
            parallelism: SMALL.parallelism,
            length: KDF_KEY_LENGTH,
        });
    });

    it('returns the provider key, not a JS recomputation, once the provider is trusted', async () => {
        const sentinel = new Uint8Array(KDF_KEY_LENGTH).fill(0xab);
        setNativeArgon2id(providerWith(async () => bytesToBase64(sentinel)));
        const key = await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(key).toEqual(sentinel);
    });

    it('runs the known-answer check once per provider, not once per derivation', async () => {
        const provider = providerWith(async (req) => referenceAnswer(req));
        setNativeArgon2id(provider);
        await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        // Re-registering the same function keeps its verdict.
        setNativeArgon2id(provider);
        await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(provider).toHaveBeenCalledTimes(4);
    });

    it('rechecks the same provider after it is unregistered', async () => {
        let correct = true;
        const wrong = bytesToBase64(new Uint8Array(KDF_KEY_LENGTH).fill(7));
        const provider = vi.fn(async (req) => (correct ? referenceAnswer(req) : wrong));
        setNativeArgon2id(provider);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);

        setNativeArgon2id(null);
        correct = false;
        setNativeArgon2id(provider);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);
        expect(provider).toHaveBeenCalledTimes(3);
    });

    it('re-encodes the salt as canonical base64 before it crosses to native code', async () => {
        const provider = providerWith(async (req) => referenceAnswer(req));
        setNativeArgon2id(provider);
        const unpadded = SMALL.salt.replace(/=+$/, '');
        const key = await deriveMasterKeyAsync(SMALL.password, { ...toParams(SMALL), salt: unpadded });
        expect(provider.mock.calls[1][0].salt).toBe(SMALL.salt);
        expect(hex(key)).toBe(SMALL.keyHex);
    });

    it('falls back to JS with the same key when the provider rejects', async () => {
        const provider = providerWith(async () => { throw new Error('out of memory'); });
        setNativeArgon2id(provider);
        const key = await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(hex(key)).toBe(SMALL.keyHex);
        expect(provider).toHaveBeenCalledTimes(2);
    });

    // Wrong length falls back rather than throws: the contract makes any
    // native failure safe, and the JS key is the one every wallet was sealed with.
    it('falls back to JS when the provider returns a wrong-length key', async () => {
        setNativeArgon2id(providerWith(async () => bytesToBase64(new Uint8Array(16).fill(1))));
        const key = await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(hex(key)).toBe(SMALL.keyHex);
    });

    it.each([
        ['an object', { key: 'AAAA' }],
        ['undefined', undefined],
        ['a byte array', new Uint8Array(32)],
    ])('falls back to JS when the provider resolves %s', async (_label, reply) => {
        setNativeArgon2id(providerWith(async () => reply));
        const key = await deriveMasterKeyAsync(SMALL.password, toParams(SMALL));
        expect(hex(key)).toBe(SMALL.keyHex);
    });

    it('never trusts a provider that fails the known answer, and stops asking it', async () => {
        const wrong = bytesToBase64(new Uint8Array(KDF_KEY_LENGTH).fill(7));
        const provider = vi.fn(async () => wrong);
        setNativeArgon2id(provider);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);
        expect(provider).toHaveBeenCalledTimes(1);
    });

    it('treats a provider that rejects everything (an older shell) as absent after one call', async () => {
        const provider = vi.fn(async () => { throw new Error('not implemented'); });
        setNativeArgon2id(provider);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);
        expect(hex(await deriveMasterKeyAsync(SMALL.password, toParams(SMALL)))).toBe(SMALL.keyHex);
        expect(provider).toHaveBeenCalledTimes(1);
    });

    it('rejects a non-function provider', () => {
        expect(() => setNativeArgon2id('argon2id')).toThrow(TypeError);
        expect(hasNativeArgon2id()).toBe(false);
    });
});

describe('deriveMasterKeyAsync validates before any provider call', () => {
    const base = toParams(SMALL);
    it.each([
        ['iterations over the ceiling', { iterations: KDF_MAX_ITERATIONS + 1 }],
        ['memory over the ceiling', { memory: KDF_MAX_MEMORY_KIB + 1 }],
        ['parallelism over the ceiling', { parallelism: KDF_MAX_PARALLELISM + 1 }],
        ['a non-integer iteration count', { iterations: 2.5 }],
        ['an unsupported algorithm', { algorithm: 'scrypt' }],
        ['a salt under 8 bytes', { salt: 'AQIDBA==' }],
    ])('%s', async (_label, override) => {
        const provider = vi.fn(async (req) => referenceAnswer(req));
        setNativeArgon2id(provider);
        await expect(deriveMasterKeyAsync('p', { ...base, ...override }))
            .rejects.toBeInstanceOf(KdfParamError);
        expect(provider).not.toHaveBeenCalled();
    });

    it('rejects missing params', async () => {
        const provider = vi.fn();
        setNativeArgon2id(provider);
        await expect(deriveMasterKeyAsync('p', null)).rejects.toBeInstanceOf(KdfParamError);
        expect(provider).not.toHaveBeenCalled();
    });
});

describe('calibrateKdfParamsAsync', () => {
    /** Register a provider whose probe takes `probeMs` on a clock the test owns. */
    function timedProvider(probeMs) {
        let clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        const provider = providerWith(async (req) => {
            clock += probeMs;
            return bytesToBase64(new Uint8Array(req.length).fill(1));
        });
        setNativeArgon2id(provider);
        return provider;
    }

    it('without a provider sizes on the JS probe, within the usual bounds', async () => {
        const params = await calibrateKdfParamsAsync({ memory: 8192, targetMs: 1 });
        expect(params.algorithm).toBe('argon2id');
        expect(params.memory).toBe(8192);
        expect(params.iterations).toBeGreaterThanOrEqual(KDF_MIN_ITERATIONS);
        expect(params.iterations).toBeLessThanOrEqual(32);
        expect(base64ToBytes(params.salt)).toHaveLength(16);
    });

    it('probes one native pass at the requested cost', async () => {
        const provider = timedProvider(400);
        await calibrateKdfParamsAsync();
        const probe = provider.mock.calls[1][0];
        expect(probe).toMatchObject({
            iterations: 1,
            memoryKib: KDF_MIN_MEMORY_KIB,
            parallelism: 1,
            length: KDF_KEY_LENGTH,
        });
        expect(base64ToBytes(probe.salt)).toHaveLength(16);
    });

    it('keeps the floor when one native pass is already a large share of the target', async () => {
        timedProvider(400);
        const params = await calibrateKdfParamsAsync();
        expect(params.iterations).toBe(KDF_MIN_ITERATIONS);
    });

    it('raises iterations for a fast native pass, but never past the portability ceiling', async () => {
        timedProvider(300);
        expect((await calibrateKdfParamsAsync()).iterations).toBe(KDF_NATIVE_CALIBRATION_MAX_ITERATIONS);
        setNativeArgon2id(null);
        vi.restoreAllMocks();
        timedProvider(10);
        expect((await calibrateKdfParamsAsync()).iterations).toBe(KDF_NATIVE_CALIBRATION_MAX_ITERATIONS);
    });

    it('honours a caller maxIterations below the ceiling and a minIterations above it', async () => {
        timedProvider(10);
        expect((await calibrateKdfParamsAsync({ maxIterations: 3 })).iterations).toBe(3);
        expect((await calibrateKdfParamsAsync({ minIterations: 6 })).iterations).toBe(6);
    });

    it('falls back to the JS probe when the native probe rejects', async () => {
        const provider = providerWith(async () => { throw new Error('probe failed'); });
        setNativeArgon2id(provider);
        const params = await calibrateKdfParamsAsync({ memory: 8192, targetMs: 1 });
        expect(provider).toHaveBeenCalledTimes(2);
        expect(params.memory).toBe(8192);
        expect(params.iterations).toBeGreaterThanOrEqual(KDF_MIN_ITERATIONS);
    });
});
