// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
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
    counterwalletMnemonicToSeedBytes: vi.fn(),
    derive: vi.fn(),
    hdKeyFromSeed: vi.fn(),
    isValidBip39Mnemonic: vi.fn(),
    isValidCounterwalletMnemonic: vi.fn(),
    zeroDerivedKey: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/index.js', () => ({
    ...cryptoMocks,
    COUNTERWALLET_DEFAULT_ADDRESS_TYPE: 'p2pkh',
}));

import {
    DEFAULT_DRY_RUN_GAP,
    dryRunRestore,
} from '../../../packages/core/src/flows/dryRunRestore.js';
import { InvalidMnemonicError } from '../../../packages/core/src/flows/importMnemonic.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function pathFor(index) {
    return `m/44'/0'/0'/0/${index}`;
}

function createHarness(addresses = []) {
    const vault = { addresses: { list: vi.fn().mockResolvedValue(addresses) } };
    const descriptor = { id: 'bitcoin', coin: 'BTC', networkKind: 'mainnet', defaultAddressType: 'p2wpkh' };
    const chainRegistry = {
        supportedChains: vi.fn(() => [descriptor]),
        get: vi.fn(() => descriptor),
        derivationPathFor: vi.fn((_chainId, _type, _account, _change, index) => pathFor(index)),
    };
    const deriveAddress = vi.fn((publicKey) => `address-${publicKey}`);
    const sdkRegistry = { get: vi.fn(() => ({ wallet: { deriveAddress } })) };
    return { vault, chainRegistry, sdkRegistry, deriveAddress };
}

async function restore(harness, overrides = {}) {
    return dryRunRestore({
        ...harness,
        walletId: 'wallet-1',
        mnemonic: MNEMONIC,
        ...overrides,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    cryptoMocks.isValidBip39Mnemonic.mockReturnValue(true);
    cryptoMocks.bip39MnemonicToSeed.mockResolvedValue(new Uint8Array([1, 2, 3]));
    cryptoMocks.hdKeyFromSeed.mockReturnValue({ id: 'root' });
    cryptoMocks.derive.mockImplementation((_root, path) => ({ publicKeyHex: path }));
});

it('exports a default scan gap of ten addresses', () => {
    expect(DEFAULT_DRY_RUN_GAP).toBe(10);
});

it('rejects an invalid BIP39 mnemonic with InvalidMnemonicError', async () => {
    cryptoMocks.isValidBip39Mnemonic.mockReturnValue(false);

    await expect(restore(createHarness())).rejects.toBeInstanceOf(InvalidMnemonicError);
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
});

it('derives exactly the default count and reports stored-address comparisons', async () => {
    const addresses = [0, 2].map((index) => ({
        address: index === 0 ? `address-${pathFor(index)}` : 'different-address',
        chain: 'BTC',
        network: 'mainnet',
        derivationPath: pathFor(index),
    }));
    const harness = createHarness(addresses);

    const result = await restore(harness);

    expect(result.overallMatch).toBe(false);
    expect(result.perChain).toHaveLength(1);
    expect(result.perChain[0]).toMatchObject({
        chainId: 'bitcoin',
        addressType: 'p2wpkh',
        matchedCount: 1,
        divergentCount: 1,
        missingCount: DEFAULT_DRY_RUN_GAP - 2,
    });
    expect(result.perChain[0].comparisons[0]).toMatchObject({
        index: 0,
        expected: `address-${pathFor(0)}`,
        match: true,
    });
    expect(result.perChain[0].comparisons[2]).toMatchObject({
        index: 2,
        expected: 'different-address',
        match: false,
    });
    expect(result.perChain[0].derived).toHaveLength(DEFAULT_DRY_RUN_GAP);
    expect(result.perChain[0].derived.at(-1).index).toBe(DEFAULT_DRY_RUN_GAP - 1);
    expect(harness.chainRegistry.derivationPathFor).toHaveBeenCalledTimes(DEFAULT_DRY_RUN_GAP);
    expect(harness.deriveAddress).toHaveBeenCalledTimes(DEFAULT_DRY_RUN_GAP);
    expect(cryptoMocks.zeroDerivedKey).toHaveBeenCalledTimes(DEFAULT_DRY_RUN_GAP);
});

it('uses a custom gap instead of the default', async () => {
    const harness = createHarness();

    const result = await restore(harness, { gapLimit: 3 });

    expect(result.perChain[0].derived).toHaveLength(3);
    expect(result.perChain[0].missingCount).toBe(3);
    expect(harness.chainRegistry.derivationPathFor).toHaveBeenCalledTimes(3);
    expect(harness.deriveAddress).toHaveBeenCalledTimes(3);
});

it.each([0, 1001, 1.5])('rejects invalid gap limit %s', async (gapLimit) => {
    await expect(restore(createHarness(), { gapLimit }))
        .rejects.toThrow('gapLimit must be a positive integer ≤ 1000');
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
});
