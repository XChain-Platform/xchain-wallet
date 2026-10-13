// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, expect, it, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
    bip39MnemonicToSeed: vi.fn(),
    derive: vi.fn(),
    hdKeyFromSeed: vi.fn(),
    isValidBip39Mnemonic: vi.fn(),
    zeroDerivedKey: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', () => ({
    ...cryptoMocks,
    COUNTERWALLET_DEFAULT_ADDRESS_TYPE: 'p2pkh',
    counterwalletMnemonicToSeedBytes: vi.fn(),
    isValidCounterwalletMnemonic: vi.fn(),
}));

import {
    DEFAULT_GAP_LIMIT,
    discoverUsedAddresses,
} from '../../../packages/core/src/flows/discoverUsedAddresses.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const descriptor = {
    id: 'bitcoin',
    defaultAddressType: 'p2wpkh',
    addressTypes: ['p2wpkh'],
};

function createHarness() {
    return {
        chainRegistry: {
            supportedChains: vi.fn(() => [descriptor]),
            get: vi.fn(() => descriptor),
            derivationPathFor: vi.fn((_chainId, _type, _account, _change, index) => (
                `m/84'/0'/0'/0/${index}`
            )),
        },
        sdkRegistry: {
            get: vi.fn(() => ({
                wallet: { deriveAddress: vi.fn((publicKey) => `address-${publicKey}`) },
            })),
        },
    };
}

function discover(overrides = {}) {
    return discoverUsedAddresses({
        ...createHarness(),
        mnemonic: MNEMONIC,
        ...overrides,
    });
}

let seed;

beforeEach(() => {
    vi.clearAllMocks();
    seed = new Uint8Array([1, 2, 3]);
    cryptoMocks.isValidBip39Mnemonic.mockReturnValue(true);
    cryptoMocks.bip39MnemonicToSeed.mockResolvedValue(seed);
    cryptoMocks.hdKeyFromSeed.mockReturnValue({ id: 'root' });
    cryptoMocks.derive.mockImplementation((_root, path) => ({ publicKeyHex: path }));
});

it('uses the BIP44 gap limit and reports progress and results plainly', async () => {
    expect(DEFAULT_GAP_LIMIT).toBe(20);
    const events = [];
    let probes = 0;

    const result = await discover({
        gapLimit: 2,
        isUsedProbe: vi.fn(async () => ({ used: probes++ === 0 })),
        onProgress: (event) => events.push(event),
    });

    expect(result).toMatchObject({ totalUsedFound: 1 });
    expect(result.perChain[0]).toMatchObject({
        chainId: 'bitcoin',
        addressType: 'p2wpkh',
        highestUsedIndex: 0,
        scannedCount: 3,
        incomplete: false,
        error: null,
    });
    expect(events.map((event) => event.phase)).toEqual([
        'chain-start',
        'scan-progress',
        'scan-progress',
        'scan-progress',
        'chain-complete',
    ]);
    expect(events.at(-1).data).toEqual({ highestUsedIndex: 0, scannedCount: 3 });
});

it('cancels a pending explorer probe promptly and clears seed material', async () => {
    const controller = new AbortController();
    const events = [];
    const scan = discover({
        signal: controller.signal,
        perQueryTimeoutMs: 60_000,
        isUsedProbe: vi.fn(() => {
            controller.abort();
            return new Promise(() => {});
        }),
        onProgress: (event) => events.push(event),
    });

    await expect(scan).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.map((event) => event.phase)).toEqual(['chain-start']);
    expect(seed).toEqual(new Uint8Array([0, 0, 0]));
});

it.each([0, 201, 1.5])('rejects invalid gap limit %s before deriving a seed', async (gapLimit) => {
    await expect(discover({ gapLimit }))
        .rejects.toThrow('gapLimit must be an integer in [1, 200]');
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
});

function chainHarness(chainIds) {
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

it('continues through the gap after a used address, honours account and change, and clears the seed', async () => {
    const used = [false, true, false, false];
    const onProgress = vi.fn();

    const result = await discover({
        ...chainHarness(['bitcoin-mainnet']),
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
    expect(seed).toEqual(new Uint8Array(3));
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

    const result = await discover({
        ...chainHarness(['bitcoin-mainnet']),
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
    const deps = chainHarness(['broken-mainnet', 'bitcoin-mainnet']);
    deps.sdkRegistry.get = (id) => {
        if (id === 'broken-mainnet') throw new Error('SDK unavailable');
        return { wallet: { deriveAddress: (key) => `address:${key}` } };
    };

    const result = await discover({
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
    expect(seed).toEqual(new Uint8Array(3));
});
