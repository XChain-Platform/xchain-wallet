// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const PATH = "m/84'/1'/0'/0/0";
const ADDRESS = 'bcrt1qsigningaddress';

function makeHost(overrides = {}) {
    const address = {
        id: 'addr-1', accountId: 'account-1', chain: 'bitcoin', network: 'regtest',
        source: 'hd', addressType: 'p2wpkh', derivationPath: PATH,
        signerId: 'signer-1', address: ADDRESS, ...overrides.address,
    };
    const account = overrides.account === undefined
        ? { id: 'account-1', walletId: 'wallet-1' }
        : overrides.account;
    const signPsbt = vi.fn(async () => ({ signedPsbtHex: 'signed-psbt' }));
    const vault = {
        addresses: { get: async () => address },
        accounts: { get: async () => account },
        wallets: {
            get: async (id) => (id === 'wallet-1'
                ? { id, importedKeys: overrides.importedKeys ?? [{ addressId: 'addr-1' }] }
                : null),
        },
        signers: {
            find: async (id) => (id === 'signer-1'
                ? { id, walletId: 'wallet-1', kind: address.source }
                : null),
        },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry: { chainIdFor: () => 'bitcoin-regtest' },
        sdkRegistry: {
            get: () => ({ wallet: { decomposePsbt: () => ({ inputs: [{ address: ADDRESS }] }) } }),
            for: () => ({}),
        },
        signerPool: { get: () => ({ signPsbt }), has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, signPsbt };
}

const sign = (host, request = {}) => host.handle({
    type: 'auth.signPsbt',
    request: { walletId: 'wallet-1', addressId: 'addr-1', psbtHex: 'unsigned-psbt', ...request },
});

describe('auth.signPsbt address routing', () => {
    it('signs an owned HD address with its derivation path', async () => {
        const { host, signPsbt } = makeHost();
        const response = await sign(host);
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(signPsbt).toHaveBeenCalledWith(expect.objectContaining({
            signingPaths: [{ inputIndex: 0, path: PATH }],
        }));
    });

    it.each([
        ['another wallet', { id: 'account-1', walletId: 'wallet-2' }],
        ['a missing account', null],
    ])('refuses an HD address owned by %s', async (_label, account) => {
        const { host, signPsbt } = makeHost({ account });
        const response = await sign(host);
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/not in this wallet/);
        expect(signPsbt).not.toHaveBeenCalled();
    });

    it('refuses a watch-only address', async () => {
        const { host, signPsbt } = makeHost({
            address: { source: 'watch-only', accountId: null, derivationPath: null, signerId: null },
        });
        const response = await sign(host);
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/watch-only/);
        expect(signPsbt).not.toHaveBeenCalled();
    });

    it('routes a hardware address to auth.signPsbt.hw', async () => {
        const { host, signPsbt } = makeHost({ address: { source: 'trezor' } });
        const response = await sign(host);
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/auth\.signPsbt\.hw/);
        expect(signPsbt).not.toHaveBeenCalled();
    });

    it('signs an imported key by address id instead of a null path', async () => {
        const { host, signPsbt } = makeHost({
            address: { source: 'imported-wif', accountId: null, derivationPath: null, signerId: null },
        });
        const response = await sign(host);
        expect(response.ok, JSON.stringify(response.error ?? {})).toBe(true);
        expect(signPsbt).toHaveBeenCalledWith(expect.objectContaining({
            signingPaths: [{ inputIndex: 0, addressId: 'addr-1' }],
        }));
    });

    it('refuses an imported key the wallet does not list', async () => {
        const { host, signPsbt } = makeHost({
            address: { source: 'imported-wif', accountId: null, derivationPath: null, signerId: null },
            importedKeys: [],
        });
        const response = await sign(host);
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/not in this wallet/);
        expect(signPsbt).not.toHaveBeenCalled();
    });

    it('refuses signerId on the software route', async () => {
        const { host, signPsbt } = makeHost();
        const response = await sign(host, { signerId: 'signer-1' });
        expect(response.ok).toBe(false);
        expect(response.error.message).toMatch(/signerId is not accepted/);
        expect(signPsbt).not.toHaveBeenCalled();
    });
});
