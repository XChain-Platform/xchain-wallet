// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for recoverGatedKeysForTick (PC-26 leg 2): the on-demand
// ECIES key-recovery scan that persists tick-matched pack keys into
// the vault's gatedKeys collection (source 'recovered') so they
// survive lock/restart and back the send guard + PC-34 migrate gate.

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
    recoverGatedKeysForTick,
    clearGatedContentCaches,
} from '../../../packages/core/src/flows/gatedContent.js';
import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';
import { gatedKeyId } from '../../../packages/core/src/schemas/gatedKey.js';

const KEY_A = Buffer.alloc(32, 3);
const HASH_A = createHash('sha256').update(KEY_A).digest('hex');
const KEY_B = Buffer.alloc(32, 4);
const HASH_B = createHash('sha256').update(KEY_B).digest('hex');
const KEY_OTHER = Buffer.alloc(32, 5); // valid key for some OTHER tick

function gatedRow(keyHash, actionIndex) {
    return { gate_ticker: 'GATED', key_hash: keyHash, action_index: actionIndex, name: 'f', encryption_method: 1 };
}

/**
 * @param {Record<string, Buffer[]>} keysByAddress  which keys each address's scan finds
 */
function makeSdk(keysByAddress, groups = [gatedRow(HASH_A, '100'), gatedRow(HASH_B, '200')]) {
    return {
        getFiles: vi.fn(async () => groups),
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
        },
    };
}

function makeVault() {
    const store = new Map();
    return {
        store,
        gatedKeys: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
        },
    };
}

function makeArgs(sdk, vault, addresses) {
    return {
        vault,
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        chainId: 'btc-regtest',
        tick: 'gated',
        addresses,
    };
}

const HD = (id) => ({ id, source: 'hd', derivationPath: `m/84'/1'/0'/0/${id}` });

beforeEach(() => {
    clearGatedContentCaches();
    vi.mocked(exportPrivateKey).mockClear();
});

describe('recoverGatedKeysForTick', () => {
    it('persists tick-matched keys with source recovered and reports the rest missing', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY_A, KEY_OTHER] });
        const vault = makeVault();
        const res = await recoverGatedKeysForTick(makeArgs(sdk, vault, [HD('a1')]));

        expect(res.recoveredKeyHashes).toEqual([HASH_A]);
        expect(res.stillMissingKeyHashes).toEqual([HASH_B]);
        expect(res.scannedAddresses).toBe(1);

        const row = vault.store.get(gatedKeyId({
            walletId: 'w1', chainId: 'btc-regtest', gateTicker: 'GATED', keyHash: HASH_A,
        }));
        expect(row).toBeTruthy();
        expect(row.source).toBe('recovered');
        expect(row.keyHex).toBe(KEY_A.toString('hex'));
        // The unrelated key must NOT be persisted (it cannot be attributed
        // to this tick).
        const persistedHexes = [...vault.store.values()].map((r) => r.keyHex);
        expect(persistedHexes).not.toContain(KEY_OTHER.toString('hex'));
    });

    it('scans further addresses until every wanted key is found, then stops', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY_A], 'addr-a2': [KEY_B], 'addr-a3': [KEY_A] });
        const vault = makeVault();
        const res = await recoverGatedKeysForTick(makeArgs(sdk, vault, [HD('a1'), HD('a2'), HD('a3')]));
        expect(res.recoveredKeyHashes.sort()).toEqual([HASH_A, HASH_B].sort());
        expect(res.stillMissingKeyHashes).toEqual([]);
        // a3 never scanned: everything was already found.
        expect(res.scannedAddresses).toBe(2);
        expect(sdk.getMessagesForAddress).toHaveBeenCalledTimes(2);
    });

    it('skips keys already verified in the vault (no rescan for them)', async () => {
        const sdk = makeSdk({ 'addr-a1': [KEY_B] }, [gatedRow(HASH_A, '100'), gatedRow(HASH_B, '200')]);
        const vault = makeVault();
        // HASH_A already stored and valid.
        const existing = {
            id: gatedKeyId({ walletId: 'w1', chainId: 'btc-regtest', gateTicker: 'GATED', keyHash: HASH_A }),
            keyHex: KEY_A.toString('hex'),
            keyHash: HASH_A,
            source: 'published',
        };
        vault.store.set(existing.id, existing);
        const res = await recoverGatedKeysForTick(makeArgs(sdk, vault, [HD('a1')]));
        expect(res.recoveredKeyHashes).toEqual([HASH_B]);
        expect(res.stillMissingKeyHashes).toEqual([]);
    });

    it('skips HW and watch-only addresses (their keys cannot run the scan)', async () => {
        const sdk = makeSdk({});
        const vault = makeVault();
        const res = await recoverGatedKeysForTick(makeArgs(sdk, vault, [
            { id: 't1', source: 'trezor' },
            { id: 'l1', source: 'ledger' },
            { id: 'w1', source: 'watch-only' },
        ]));
        expect(res.scannedAddresses).toBe(0);
        expect(exportPrivateKey).not.toHaveBeenCalled();
        expect(res.stillMissingKeyHashes.sort()).toEqual([HASH_A, HASH_B].sort());
    });

    it('propagates a wrong password instead of silently skipping every address', async () => {
        const sdk = makeSdk({});
        vi.mocked(exportPrivateKey).mockRejectedValueOnce(
            Object.assign(new Error('bad password'), { name: 'InvalidPasswordError' }),
        );
        await expect(
            recoverGatedKeysForTick(makeArgs(sdk, makeVault(), [HD('a1')])),
        ).rejects.toThrow(/bad password/);
    });

    it('returns empty for a tick with no active gated packs', async () => {
        const sdk = makeSdk({}, []);
        const res = await recoverGatedKeysForTick(makeArgs(sdk, makeVault(), [HD('a1')]));
        expect(res).toEqual({ recoveredKeyHashes: [], stillMissingKeyHashes: [], scannedAddresses: 0 });
        expect(exportPrivateKey).not.toHaveBeenCalled();
    });
});
