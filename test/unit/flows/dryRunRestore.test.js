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
    validateCounterwalletMnemonic: vi.fn(),
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

function createHarness(addresses = [], accounts = [
    { id: 'acct-1', walletId: 'wallet-1', index: 0 },
], walletFormat = 'bip39') {
    const vault = {
        accounts: {
            findBy: vi.fn(async (field, value) => accounts.filter((a) => a[field] === value)),
        },
        addresses: { list: vi.fn().mockResolvedValue(addresses) },
        wallets: { get: vi.fn().mockResolvedValue({ id: 'wallet-1', format: walletFormat }) },
    };
    const descriptor = { id: 'bitcoin', coin: 'BTC', networkKind: 'mainnet', defaultAddressType: 'p2wpkh' };
    const chainRegistry = {
        supportedChains: vi.fn(() => [descriptor]),
        get: vi.fn(() => descriptor),
        derivationPathFor: vi.fn((_chainId, _type, _account, _change, index) => pathFor(index)),
    };
    const deriveAddress = vi.fn((publicKey, { type }) => `${type}-${publicKey}`);
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
    cryptoMocks.validateCounterwalletMnemonic.mockReturnValue({ ok: true });
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

it('defaults to the stored legacy format when the caller omits format', async () => {
    cryptoMocks.counterwalletMnemonicToSeedBytes.mockReturnValue(new Uint8Array([4, 5, 6]));
    const harness = createHarness([], undefined, 'counterwallet-legacy');

    const result = await restore(harness, { gapLimit: 1 });

    expect(result.perChain[0].addressType).toBe('p2pkh');
    expect(cryptoMocks.counterwalletMnemonicToSeedBytes).toHaveBeenCalledWith(MNEMONIC);
    expect(harness.chainRegistry.derivationPathFor.mock.calls[0][5])
        .toEqual({ format: 'counterwallet-legacy' });
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
});

it('rejects a caller format that disagrees with the stored wallet format', async () => {
    const harness = createHarness([], undefined, 'counterwallet-legacy');

    await expect(restore(harness, { format: 'bip39' }))
        .rejects.toThrow('requested format does not match the wallet format');
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
    expect(cryptoMocks.counterwalletMnemonicToSeedBytes).not.toHaveBeenCalled();
});

it('derives exactly the default count and reports stored-address comparisons', async () => {
    const addresses = [0, 2].map((index) => ({
        accountId: 'acct-1',
        address: index === 0 ? `p2wpkh-${pathFor(index)}` : 'different-address',
        addressType: 'p2wpkh',
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
        expected: `p2wpkh-${pathFor(0)}`,
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

it('ignores another wallet record that precedes the selected wallet match', async () => {
    const addresses = [
        {
            accountId: 'acct-2', address: 'other-wallet-address', addressType: 'p2wpkh',
            chain: 'BTC', network: 'mainnet', derivationPath: pathFor(0),
        },
        {
            accountId: 'acct-1', address: `p2wpkh-${pathFor(0)}`, addressType: 'p2wpkh',
            chain: 'BTC', network: 'mainnet', derivationPath: pathFor(0),
        },
    ];
    const accounts = [
        { id: 'acct-1', walletId: 'wallet-1', index: 0 },
        { id: 'acct-2', walletId: 'wallet-2', index: 0 },
    ];
    const harness = createHarness(addresses, accounts);

    const result = await restore(harness, { gapLimit: 1 });

    expect(result.overallMatch).toBe(true);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 1, divergentCount: 0 });
    expect(harness.vault.accounts.findBy).toHaveBeenCalledWith('walletId', 'wallet-1');
});

it('does not accept another wallet match for the selected wallet', async () => {
    const addresses = [
        {
            accountId: 'acct-2', address: `p2wpkh-${pathFor(0)}`, addressType: 'p2wpkh',
            chain: 'BTC', network: 'mainnet', derivationPath: pathFor(0),
        },
        {
            accountId: 'acct-1', address: 'selected-wallet-mismatch', addressType: 'p2wpkh',
            chain: 'BTC', network: 'mainnet', derivationPath: pathFor(0),
        },
    ];
    const accounts = [
        { id: 'acct-1', walletId: 'wallet-1', index: 0 },
        { id: 'acct-2', walletId: 'wallet-2', index: 0 },
    ];

    const result = await restore(createHarness(addresses, accounts), { gapLimit: 1 });

    expect(result.overallMatch).toBe(false);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 0, divergentCount: 1 });
});

it('fails closed when only another wallet has matching records', async () => {
    const addresses = [{
        accountId: 'acct-2', address: `p2wpkh-${pathFor(0)}`, addressType: 'p2wpkh',
        chain: 'BTC', network: 'mainnet', derivationPath: pathFor(0),
    }];
    const accounts = [
        { id: 'acct-1', walletId: 'wallet-1', index: 0 },
        { id: 'acct-2', walletId: 'wallet-2', index: 0 },
    ];

    const result = await restore(createHarness(addresses, accounts), { gapLimit: 1 });

    expect(result.overallMatch).toBe(false);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 0, missingCount: 1 });
});

it('verifies each legacy record in its own address type', async () => {
    cryptoMocks.counterwalletMnemonicToSeedBytes.mockReturnValue(new Uint8Array([4, 5, 6]));
    const legacyPath = (index) => `m/0'/0/${index}`;
    const addresses = [
        {
            accountId: 'acct-1', address: `p2pkh-${legacyPath(0)}`, addressType: 'p2pkh',
            chain: 'BTC', network: 'mainnet', derivationPath: legacyPath(0),
        },
        {
            accountId: 'acct-1', address: `p2wpkh-${legacyPath(1)}`, addressType: 'p2wpkh',
            chain: 'BTC', network: 'mainnet', derivationPath: legacyPath(1),
        },
    ];
    const harness = createHarness(addresses, undefined, 'counterwallet-legacy');
    harness.chainRegistry.derivationPathFor.mockImplementation(
        (_chainId, _type, _account, _change, index) => legacyPath(index),
    );

    const result = await restore(harness, { format: 'counterwallet-legacy', gapLimit: 2 });

    expect(result.overallMatch).toBe(true);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 2, divergentCount: 0, missingCount: 0 });
    expect(result.perChain[0].comparisons[1]).toEqual({
        index: 1,
        expected: `p2wpkh-${legacyPath(1)}`,
        derived: `p2wpkh-${legacyPath(1)}`,
        match: true,
    });
});

it('still reports divergence for the same legacy address type', async () => {
    cryptoMocks.counterwalletMnemonicToSeedBytes.mockReturnValue(new Uint8Array([4, 5, 6]));
    const legacyPath = `m/0'/0/0`;
    const addresses = [{
        accountId: 'acct-1', address: 'wrong-legacy-address', addressType: 'p2pkh',
        chain: 'BTC', network: 'mainnet', derivationPath: legacyPath,
    }];
    const harness = createHarness(addresses, undefined, 'counterwallet-legacy');
    harness.chainRegistry.derivationPathFor.mockReturnValue(legacyPath);

    const result = await restore(harness, { format: 'counterwallet-legacy', gapLimit: 1 });

    expect(result.overallMatch).toBe(false);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 0, divergentCount: 1 });
});

it('returns evidence instead of deriving a retired stored address type', async () => {
    cryptoMocks.counterwalletMnemonicToSeedBytes.mockReturnValue(new Uint8Array([4, 5, 6]));
    const legacyPath = (index) => `m/0'/0/${index}`;
    const expected = `p2pkh-${legacyPath(0)}`;
    const addresses = [
        {
            accountId: 'acct-1', address: expected, addressType: 'p2pkh',
            chain: 'BTC', network: 'mainnet', derivationPath: legacyPath(0),
        },
        {
            accountId: 'acct-1', address: 'retired-address', addressType: 'retired-type',
            chain: 'BTC', network: 'mainnet', derivationPath: legacyPath(1),
        },
    ];
    const harness = createHarness(addresses, undefined, 'counterwallet-legacy');
    harness.chainRegistry.derivationPathFor.mockImplementation(
        (_chainId, _type, _account, _change, index) => legacyPath(index),
    );
    harness.deriveAddress.mockImplementation((publicKey, { type }) => {
        if (type === 'retired-type') {
            const err = new Error('Unknown address type: "retired-type"');
            err.code = 'INVALID_ADDRESS_TYPE';
            throw err;
        }
        return `${type}-${publicKey}`;
    });

    expect(() => harness.deriveAddress('public-key', { type: 'retired-type' }))
        .toThrow(/Unknown address type/);
    const result = await restore(harness, { format: 'counterwallet-legacy', gapLimit: 2 });

    expect(result.overallMatch).toBe(true);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 1, divergentCount: 0, missingCount: 1 });
    expect(result.perChain[0].comparisons[1]).toEqual({
        index: 1, expected: null, derived: `p2pkh-${legacyPath(1)}`, match: false,
    });
});

it('accepts a legacy backup whose stored records are all nondefault types', async () => {
    cryptoMocks.counterwalletMnemonicToSeedBytes.mockReturnValue(new Uint8Array([4, 5, 6]));
    const legacyPath = (index) => `m/0'/0/${index}`;
    const addresses = [0, 1].map((index) => ({
        accountId: 'acct-1',
        address: `p2wpkh-${legacyPath(index)}`,
        addressType: 'p2wpkh',
        chain: 'BTC',
        network: 'mainnet',
        derivationPath: legacyPath(index),
    }));
    const harness = createHarness(addresses, undefined, 'counterwallet-legacy');
    harness.chainRegistry.derivationPathFor.mockImplementation(
        (_chainId, _type, _account, _change, index) => legacyPath(index),
    );

    const result = await restore(harness, { format: 'counterwallet-legacy', gapLimit: 2 });

    expect(result.overallMatch).toBe(true);
    expect(result.perChain[0]).toMatchObject({ matchedCount: 2, divergentCount: 0 });
});

it.each([
    ['word count', ['expected 12 words, got 11']],
    ['bad word', ['word 3 ("abandn") is not in the Counterwallet wordlist']],
])('passes through the Counterwallet %s validation reason', async (_label, errors) => {
    cryptoMocks.validateCounterwalletMnemonic.mockReturnValue({ ok: false, errors });

    const harness = createHarness([], undefined, 'counterwallet-legacy');
    const error = await restore(harness, { format: 'counterwallet-legacy' }).catch((e) => e);

    expect(error).toBeInstanceOf(InvalidMnemonicError);
    expect(error).toMatchObject({ format: 'counterwallet-legacy', errors });
    expect(cryptoMocks.counterwalletMnemonicToSeedBytes).not.toHaveBeenCalled();
});

it.each([0, 1001, 1.5])('rejects invalid gap limit %s', async (gapLimit) => {
    await expect(restore(createHarness(), { gapLimit }))
        .rejects.toThrow('gapLimit must be a positive integer ≤ 1000');
    expect(cryptoMocks.bip39MnemonicToSeed).not.toHaveBeenCalled();
});
