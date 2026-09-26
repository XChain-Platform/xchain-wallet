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
import { signMessageFlow, signPsbtFlow } from '../../../packages/core/src/flows/signFlows.js';
import {
    activatePanicMode,
    clearPanicModeState,
    PanicModeActiveError,
} from '../../../packages/core/src/flows/panicMode.js';

const vault = {};
const registries = { chainRegistry: {}, sdkRegistry: {} };
const chainId = 'bitcoin-regtest';
const signingPaths = [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }];

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
        });
        expect(signer.lock).not.toHaveBeenCalled();
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
