// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A signing request that names its source only by address string is resolved
// among the request wallet's own addresses. An imported key is found through
// the wallet record's importedKeys, so when that record cannot be read the
// request must be refused rather than treated as naming no stored address,
// which would skip the source check and hand out the pooled signer.

import { describe, expect, it, vi } from 'vitest';

const { sendTokenMock } = vi.hoisted(() => ({ sendTokenMock: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, flows: { ...actual.flows, sendToken: sendTokenMock } };
});

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';

const HD_PATH = "m/84'/1'/0'/0/0";
const rec = (id, over) => ({
    id, accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', source: 'hd',
    derivationPath: HD_PATH, address: `bcrt1q${id}`, publicKey: 'pub', signerId: null, ...over,
});
const RECORDS = [
    rec('hd', {}),
    rec('imp', { source: 'imported-wif', accountId: null, derivationPath: null }),
];

function makeHost({ walletReadable }) {
    const vault = {
        addresses: {
            get: async (id) => RECORDS.find((r) => r.id === id) ?? null,
            list: async () => RECORDS,
        },
        accounts: { get: async (id) => (id === 'acct-1' ? { id, walletId: 'w1' } : null) },
        wallets: {
            get: async (id) => {
                if (!walletReadable) throw new Error('wallet store unreadable');
                return id === 'w1' ? { id, importedKeys: [{ addressId: 'imp' }] } : null;
            },
            list: async () => [],
        },
        signers: { get: async () => null },
        settings: { get: async () => ({ activeNetwork: 'regtest', ads: { enabled: false, perChain: {} } }) },
    };
    const signerGet = vi.fn(() => ({ kind: 'software' }));
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => null, chainIdFor: () => 'bitcoin-regtest' },
        sdkRegistry: { get: () => ({}) },
        signerPool: { get: signerGet, has: () => true },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, signerGet };
}

const send = (host, from) => host.handle({
    type: 'action.send',
    request: { walletId: 'w1', chainId: 'bitcoin-regtest', params: {}, from },
});
const importedWithHdPath = { address: 'bcrt1qimp', derivationPath: HD_PATH };

describe('address-string signing resolution fails closed on an unreadable wallet', () => {
    it('refuses an imported address sent with an HD path when the wallet is readable', async () => {
        sendTokenMock.mockReset();
        const { host } = makeHost({ walletReadable: true });
        const res = await send(host, importedWithHdPath);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/derivationPath does not match stored address "imp"/);
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses the same request when the wallet record cannot be read', async () => {
        sendTokenMock.mockReset();
        const { host, signerGet } = makeHost({ walletReadable: false });
        const res = await send(host, importedWithHdPath);
        expect(res.ok).toBe(false);
        expect(signerGet).not.toHaveBeenCalled();
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('refuses a stale address id that falls back to the string when the wallet cannot be read', async () => {
        sendTokenMock.mockReset();
        const { host, signerGet } = makeHost({ walletReadable: false });
        const res = await send(host, { addressId: 'gone', ...importedWithHdPath });
        expect(res.ok).toBe(false);
        expect(signerGet).not.toHaveBeenCalled();
        expect(sendTokenMock).not.toHaveBeenCalled();
    });

    it('still resolves an account-linked address string without reading the wallet record', async () => {
        sendTokenMock.mockReset().mockResolvedValue({ txid: 't' });
        const { host } = makeHost({ walletReadable: false });
        const res = await send(host, { address: 'bcrt1qhd', derivationPath: HD_PATH });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(sendTokenMock).toHaveBeenCalledTimes(1);
    });
});
