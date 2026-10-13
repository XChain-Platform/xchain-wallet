// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
    bip39MnemonicToSeed: vi.fn(),
    derive: vi.fn(),
    hdKeyFromSeed: vi.fn(),
    isValidBip39Mnemonic: vi.fn(),
    zeroDerivedKey: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    ...cryptoMocks,
}));

const { discoverUsedAddresses } = await import(
    '../../../packages/core/src/flows/discoverUsedAddresses.js'
);

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
let seed;

function harness(chainIds = ['bitcoin-mainnet']) {
    const descriptors = new Map(chainIds.map((id) => [id, {
        id,
        defaultAddressType: 'p2wpkh',
        addressTypes: ['p2wpkh'],
    }]));
    return {
        chainRegistry: {
            supportedChains: () => [...descriptors.values()],
            get: (id) => descriptors.get(id),
            derivationPathFor: (id, type, account, change, index) => (
                `${id}/${type}/${account}/${change}/${index}`
            ),
        },
        sdkRegistry: {
            get: (id) => ({ wallet: { deriveAddress: (key) => `${id}:${key}` } }),
        },
    };
}

beforeEach(() => {
    seed = new Uint8Array([9, 8, 7, 6]);
    cryptoMocks.bip39MnemonicToSeed.mockReset().mockResolvedValue(seed);
    cryptoMocks.isValidBip39Mnemonic.mockReset().mockReturnValue(true);
    cryptoMocks.hdKeyFromSeed.mockReset().mockReturnValue({ root: true });
    cryptoMocks.derive.mockReset().mockImplementation((_root, path) => ({
        publicKeyHex: `pub:${path}`,
    }));
    cryptoMocks.zeroDerivedKey.mockReset();
});

describe('discoverUsedAddresses', () => {
    it('continues through the gap after a used address and clears the seed', async () => {
        const used = [false, true, false, false];
        const onProgress = vi.fn();

        const result = await discoverUsedAddresses({
            mnemonic,
            ...harness(),
            gapLimit: 2,
            accountIndex: 3,
            change: 1,
            isUsedProbe: vi.fn(async () => ({ used: used.shift() })),
            onProgress,
        });

        expect(result.totalUsedFound).toBe(1);
        expect(result.perChain[0]).toMatchObject({
            highestUsedIndex: 1,
            scannedCount: 4,
            incomplete: false,
            error: null,
        });
        expect(result.perChain[0].addresses.map(({ index, path, used: wasUsed }) => ({
            index,
            path,
            used: wasUsed,
        }))).toEqual([
            { index: 0, path: 'bitcoin-mainnet/p2wpkh/3/1/0', used: false },
            { index: 1, path: 'bitcoin-mainnet/p2wpkh/3/1/1', used: true },
            { index: 2, path: 'bitcoin-mainnet/p2wpkh/3/1/2', used: false },
            { index: 3, path: 'bitcoin-mainnet/p2wpkh/3/1/3', used: false },
        ]);
        expect(cryptoMocks.zeroDerivedKey).toHaveBeenCalledTimes(4);
        expect(seed).toEqual(new Uint8Array(4));
        expect(onProgress.mock.calls.map(([event]) => event.phase)).toEqual([
            'chain-start',
            'scan-progress',
            'scan-progress',
            'scan-progress',
            'scan-progress',
            'chain-complete',
        ]);
    });

    it('records a failed probe as unknown without letting it satisfy the gap', async () => {
        const probe = vi.fn()
            .mockRejectedValueOnce(new Error('explorer unavailable'))
            .mockResolvedValue({ used: false });

        const result = await discoverUsedAddresses({
            mnemonic,
            ...harness(),
            gapLimit: 2,
            isUsedProbe: probe,
        });

        expect(result.perChain[0]).toMatchObject({
            scannedCount: 3,
            incomplete: false,
            error: 'probe failed for index 0: explorer unavailable',
        });
        expect(result.perChain[0].addresses.map(({ unknown }) => unknown))
            .toEqual([true, false, false]);
    });

    it('isolates a chain failure and scans the remaining chain', async () => {
        const deps = harness(['broken-mainnet', 'bitcoin-mainnet']);
        deps.sdkRegistry.get = (id) => {
            if (id === 'broken-mainnet') throw new Error('SDK unavailable');
            return { wallet: { deriveAddress: (key) => `address:${key}` } };
        };

        const result = await discoverUsedAddresses({
            mnemonic,
            ...deps,
            gapLimit: 1,
            isUsedProbe: async () => ({ used: false }),
        });

        expect(result.perChain).toHaveLength(2);
        expect(result.perChain[0]).toMatchObject({
            chainId: 'broken-mainnet',
            incomplete: true,
            scannedCount: 0,
            error: 'SDK unavailable',
        });
        expect(result.perChain[1]).toMatchObject({
            chainId: 'bitcoin-mainnet',
            incomplete: false,
            scannedCount: 1,
        });
        expect(seed).toEqual(new Uint8Array(4));
    });

    it('rejects an invalid gap limit before deriving a seed', async () => {
        await expect(discoverUsedAddresses({
            mnemonic,
            ...harness(),
            gapLimit: 0,
        })).rejects.toThrow(/gapLimit must be an integer/);

        expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
    });
});
