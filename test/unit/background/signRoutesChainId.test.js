// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const CHAIN_ID = 'bitcoin-regtest';
const PATH = "m/84'/1'/0'/0/0";
const ADDRESS = 'bcrt1qsigningaddress';

const addressRecord = (network = 'regtest') => ({
    id: 'addr-1',
    accountId: 'account-1',
    chain: 'bitcoin',
    network,
    source: 'hd',
    derivationPath: PATH,
    signerId: 'wallet-1',
    address: ADDRESS,
});

function makeHost({ network = 'regtest' } = {}) {
    const address = addressRecord(network);
    const signMessage = vi.fn(async () => ({ signature: 'fixed-signature' }));
    const signPsbt = vi.fn(async () => ({
        signedPsbtHex: 'fixed-signed-psbt',
        txHex: 'fixed-tx',
        txid: 'fixed-txid',
    }));
    const signer = { signMessage, signPsbt };
    const chainRegistry = {
        chainIdFor: (chain, candidateNetwork) => (
            chain === 'bitcoin' && candidateNetwork === 'regtest' ? CHAIN_ID : undefined
        ),
    };
    const sdkRegistry = {
        get: (chainId) => (chainId === CHAIN_ID ? {
            wallet: { decomposePsbt: () => ({ inputs: [{ address: ADDRESS }] }) },
        } : undefined),
        for: () => ({}),
    };
    const vault = {
        addresses: { get: async (id) => (id === address.id ? address : null) },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool: { get: () => signer, has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, signMessage, signPsbt };
}

const call = (host, type, request) => host.handle({ type, request });

describe('software signing routes resolve the address chain id', () => {
    it('signs a message with the address chain and derivation path', async () => {
        const { host, signMessage } = makeHost();
        const response = await call(host, 'auth.signMessage', {
            walletId: 'wallet-1', addressId: 'addr-1', message: 'plain message',
        });

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(signMessage).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN_ID, path: PATH,
        }));
    });

    it('signs the matching PSBT input with the address chain', async () => {
        const { host, signPsbt } = makeHost();
        const response = await call(host, 'auth.signPsbt', {
            walletId: 'wallet-1', addressId: 'addr-1', psbtHex: 'unsigned-psbt',
        });

        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(signPsbt).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN_ID,
            signingPaths: [{ inputIndex: 0, path: PATH }],
        }));
    });

    it('names the handler, chain, and unknown network in the error', async () => {
        const { host, signMessage } = makeHost({ network: 'unknownnet' });
        const response = await call(host, 'auth.signMessage', {
            walletId: 'wallet-1', addressId: 'addr-1', message: 'plain message',
        });

        expect(response.ok).toBe(false);
        expect(response.error.message).toContain('auth.signMessage');
        expect(response.error.message).toContain('bitcoin');
        expect(response.error.message).toContain('unknownnet');
        expect(signMessage).not.toHaveBeenCalled();
    });
});
