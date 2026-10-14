// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
    isValidBip39Mnemonic: vi.fn(),
    isValidCounterwalletMnemonic: vi.fn(),
    validateCounterwalletMnemonic: vi.fn(),
    persistHdWallet: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/mnemonic.js', () => ({
    BIP39_DEFAULT_STRENGTH_BITS: 128,
    generateBip39Mnemonic: mocks.generateBip39Mnemonic,
    isValidBip39Mnemonic: mocks.isValidBip39Mnemonic,
}));

vi.mock('../../../packages/core/src/crypto/counterwallet.js', () => ({
    isValidCounterwalletMnemonic: mocks.isValidCounterwalletMnemonic,
    validateCounterwalletMnemonic: mocks.validateCounterwalletMnemonic,
}));

vi.mock('../../../packages/core/src/flows/_persistHdWallet.js', () => ({
    persistHdWallet: mocks.persistHdWallet,
}));

import { createWallet } from '../../../packages/core/src/flows/createWallet.js';
import {
    detectMnemonicFormat,
    importMnemonic,
    InvalidMnemonicError,
    normalizeMnemonic,
    UnknownMnemonicFormatError,
} from '../../../packages/core/src/flows/importMnemonic.js';

const BIP39 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const LEGACY = 'like like like like like like like like like like like like';

function dependencies() {
    const descriptors = new Map([
        ['bitcoin-regtest', { networkKind: 'regtest' }],
        ['networkless', {}],
    ]);
    return {
        vault: {},
        chainRegistry: {
            has: vi.fn((id) => descriptors.has(id)),
            descriptorFor: vi.fn((id) => descriptors.get(id)),
        },
        sdkRegistry: {},
    };
}

function importArgs(overrides = {}) {
    return {
        ...dependencies(),
        password: 'wallet password',
        mnemonic: BIP39,
        activeChainIds: ['bitcoin-regtest'],
        ...overrides,
    };
}

beforeEach(() => {
    mocks.generateBip39Mnemonic.mockReset().mockReturnValue(BIP39);
    mocks.isValidBip39Mnemonic.mockReset().mockImplementation((value) => value === BIP39);
    mocks.isValidCounterwalletMnemonic.mockReset().mockImplementation((value) => value === LEGACY);
    mocks.validateCounterwalletMnemonic.mockReset().mockReturnValue({ ok: true, errors: [] });
    mocks.persistHdWallet.mockReset().mockResolvedValue({
        wallet: { id: 'wallet-1' }, account: { id: 'account-1' }, addresses: [],
    });
});

describe('createWallet edge branches', () => {
    it.each([
        [{ vault: null }, 'vault is required'],
        [{ chainRegistry: null }, 'chainRegistry is required'],
        [{ sdkRegistry: null }, 'sdkRegistry is required'],
        [{ activeChainIds: null }, 'activeChainIds must be a non-empty array'],
    ])('rejects a missing dependency before generating a mnemonic %#', async (override, message) => {
        await expect(createWallet({
            ...dependencies(), password: 'wallet password', activeChainIds: ['bitcoin-regtest'], ...override,
        })).rejects.toThrow(message);
        expect(mocks.generateBip39Mnemonic).not.toHaveBeenCalled();
    });

    it('uses defaults and tolerates a descriptor without a network fallback', async () => {
        await createWallet({
            ...dependencies(), password: 'wallet password', activeChainIds: ['networkless'],
        });

        expect(mocks.generateBip39Mnemonic).toHaveBeenCalledWith(128);
        expect(mocks.persistHdWallet).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Main Wallet',
            passphraseEnabled: false,
            activeNetwork: undefined,
        }));
    });
});

describe('importMnemonic edge branches', () => {
    it('normalizes pasted input and maps non-string input to empty text', () => {
        expect(normalizeMnemonic('  ABANDON\n\tabout  ')).toBe('abandon about');
        expect(normalizeMnemonic(null)).toBe('');
    });

    it('detects BIP39 first, then the legacy fallback, then no format', () => {
        expect(detectMnemonicFormat(BIP39)).toBe('bip39');
        expect(mocks.isValidCounterwalletMnemonic).not.toHaveBeenCalled();
        expect(detectMnemonicFormat(LEGACY)).toBe('counterwallet-legacy');
        expect(detectMnemonicFormat('not a phrase')).toBeNull();
    });

    it.each([
        [{ password: '' }, 'password is required'],
        [{ vault: null }, 'vault is required'],
        [{ chainRegistry: null }, 'chainRegistry is required'],
        [{ sdkRegistry: null }, 'sdkRegistry is required'],
        [{ activeChainIds: null }, 'activeChainIds must be a non-empty array'],
        [{ mnemonic: null }, 'mnemonic is required'],
        [{ activeChainIds: ['unknown'] }, 'unknown chain "unknown"'],
    ])('rejects invalid input before persistence %#', async (override, message) => {
        await expect(importMnemonic(importArgs(override))).rejects.toThrow(message);
        expect(mocks.persistHdWallet).not.toHaveBeenCalled();
    });

    it('reports explicit BIP39 validation details', async () => {
        mocks.isValidBip39Mnemonic.mockReturnValue(false);
        const error = await importMnemonic(importArgs({ format: 'bip39' })).catch((caught) => caught);

        expect(error).toBeInstanceOf(InvalidMnemonicError);
        expect(error).toMatchObject({
            format: 'bip39', errors: ['not a valid BIP39 mnemonic'],
        });
    });

    it('preserves all explicit legacy validation errors', async () => {
        mocks.validateCounterwalletMnemonic.mockReturnValue({
            ok: false, errors: ['wrong word count', 'unknown word'],
        });
        const error = await importMnemonic(importArgs({
            mnemonic: LEGACY, format: 'counterwallet-legacy',
        })).catch((caught) => caught);

        expect(error).toBeInstanceOf(InvalidMnemonicError);
        expect(error).toMatchObject({
            format: 'counterwallet-legacy', errors: ['wrong word count', 'unknown word'],
        });
    });

    it('rejects unsupported and undetectable formats without persistence', async () => {
        await expect(importMnemonic(importArgs({ format: 'brainwallet' })))
            .rejects.toThrow('unsupported format "brainwallet"');
        await expect(importMnemonic(importArgs({ mnemonic: 'not a phrase' })))
            .rejects.toBeInstanceOf(UnknownMnemonicFormatError);
        expect(mocks.persistHdWallet).not.toHaveBeenCalled();
    });

    it('rejects a BIP39 passphrase on a legacy wallet', async () => {
        await expect(importMnemonic(importArgs({
            mnemonic: LEGACY,
            format: 'counterwallet-legacy',
            bip39Passphrase: 'extra secret',
        }))).rejects.toThrow('do not support a BIP39 passphrase');
        expect(mocks.persistHdWallet).not.toHaveBeenCalled();
    });

    it('auto-detects legacy input and applies its origin and network defaults', async () => {
        const result = await importMnemonic(importArgs({
            mnemonic: `  ${LEGACY.toUpperCase()}\n`,
        }));

        expect(mocks.persistHdWallet).toHaveBeenCalledWith(expect.objectContaining({
            mnemonic: LEGACY,
            format: 'counterwallet-legacy',
            origin: 'imported-freewallet',
            passphraseEnabled: false,
            activeNetwork: 'regtest',
        }));
        expect(result.format).toBe('counterwallet-legacy');
    });
});
