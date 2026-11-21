// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// messaging.inboxSweep names its addresses in `addressIds`, not in `from`, so
// the host checks each one the way a single-address route is checked before
// it hands the pooled signer to the flow.

import { describe, expect, it, vi } from 'vitest';

import { createBackgroundHost } from '../../../../packages/extension/src/background/createBackgroundHost.js';

const rec = (id, accountId, source, extra = {}) => ({
    id, accountId, source, chain: 'bitcoin', network: 'regtest', address: `ADDR_${id}`,
    derivationPath: source === 'watch-only' ? null : "m/84'/0'/0'/0/0", signerId: null, ...extra,
});

const RECORDS = [
    rec('own', 'acct-1', 'hd', { signerId: 'w1' }),
    rec('watch', null, 'watch-only'),
    rec('device', 'acct-1', 'trezor', { signerId: 'sig-1' }),
    rec('other', 'acct-2', 'hd'),
];

function makeHost() {
    const vault = {
        addresses: {
            get: async (id) => RECORDS.find((r) => r.id === id) ?? null,
            list: async () => RECORDS,
        },
        accounts: { get: async (id) => ({ 'acct-1': { id, walletId: 'w1' }, 'acct-2': { id, walletId: 'w2' } })[id] ?? null },
        wallets: { get: async (id) => (id === 'w1' ? { id, importedKeys: [] } : null), list: async () => [] },
        signers: { get: async () => null },
    };
    const exportWifForPath = vi.fn(() => 'WIF');
    const getMessagesForAddress = vi.fn(async () => []);
    const host = createBackgroundHost({
        vault,
        chainRegistry: { get: () => null, chainIdFor: () => 'bitcoin-regtest' },
        sdkRegistry: { get: () => ({ getMessagesForAddress }), for: () => ({}) },
        signerPool: {
            get: () => ({ kind: 'software', id: 'w1', exportWifForPath, exportWifForAddressId: vi.fn() }),
            has: () => true,
        },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return { host, exportWifForPath, getMessagesForAddress };
}

const sweep = (host, addressIds) => host.handle({
    type: 'messaging.inboxSweep',
    request: { walletId: 'w1', addressIds },
});

describe('messaging.inboxSweep checks every named address before handing out the pooled signer', () => {
    it('sweeps the wallet own addresses with the pooled signer', async () => {
        const { host, exportWifForPath } = makeHost();
        const res = await sweep(host, ['own']);
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(res.result.addresses).toEqual(['ADDR_own']);
        expect(exportWifForPath).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['watch', /watch-only/],
        ['device', /sign it with its own device/],
        ['other', /not in this wallet/],
    ])('refuses a sweep naming the %s address', async (id, message) => {
        const { host, exportWifForPath, getMessagesForAddress } = makeHost();
        const res = await sweep(host, ['own', id]);
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(message);
        expect(exportWifForPath).not.toHaveBeenCalled();
        expect(getMessagesForAddress).not.toHaveBeenCalled();
    });
});
