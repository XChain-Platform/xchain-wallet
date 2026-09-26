// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every software-signer action route hands its flow the auto-enqueue hook, so
// a transient broadcast failure on any action lands on the queue at once,
// carrying its PendingTx id and ADS verdict, rather than only after a worker
// restart rebuilds it. The flows are stubbed to fail the way submitAction
// does; the scenario is the host wiring, not signing.

import { describe, it, expect, vi } from 'vitest';

const ROUTES = [
    ['action.issue', 'issueToken'],
    ['action.sweep', 'sweepToken'],
    ['action.dividend', 'dividendAction'],
    ['action.order', 'orderAction'],
    ['action.createPoll', 'createPollAction'],
    ['action.placeBet', 'placeBetAction'],
    ['action.deposit', 'depositAction'],
    ['action.deployChunked', 'deployChunkedRun'],
];

const stubs = vi.hoisted(() => ({}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    const failing = {};
    for (const name of ['issueToken', 'sweepToken', 'dividendAction', 'orderAction', 'createPollAction',
        'placeBetAction', 'depositAction', 'deployChunkedRun']) {
        failing[name] = (...args) => stubs.run(name, ...args);
    }
    return { ...actual, flows: { ...actual.flows, ...failing } };
});

const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);

const CHAIN = 'bitcoin-regtest';
const W = 'w1';

function memCollection() {
    const m = new Map();
    return {
        get: async (id) => (m.has(id) ? { ...m.get(id) } : null),
        put: async (rec) => { m.set(rec.id, { ...rec }); },
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v),
        delete: async (id) => m.delete(id),
    };
}

function makeHost() {
    const sdk = { encoder: { broadcastTx: vi.fn() }, waitForAction: vi.fn() };
    const host = createBackgroundHost({
        vault: {
            pendingTxs: memCollection(),
            wallets: { list: async () => [{ id: W }] },
            settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
        },
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return async (type, request) => host.handle({ type, request });
}

describe('a transient broadcast failure on any action joins the queue at once', () => {
    it.each(ROUTES)('%s hands %s the enqueue hook', async (route, flowName) => {
        stubs.run = async (name, opts) => {
            expect(name).toBe(flowName);
            expect(typeof opts.onBroadcastFailure).toBe('function');
            // The durable half submitAction stamps before it calls the hook.
            await opts.vault.pendingTxs.put({ id: `p-${name}`, status: 'queued', txHex: `hex-${name}` });
            await opts.onBroadcastFailure({
                chainId: CHAIN,
                signedTxHex: `hex-${name}`,
                summary: name,
                signedAt: 1,
                txid: `tx-${name}`,
                pendingTxId: `p-${name}`,
                adsCommit: { chainId: CHAIN, donationIncluded: true },
            });
            throw Object.assign(new Error('ECONNREFUSED'), { name: 'BroadcastFailedTransientError' });
        };
        const call = makeHost();

        const res = await call(route, { walletId: W, chainId: CHAIN });
        expect(res.ok).toBe(false);

        const listed = (await call('broadcast.queue.list', { walletId: W })).result;
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
            signedTxHex: `hex-${flowName}`,
            pendingTxId: `p-${flowName}`,
            adsCommit: { chainId: CHAIN, donationIncluded: true },
        });
    });
});
