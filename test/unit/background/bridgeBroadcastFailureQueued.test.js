// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A dApp SEND or SWEEP whose broadcast fails transiently joins the broadcast
// queue at once, like every in-app signing route. The queue's restore from the
// vault runs once per wallet per process, so a host that already listed the
// queue relies on the hook: a 'queued' record that skips it stays unlisted,
// and its coins unheld, until the host is rebuilt.
//
// Driven through the real background host and bridge handlers; the flows are
// stubbed to fail the way submitAction does (stamp, hand off, throw).

import { describe, it, expect, vi } from 'vitest';

const stubs = vi.hoisted(() => ({ hooks: [] }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    const failing = (name) => async (opts) => {
        stubs.hooks.push({ name, hook: typeof opts.onBroadcastFailure });
        const id = `p-${name}-${stubs.hooks.length}`;
        await opts.vault.pendingTxs.put({ id, status: 'queued', txHex: `hex-${id}`, fromAddress: FROM });
        if (typeof opts.onBroadcastFailure === 'function') {
            await opts.onBroadcastFailure({
                chainId: CHAIN, signedTxHex: `hex-${id}`, summary: name, signedAt: 1,
                txid: `tx-${id}`, pendingTxId: id, adsCommit: null,
            });
        }
        throw Object.assign(new Error('broadcast failed (phase1): ECONNREFUSED'), { name: 'BroadcastFailedTransientError' });
    };
    return { ...actual, flows: { ...actual.flows, sendToken: failing('sendToken'), sweepToken: failing('sweepToken') } };
});

const { createBackgroundHost } = await import('../../../packages/extension/src/background/createBackgroundHost.js');

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';
const FROM = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TO = 'bcrt1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qzf4jry';
const descriptor = { id: CHAIN, coin: 'bitcoin', networkKind: 'regtest', nativeTick: 'BTC', addressTypes: ['p2wpkh'] };

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? { ...m.get(id) } : null),
        put: async (rec) => { m.set(rec.id, { ...rec }); },
        list: async () => [...m.values()],
        findBy: async (k, v) => [...m.values()].filter((r) => r[k] === v),
        delete: async (id) => m.delete(id),
    };
}

function fakeVault() {
    const site = { id: 'site-1', origin: ORIGIN, permissions: { chains: [CHAIN], accounts: [], canSignAction: {}, canSignMessage: false } };
    const account = { id: 'acct-1', walletId: 'wallet-1' };
    return {
        settings: { get: async () => ({ activeNetwork: 'regtest', blockedOrigins: [] }), put: async () => {} },
        connectedSites: {
            findBy: async (f, v) => [site].filter((s) => s[f] === v),
            put: async () => site,
            update: async (id, decide) => decide(site.id === id ? site : null) != null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }], get: async () => ({ id: 'wallet-1' }) },
        accounts: { list: async () => [account], get: async () => account, findBy: async (f, v) => [account].filter((a) => a[f] === v) },
        addresses: {
            list: async () => [{
                id: 'addr-1', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', address: FROM,
                publicKey: `02${'aa'.repeat(32)}`, derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        pendingTxs: memCollection(),
    };
}

function makeHost() {
    const sdk = {
        config: { network: 'regtest' },
        encoder: { broadcastTx: vi.fn() },
        getAddress: async () => ({ balances: { confirmed: '1.5' } }),
        getBalances: async () => ({ data: [] }),
        getTokenInfo: async () => null,
    };
    const host = createBackgroundHost({
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: fakeVault(),
        chainRegistry: { get: (id) => (id === CHAIN ? descriptor : null), descriptorFor: () => descriptor, supportedChains: () => [descriptor], chainIdFor: () => CHAIN, list: () => [descriptor] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
    });
    return async (type, request) => host.handle({ type, request });
}

const SEND = { chainId: CHAIN, action: 'SEND', params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' } };
const SWEEP = { chainId: CHAIN, action: 'SWEEP', params: { fromAddress: FROM, toAddress: TO } };

async function queuedPendingIds(call) {
    const listed = await call('broadcast.queue.list', { walletId: 'wallet-1' });
    return (listed.result ?? []).map((entry) => entry.pendingTxId);
}

describe('a dApp action whose broadcast fails transiently', () => {
    it.each([['SEND', SEND, 'sendToken'], ['SWEEP', SWEEP, 'sweepToken']])(
        'queues a %s at once on a host that already listed its queue',
        async (_label, action, flowName) => {
            stubs.hooks.length = 0;
            const call = makeHost();
            expect(await queuedPendingIds(call)).toEqual([]);

            const res = await call('bridge.signAction', { origin: ORIGIN, ...action });
            expect(res).toMatchObject({ ok: false, error: { message: expect.stringMatching(/ECONNREFUSED/) } });
            expect(stubs.hooks).toEqual([{ name: flowName, hook: 'function' }]);
            expect(await queuedPendingIds(call)).toEqual([`p-${flowName}-1`]);
        });

    it('queues a failed slot of a parallel batch the same way', async () => {
        stubs.hooks.length = 0;
        const call = makeHost();
        expect(await queuedPendingIds(call)).toEqual([]);

        const res = await call('bridge.parallel', { origin: ORIGIN, actions: [SEND] });
        expect(res.ok).toBe(true);
        expect(res.result[0].ok).toBe(false);
        expect(await queuedPendingIds(call)).toEqual(['p-sendToken-1']);
    });

    it('keeps the web lease across both bridge signing routes, which now write the queue', async () => {
        const { __queueWritingRouteForTests: claimed } = await import('../../../packages/web/src/hostBridge.js');
        expect(claimed.test('bridge.signAction')).toBe(true);
        expect(claimed.test('bridge.parallel')).toBe(true);
        expect(claimed.test('bridge.signMessage')).toBe(false);
    });
});
