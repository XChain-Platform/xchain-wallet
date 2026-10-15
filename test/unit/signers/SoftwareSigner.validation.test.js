// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

const PATH = "m/84'/0'/0'/0/0";

function makeSigner({ walletEncryption = {}, sdk = {} } = {}) {
    const signer = new SoftwareSigner({
        id: 'software-1',
        displayName: 'Software wallet',
        chainRegistry: { get: () => ({ wifVersionByte: 0x80 }) },
        walletEncryption,
        sdkRegistry: { get: () => sdk },
    });
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: new Uint8Array(64),
        importedWifs: new Map(),
        masterKey: null,
    });
    signer._resolveWifForEntry = vi.fn(() => 'test-wif');
    return signer;
}

describe('SoftwareSigner unlock validation', () => {
    it('requires a non-empty password before reading encrypted data', async () => {
        const signer = new SoftwareSigner({
            id: 'software-1', displayName: 'Software wallet', chainRegistry: {}, walletEncryption: {},
        });
        await expect(signer.unlock({ password: '' })).rejects.toThrow('password or masterKey is required');
    });

    it.each([
        [
            { format: 'bip39', passphraseEnabled: true, encryptedPassphrase: null },
            '',
            'bip39Passphrase is required',
        ],
        [
            { format: 'counterwallet-legacy' },
            'extra',
            'do not support a BIP39 passphrase',
        ],
        [
            { format: 'wif-only', importedKeys: [] },
            'extra',
            'do not accept a BIP39 passphrase',
        ],
        [
            { format: 'wif-only', importedKeys: [] },
            '',
            'has no importedKeys',
        ],
    ])('refuses incompatible wallet encryption input %#', async (walletEncryption, passphrase, message) => {
        const signer = new SoftwareSigner({
            id: 'software-1', displayName: 'Software wallet', chainRegistry: {}, walletEncryption,
        });
        await expect(signer.unlock({ password: 'pw', bip39Passphrase: passphrase }))
            .rejects.toThrow(message);
    });
});

describe('SoftwareSigner signing input validation', () => {
    it('requires at least one PSBT signing path', async () => {
        await expect(makeSigner().signPsbt({
            psbtHex: '00', chainId: 'bitcoin', signingPaths: [],
        })).rejects.toThrow('signingPaths must be non-empty');
    });

    it.each([
        [[{ inputIndex: 0, path: PATH }, { inputIndex: 1, path: "m/84'/0'/0'/0/1" }]],
        [[{ inputIndex: 0, path: PATH, addressId: 'imported-1' }]],
    ])('refuses multiple signing sources %#', async (signingPaths) => {
        await expect(makeSigner().signPsbt({
            psbtHex: '00', chainId: 'bitcoin', signingPaths,
        })).rejects.toThrow('multi-key signing not yet supported');
    });

    it.each([-1, 1.5, '0', undefined])('refuses input index %j', async (inputIndex) => {
        const signer = makeSigner();
        await expect(signer.signPsbt({
            psbtHex: '00',
            chainId: 'bitcoin',
            signingPaths: [{ inputIndex, path: PATH }],
        })).rejects.toThrow('non-negative integer inputIndex');
    });

    it.each([
        [{}, 'exactly one of'],
        [{ path: PATH, addressId: 'imported-1' }, 'exactly one of'],
        [{ path: "m/86'/0'/0'/0/0" }, 'p2tr message signing not supported'],
    ])('refuses invalid message key input %#', async (key, message) => {
        await expect(makeSigner().signMessage({
            message: 'hello', chainId: 'bitcoin', ...key,
        })).rejects.toThrow(message);
    });

    it('rejects a message SDK response without a signature string', async () => {
        const signer = makeSigner({ sdk: { auth: { signMessage: () => ({ signature: 7 }) } } });
        await expect(signer.signMessage({
            message: 'hello', chainId: 'bitcoin', path: PATH,
        })).rejects.toThrow('SDK returned no signature string');
    });

    it.each([
        [{ chainId: 'bitcoin', psbtHex: '', signingPaths: [{ path: PATH }] }, 'psbtHex is required'],
        [{ chainId: 'bitcoin', psbtHex: '00', signingPaths: [] }, 'signingPaths must be non-empty'],
    ])('validates multisig PSBT input %#', async (params, message) => {
        await expect(makeSigner().signMultisigPsbt(params)).rejects.toThrow(message);
    });

    it('reports unavailable multisig PSBT support before invoking the SDK', async () => {
        await expect(makeSigner({ sdk: { wallet: {} } }).signMultisigPsbt({
            chainId: 'bitcoin', psbtHex: '00', signingPaths: [{ path: PATH }],
        })).rejects.toThrow('signMultisigPsbt unavailable');
    });

    it.each([
        [{ chainId: 'bitcoin', path: PATH, msgHash: 'zz' }, 'msgHash must be 32-byte hex'],
        [{ chainId: 'bitcoin', path: 'invalid', msgHash: 'aa'.repeat(32) }, 'invalid path'],
    ])('validates classical multisig input %#', async (params, message) => {
        await expect(makeSigner().signMultisigClassical(params)).rejects.toThrow(message);
    });
});
