// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

function makeSigner(signMessage) {
    const signer = new SoftwareSigner({
        id: 'software-1',
        displayName: 'Software wallet',
        chainRegistry: { get: () => ({ wifVersionByte: 0x80 }) },
        walletEncryption: {},
        sdkRegistry: { get: () => ({ auth: { signMessage } }) },
    });
    signer._acceptUnlockedState({
        mnemonicBytes: new Uint8Array(0),
        seed: new Uint8Array(64),
        importedWifs: new Map(),
        masterKey: null,
    });
    signer._resolveWifForEntry = vi.fn(() => 'wif');
    return signer;
}

describe('SoftwareSigner message address type', () => {
    it.each([
        ['p2pkh', {}],
        ['p2sh-p2wpkh', { segwitRedeemScript: true }],
        ['p2wpkh', { segwitNative: true }],
    ])('uses the %s signature header on a legacy derivation path', async (addressType, opts) => {
        const signMessage = vi.fn(() => 'signature');
        const signer = makeSigner(signMessage);

        await signer.signMessage({
            message: 'hello',
            chainId: 'bitcoin-mainnet',
            path: "m/0'/0/1",
            addressType,
        });

        expect(signMessage).toHaveBeenCalledWith('hello', 'wif', opts);
    });

    it('uses the recorded type for an imported key', async () => {
        const signMessage = vi.fn(() => 'signature');
        const signer = makeSigner(signMessage);

        await signer.signMessage({
            message: 'hello',
            chainId: 'bitcoin-mainnet',
            addressId: 'address-1',
            addressType: 'p2wpkh',
        });

        expect(signMessage).toHaveBeenCalledWith(
            'hello', 'wif', { segwitNative: true },
        );
    });

    it.each(['p2tr', 'unknown'])('refuses the unsupported %s type', async (addressType) => {
        const signMessage = vi.fn(() => 'signature');
        const signer = makeSigner(signMessage);

        await expect(signer.signMessage({
            message: 'hello',
            chainId: 'bitcoin-mainnet',
            path: "m/0'/0/1",
            addressType,
        })).rejects.toThrow(/not supported|unsupported address type/);
        expect(signMessage).not.toHaveBeenCalled();
    });

    it('keeps purpose inference for callers without an address type', async () => {
        const signMessage = vi.fn(() => 'signature');
        const signer = makeSigner(signMessage);

        await signer.signMessage({
            message: 'hello',
            chainId: 'bitcoin-mainnet',
            path: "m/84'/0'/0'/0/0",
        });

        expect(signMessage).toHaveBeenCalledWith(
            'hello', 'wif', { segwitNative: true },
        );
    });
});
