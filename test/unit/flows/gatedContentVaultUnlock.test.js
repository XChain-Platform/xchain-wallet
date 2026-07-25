// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the PC-27 vault-backed holder key cache in
// unlockGatedFileForAddress: vault-first unlock (no password, no WIF
// export, no MESSAGE scan when a verified gatedKeys row exists) and
// the write-back that persists a scan-recovered key so the NEXT
// unlock takes the vault path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../../../packages/core/src/flows/exportPrivateKey.js', () => ({
    exportPrivateKey: vi.fn(async ({ addressId }) => ({
        wif: `WIF-${addressId}`,
        address: `addr-${addressId}`,
        chainId: 'btc-regtest',
    })),
}));

import {
    unlockGatedFileForAddress,
    clearGatedContentCaches,
} from '../../../packages/core/src/flows/gatedContent.js';
import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';
import { gatedKeyId, createGatedKey } from '../../../packages/core/src/schemas/gatedKey.js';

const KEY = Buffer.alloc(32, 7);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const CIPHERTEXT = Buffer.from('ciphertext-bytes');
const PLAINTEXT = Buffer.from('plain-bytes');

/**
 * @param {Record<string, Buffer[]>} keysByAddress  keys each address's MESSAGE scan yields
 */
function makeSdk(keysByAddress = {}) {
    return {
        getGatedFileRaw: vi.fn(async () => CIPHERTEXT),
        getMessagesForAddress: vi.fn(async (address) => {
            const keys = keysByAddress[address] || [];
            return keys.map((k) => ({ bytes: Buffer.concat([Buffer.from([0x01]), k]) }));
        }),
        gatedFile: {
            verifyKey: vi.fn((key, hash) => createHash('sha256').update(key).digest('hex') === String(hash).toLowerCase()),
            parseKeyPayload: vi.fn((bytes) => {
                if (bytes[0] !== 0x01) throw new Error('bad payload');
                const out = [];
                for (let i = 1; i + 32 <= bytes.length; i += 32) out.push(Buffer.from(bytes.subarray(i, i + 32)));
                return out;
            }),
            decryptFileBytes: vi.fn((ciphertext, key) => {
                if (!ciphertext.equals(CIPHERTEXT) || !key.equals(KEY)) throw new Error('decrypt failed');
                return new Uint8Array(PLAINTEXT);
            }),
        },
    };
}

function makeVault(rows = []) {
    const store = new Map();
    for (const r of rows) store.set(r.id, r);
    return {
        store,
        gatedKeys: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
        },
    };
}

const ROW_ID_INPUT = {
    walletId: 'w1', chainId: 'btc-regtest', gateTicker: 'GATED', keyHash: KEY_HASH,
};

function makeArgs(sdk, vault, extra = {}) {
    return {
        vault,
        walletId: 'w1',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        actionIndex: '4200',
        keyHash: KEY_HASH,
        gateTicker: 'GATED',
        chainId: 'btc-regtest',
        ...extra,
    };
}

beforeEach(() => {
    clearGatedContentCaches();
    vi.mocked(exportPrivateKey).mockClear();
});

describe('unlockGatedFileForAddress vault-first path', () => {
    it('unlocks from a verified vault row with no password and no WIF export', async () => {
        const sdk = makeSdk();
        const vault = makeVault([createGatedKey({
            ...ROW_ID_INPUT, keyHex: KEY.toString('hex'), source: 'published',
        })]);

        const res = await unlockGatedFileForAddress(makeArgs(sdk, vault));

        expect(res.plaintextBase64).toBe(PLAINTEXT.toString('base64'));
        expect(res.byteLength).toBe(PLAINTEXT.length);
        expect(res.chainId).toBe('btc-regtest');
        expect(exportPrivateKey).not.toHaveBeenCalled();
        expect(sdk.getMessagesForAddress).not.toHaveBeenCalled();
    });

    it('caches the vault-path plaintext per wallet: second unlock skips the explorer fetch', async () => {
        const sdk = makeSdk();
        const vault = makeVault([createGatedKey({
            ...ROW_ID_INPUT, keyHex: KEY.toString('hex'), source: 'published',
        })]);

        await unlockGatedFileForAddress(makeArgs(sdk, vault));
        await unlockGatedFileForAddress(makeArgs(sdk, vault));
        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(1);
    });

    it('ignores a corrupted vault row (hash mismatch) and falls back to the WIF scan', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY] });
        const corrupt = createGatedKey({
            ...ROW_ID_INPUT, keyHex: Buffer.alloc(32, 9).toString('hex'), source: 'published',
        });
        const vault = makeVault([corrupt]);

        const res = await unlockGatedFileForAddress(makeArgs(sdk, vault, {
            password: 'pw', addressId: 'a1',
        }));

        expect(res.plaintextBase64).toBe(PLAINTEXT.toString('base64'));
        expect(exportPrivateKey).toHaveBeenCalledTimes(1);
    });

    it('surfaces GATED_FILE_NOT_FOUND when the explorer has no ciphertext', async () => {
        const sdk = makeSdk();
        sdk.getGatedFileRaw = vi.fn(async () => null);
        const vault = makeVault([createGatedKey({
            ...ROW_ID_INPUT, keyHex: KEY.toString('hex'), source: 'published',
        })]);

        await expect(unlockGatedFileForAddress(makeArgs(sdk, vault)))
            .rejects.toMatchObject({ code: 'GATED_FILE_NOT_FOUND' });
    });
});

describe('unlockGatedFileForAddress write-back', () => {
    it('persists the scan-recovered key as source recovered, and the next unlock takes the vault path', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY] });
        const vault = makeVault();

        await unlockGatedFileForAddress(makeArgs(sdk, vault, {
            password: 'pw', addressId: 'a1',
        }));

        const row = vault.store.get(gatedKeyId(ROW_ID_INPUT));
        expect(row).toBeTruthy();
        expect(row.source).toBe('recovered');
        expect(row.keyHex).toBe(KEY.toString('hex'));

        // Second unlock (fresh in-memory caches, no password): vault path.
        clearGatedContentCaches();
        vi.mocked(exportPrivateKey).mockClear();
        const res = await unlockGatedFileForAddress(makeArgs(sdk, vault));
        expect(res.plaintextBase64).toBe(PLAINTEXT.toString('base64'));
        expect(exportPrivateKey).not.toHaveBeenCalled();
    });

    it('does not write the vault without a gateTicker (key cannot be attributed)', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY] });
        const vault = makeVault();

        await unlockGatedFileForAddress(makeArgs(sdk, vault, {
            password: 'pw', addressId: 'a1', gateTicker: undefined,
        }));

        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
    });

    it('does not overwrite an existing vault row', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY] });
        const existing = createGatedKey({
            ...ROW_ID_INPUT, keyHex: KEY.toString('hex'), source: 'published',
        });
        const vault = makeVault([existing]);
        // Force the WIF path despite the valid row: no gateTicker/chainId
        // pair on the first call simulates an older caller.
        await unlockGatedFileForAddress(makeArgs(sdk, vault, {
            password: 'pw', addressId: 'a1', chainId: undefined,
        }));

        expect(vault.gatedKeys.put).not.toHaveBeenCalled();
        expect(vault.store.get(existing.id).source).toBe('published');
    });

    it('a failing vault write never fails an unlock that already succeeded', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY] });
        const vault = makeVault();
        vault.gatedKeys.put = vi.fn(async () => { throw new Error('disk full'); });

        const res = await unlockGatedFileForAddress(makeArgs(sdk, vault, {
            password: 'pw', addressId: 'a1',
        }));
        expect(res.plaintextBase64).toBe(PLAINTEXT.toString('base64'));
    });
});
