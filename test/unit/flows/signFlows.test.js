// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: signMessageFlow / signPsbtFlow (§30.1, §30.4). Both flows are
// thin wrappers around an injected signer plus the §26.5 panic-mode
// freeze; the software-unlock path (unlockWallet + KDF) is covered
// elsewhere, so this drives the injected-signer branch both flows share
// with the air-gapped/hardware callers.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    signMessageFlow,
    signSignInChallengeFlow,
    signPsbtFlow,
} from '../../../packages/core/src/flows/signFlows.js';
import { formatSignInChallenge } from '../../../packages/connect/src/runtime.js';
import {
    activatePanicMode,
    clearPanicModeState,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';

const vault = {};
const registries = { chainRegistry: {}, sdkRegistry: {} };
const chainId = 'bitcoin-regtest';
const signingPaths = [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }];
const signInChallenge = formatSignInChallenge({
    version: 2,
    appId: 'example-app',
    origin: 'https://example.test',
    address: 'bcrt1qexample',
    nonce: 'nonce-1',
    timestamp: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
});

function mockSigner() {
    return {
        signMessage: vi.fn(async () => ({ signature: 'signed-message' })),
        signPsbt: vi.fn(async () => ({
            signedPsbtHex: 'signed-psbt',
            txHex: 'transaction',
            txid: 'transaction-id',
        })),
        lock: vi.fn(),
    };
}

afterEach(() => clearPanicModeState());

describe('signMessageFlow', () => {
    it('hands message signing to the injected signer and leaves its lifecycle to the caller', async () => {
        const signer = mockSigner();

        await expect(signMessageFlow({
            vault,
            walletId: 'wallet-1',
            chainId,
            path: "m/84'/0'/0'/0/0",
            message: 'hello',
            signer,
            ...registries,
        })).resolves.toEqual({ signature: 'signed-message' });

        expect(signer.signMessage).toHaveBeenCalledWith({
            message: 'hello',
            chainId,
            path: "m/84'/0'/0'/0/0",
            addressId: undefined,
            addressType: undefined,
        });
        expect(signer.lock).not.toHaveBeenCalled();
    });

    it.each([
        ['a null', 'a\u0000b'],
        ['an escape', 'x\u001b[2Jy'],
        ['a carriage return', 'line\rover'],
        ['an unpaired surrogate', 'a\ud800b'],
    ])('refuses a message with %s before the signer is called', async (_name, message) => {
        const signer = mockSigner();

        await expect(signMessageFlow({
            vault, walletId: 'wallet-1', chainId, path: "m/84'/0'/0'/0/0", message, signer, ...registries,
        })).rejects.toThrow(/control characters/);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['a musical beam control', 'pay\u{1D173} 1 unit'],
        ['a Mongolian variation selector', 'pay᠋ 1 unit'],
        ['a Syriac abbreviation mark', 'pay܏ 1 unit'],
    ])('refuses a message with %s as deceptive before the signer is called', async (_name, message) => {
        const signer = mockSigner();

        await expect(signMessageFlow({
            vault, walletId: 'wallet-1', chainId, path: "m/84'/0'/0'/0/0", message, signer, ...registries,
        })).rejects.toThrow(/deceptive characters/);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });

    it('signs a message with tabs, line feeds and paired surrogates', async () => {
        const signer = mockSigner();

        await signMessageFlow({
            vault, walletId: 'wallet-1', chainId, path: "m/84'/0'/0'/0/0", message: 'a\tb\nc 🚀', signer, ...registries,
        });
        expect(signer.signMessage).toHaveBeenCalledTimes(1);
    });

    it('forwards the address record type to the signer', async () => {
        const signer = mockSigner();

        await signMessageFlow({
            vault,
            walletId: 'wallet-1',
            chainId,
            path: "m/0'/0/1",
            addressType: 'p2wpkh',
            message: 'hello',
            signer,
            ...registries,
        });

        expect(signer.signMessage).toHaveBeenCalledWith(expect.objectContaining({
            path: "m/0'/0/1",
            addressType: 'p2wpkh',
        }));
    });

    it('still refuses a valid v2 sign-in challenge before the signer is called', async () => {
        const signer = mockSigner();

        await expect(signMessageFlow({
            vault, walletId: 'wallet-1', chainId, path: "m/84'/0'/0'/0/0",
            message: signInChallenge, signer, ...registries,
        })).rejects.toThrow(/cannot be signed as arbitrary messages/);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });

    it('refuses to sign in panic mode without calling the signer', async () => {
        const signer = mockSigner();
        activatePanicMode();

        await expect(signMessageFlow({
            vault,
            walletId: 'wallet-1',
            chainId,
            addressId: 'address-1',
            message: 'hello',
            signer,
            ...registries,
        })).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });
});

describe('signSignInChallengeFlow', () => {
    it.each([
        ['an arbitrary message', 'hello'],
        ['a v1-shaped challenge', 'XChain Sign-In | app | bcrt1qexample | nonce | 1700000000000 | 1700000060000'],
    ])('refuses %s before the signer is called', async (_label, message) => {
        const signer = mockSigner();

        await expect(signSignInChallengeFlow({
            vault, walletId: 'wallet-1', chainId, path: "m/84'/0'/0'/0/0",
            message, signer, ...registries,
        })).rejects.toThrow(/valid v2 sign-in challenge/);
        expect(signer.signMessage).not.toHaveBeenCalled();
    });
});

describe('signPsbtFlow', () => {
    it('hands PSBT signing to the injected signer and leaves its lifecycle to the caller', async () => {
        const signer = mockSigner();

        await expect(signPsbtFlow({
            vault,
            walletId: 'wallet-1',
            chainId,
            psbtHex: 'deadbeef',
            signingPaths,
            signer,
            ...registries,
        })).resolves.toEqual({
            signedPsbtHex: 'signed-psbt',
            txHex: 'transaction',
            txid: 'transaction-id',
        });

        expect(signer.signPsbt).toHaveBeenCalledWith({
            psbtHex: 'deadbeef',
            chainId,
            signingPaths,
        });
        expect(signer.lock).not.toHaveBeenCalled();
    });

    it('refuses to sign in panic mode without calling the signer', async () => {
        const signer = mockSigner();
        activatePanicMode();

        await expect(signPsbtFlow({
            vault,
            walletId: 'wallet-1',
            chainId,
            psbtHex: 'deadbeef',
            signingPaths,
            signer,
            ...registries,
        })).rejects.toBeInstanceOf(PanicModeActiveError);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });
});
