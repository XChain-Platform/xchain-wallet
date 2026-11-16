// @vitest-environment node
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { resolveGatedPackKey } from '../../../packages/core/src/flows/gatedPackKey.js';
import { createGatedKey, gatedKeyId, validateGatedKey } from '../../../packages/core/src/schemas/gatedKey.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
const BASE = Object.freeze({ walletId: 'wallet-1', chainId: 'bitcoin-regtest', gateTicker: 'gate' });

function emptyVault(record) {
    return {
        gatedKeys: {
            get: vi.fn(async () => record),
            put: vi.fn(),
        },
    };
}

function generatedRecord() {
    const generated = sdk.gatedFile.generateKey();
    return {
        generated,
        record: createGatedKey({
            ...BASE,
            keyHash: generated.keyHash,
            keyHex: Buffer.from(generated.key).toString('hex'),
            source: 'published',
        }),
    };
}

async function expectInputRefusal(patch, field) {
    const calls = {
        get: vi.fn(),
        put: vi.fn(),
        generateKey: vi.fn(),
        verifyKey: vi.fn(),
    };
    const input = {
        ...BASE,
        sdk: { gatedFile: { generateKey: calls.generateKey, verifyKey: calls.verifyKey } },
        vault: { gatedKeys: { get: calls.get, put: calls.put } },
        ...patch,
    };
    await expect(resolveGatedPackKey(input)).rejects.toMatchObject({
        code: 'GATED_PACK_KEY_INPUT_INVALID',
        message: expect.stringContaining(field),
    });
    expect(Object.values(calls).every((call) => call.mock.calls.length === 0)).toBe(true);
}

describe('resolveGatedPackKey generated keys', () => {
    it('returns a copied SDK key and a valid record without writing the vault', async () => {
        const freshSdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false });
        const generateKey = vi.spyOn(freshSdk.gatedFile, 'generateKey');
        const vault = emptyVault();
        const result = await resolveGatedPackKey({ ...BASE, sdk: freshSdk, vault });

        expect(generateKey).toHaveBeenCalledOnce();
        expect(result.key).toBeInstanceOf(Uint8Array);
        expect(result.key).toHaveLength(32);
        expect(result.key).not.toBe(generateKey.mock.results[0].value.key);
        expect(result.keyHash).toMatch(/^[0-9a-f]{64}$/);
        expect(freshSdk.gatedFile.verifyKey(result.key, result.keyHash)).toBe(true);
        expect(result.generatedKey).toMatchObject({ ...BASE, gateTicker: 'GATE', source: 'published' });
        expect(validateGatedKey(result.generatedKey).ok).toBe(true);
        expect(vault.gatedKeys.get).not.toHaveBeenCalled();
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });
});

describe('resolveGatedPackKey stored keys', () => {
    it('reads once, verifies, and returns the same key bytes without writing', async () => {
        const { generated, record } = generatedRecord();
        const vault = emptyVault(record);
        const result = await resolveGatedPackKey({ ...BASE, sdk, vault, existingKeyHash: record.keyHash });

        expect(vault.gatedKeys.get).toHaveBeenCalledOnce();
        expect(vault.gatedKeys.get).toHaveBeenCalledWith(gatedKeyId(record));
        expect(result).toMatchObject({ keyHash: record.keyHash, generatedKey: null });
        expect(result.key).toBeInstanceOf(Uint8Array);
        expect(result.key).toHaveLength(32);
        expect(result.key).not.toBe(generated.key);
        expect(Array.from(result.key)).toEqual(Array.from(generated.key));
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });
});

describe('resolveGatedPackKey missing stored keys', () => {
    it('refuses a missing record after exactly one read', async () => {
        const vault = emptyVault(undefined);
        const existingKeyHash = 'a'.repeat(64);

        await expect(resolveGatedPackKey({ ...BASE, sdk, vault, existingKeyHash }))
            .rejects.toMatchObject({ code: 'GATED_PACK_KEY_MISSING' });
        expect(vault.gatedKeys.get).toHaveBeenCalledOnce();
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });
});

describe('resolveGatedPackKey mismatched stored keys', () => {
    it('refuses key bytes that do not match the stored hash', async () => {
        const { record } = generatedRecord();
        const corrupt = Object.freeze({ ...record, keyHex: '00'.repeat(32) });
        const vault = emptyVault(corrupt);

        await expect(resolveGatedPackKey({ ...BASE, sdk, vault, existingKeyHash: record.keyHash }))
            .rejects.toMatchObject({ code: 'GATED_PACK_KEY_HASH_MISMATCH' });
        expect(vault.gatedKeys.get).toHaveBeenCalledOnce();
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });
});

describe('resolveGatedPackKey input refusals', () => {
    it.each([
        [{ walletId: '' }, 'walletId'],
        [{ chainId: '   ' }, 'chainId'],
        [{ gateTicker: null }, 'gateTicker'],
        [{ existingKeyHash: null }, 'existingKeyHash'],
        [{ existingKeyHash: 'A'.repeat(64) }, 'existingKeyHash'],
        [{ existingKeyHash: 'a'.repeat(63) }, 'existingKeyHash'],
        [{ existingKeyHash: 'a'.repeat(64), vault: {} }, 'vault.gatedKeys.get'],
    ])('refuses invalid %s before any vault or SDK call', async (patch, field) => {
        await expectInputRefusal(patch, field);
    });
});

describe('resolveGatedPackKey input ownership', () => {
    it('does not mutate input while generating a key', async () => {
        const vault = emptyVault();
        const input = Object.freeze({ ...BASE, sdk, vault });

        await resolveGatedPackKey(input);

        expect(input).toEqual({ ...BASE, sdk, vault });
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });

    it('does not mutate its input or a stored vault record', async () => {
        const { record } = generatedRecord();
        const frozenRecord = Object.freeze({ ...record });
        const vault = emptyVault(frozenRecord);
        const input = Object.freeze({ ...BASE, sdk, vault, existingKeyHash: record.keyHash });
        const before = JSON.stringify(frozenRecord);

        await resolveGatedPackKey(input);

        expect(input).toEqual({ ...BASE, sdk, vault, existingKeyHash: record.keyHash });
        expect(JSON.stringify(frozenRecord)).toBe(before);
        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });
});
