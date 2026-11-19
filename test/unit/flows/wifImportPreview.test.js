// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const crypto = vi.hoisted(() => ({
    deriveMasterKeyAsync: vi.fn(),
    encrypt: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        deriveMasterKeyAsync: crypto.deriveMasterKeyAsync,
        encrypt: crypto.encrypt,
    };
});

import sdkModule from 'xchain-sdk';
import { encodeWif } from '../../../packages/core/src/crypto/wif.js';
import { importSingleWif } from '../../../packages/core/src/flows/importSingleWif.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { wifImportPreview } from '../../../packages/core/src/shared/utils/wifImportPreview.js';

const { WalletUtils } = sdkModule;
const PRIVATE_KEY_ONE = Uint8Array.from([...new Uint8Array(31), 1]);
const KDF = Object.freeze({
    algorithm: 'argon2id', salt: 'salt', iterations: 1, memory: 8, parallelism: 1,
});

function vault() {
    return {
        wallets: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
            delete: vi.fn(async () => true),
        },
        addresses: {
            get: vi.fn(async () => null),
            put: vi.fn(async () => {}),
            delete: vi.fn(async () => true),
        },
    };
}

beforeEach(() => {
    crypto.deriveMasterKeyAsync.mockReset().mockResolvedValue(new Uint8Array(32).fill(7));
    crypto.encrypt.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
});

describe('wifImportPreview', () => {
    it.each([
        [
            'bitcoin-mainnet',
            'p2wpkh',
            'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        ],
        [
            'litecoin-mainnet',
            'p2sh-p2wpkh',
            'MR8UQSBr5ULwWheBHznrHk2jxyxkHQu8vB',
        ],
        [
            'dogecoin-mainnet',
            'p2pkh',
            'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE',
        ],
    ])('matches the address stored by importSingleWif for %s %s', async (
        chainId,
        addressType,
        expected,
    ) => {
        const descriptor = defaultRegistry().get(chainId);
        const wif = encodeWif(PRIVATE_KEY_ONE, descriptor.wifVersionByte);
        const wallet = new WalletUtils(chainId);
        const preview = wifImportPreview({ wif, descriptor, addressType });
        const result = await importSingleWif({
            vault: vault(),
            password: 'correct horse',
            chainRegistry: defaultRegistry(),
            sdkRegistry: { get: () => ({ wallet }) },
            chainId,
            wif,
            addressType,
            kdfParams: KDF,
        });

        expect(preview).toBe(expected);
        expect(result.address.address).toBe(preview);
    });

    it('returns null for incomplete, invalid and wrong-network keys', () => {
        const descriptor = defaultRegistry().get('bitcoin-mainnet');
        const litecoin = defaultRegistry().get('litecoin-mainnet');
        const litecoinWif = encodeWif(PRIVATE_KEY_ONE, litecoin.wifVersionByte);

        expect(wifImportPreview({ wif: '', descriptor, addressType: 'p2wpkh' })).toBeNull();
        expect(wifImportPreview({ wif: 'KwDiBf89', descriptor, addressType: 'p2wpkh' })).toBeNull();
        expect(wifImportPreview({ wif: 'not a key', descriptor, addressType: 'p2wpkh' })).toBeNull();
        expect(wifImportPreview({ wif: litecoinWif, descriptor, addressType: 'p2wpkh' })).toBeNull();
    });

    it('never previews a Taproot address, which the import cannot derive', () => {
        const descriptor = defaultRegistry().get('bitcoin-mainnet');
        const wif = encodeWif(PRIVATE_KEY_ONE, descriptor.wifVersionByte);
        expect(descriptor.addressTypes).toContain('p2tr');
        expect(wifImportPreview({ wif, descriptor, addressType: 'p2tr' })).toBeNull();
    });
});
