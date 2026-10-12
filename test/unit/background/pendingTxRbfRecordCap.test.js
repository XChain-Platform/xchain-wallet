// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A pending-tx record's rbf says whether the broadcast signalled replaceability,
// so an action route records the flag capped to the chain descriptor, exactly as
// the encoder was given it. The flows are stubbed; the scenario is the host's
// record write after a successful broadcast.

import { describe, it, expect, vi } from 'vitest';

const ROUTES = [
    ['action.send', 'sendToken'],
    ['action.sweep', 'sweepToken'],
    ['action.dispenser', 'dispenserAction'],
    ['action.execute', 'executeAction'],
    ['action.deposit', 'depositAction'],
    ['action.withdraw', 'withdrawAction'],
    ['action.dividend', 'dividendAction'],
    ['action.airdrop', 'airdropAction'],
];

const PENDING_ID = 'pending-1';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    const broadcast = async () => ({ pendingTxId: 'pending-1', signed: { signedPsbtHex: 'signed-psbt' } });
    const stubbed = {};
    for (const name of ['sendToken', 'sweepToken', 'dispenserAction', 'executeAction', 'depositAction',
        'withdrawAction', 'dividendAction', 'airdropAction']) {
        stubbed[name] = broadcast;
    }
    return { ...actual, flows: { ...actual.flows, ...stubbed } };
});

const { createBackgroundHost } = await import(
    '../../../packages/extension/src/background/createBackgroundHost.js'
);

const DOGE = { id: 'dogecoin-regtest', coin: 'dogecoin', networkKind: 'regtest', feeStrategy: { rbfSupported: false } };
const BTC = { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', feeStrategy: { rbfSupported: true } };

function makeHost() {
    const rows = new Map([[PENDING_ID, { id: PENDING_ID, status: 'broadcast', psbtHex: 'unsigned-psbt' }]]);
    const descriptors = { [DOGE.id]: DOGE, [BTC.id]: BTC };
    const host = createBackgroundHost({
        vault: {
            pendingTxs: {
                get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null),
                put: async (rec) => { rows.set(rec.id, { ...rec }); },
                findBy: async (k, v) => Array.from(rows.values()).filter((r) => r[k] === v),
                delete: async (id) => rows.delete(id),
            },
            wallets: { list: async () => [{ id: 'w1' }] },
            settings: { get: async () => ({ schemaVersion: 2, ads: { enabled: false, perChain: {} } }), put: async () => {} },
        },
        chainRegistry: { get: (id) => descriptors[id] ?? null, list: () => [] },
        sdkRegistry: { get: () => ({}), for: () => ({}) },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: { load: async () => ({}), save: async () => {}, clear: async () => {} },
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    const send = async (type, request) => host.handle({ type, request });
    return { send, record: () => rows.get(PENDING_ID) };
}

describe('action routes record the RBF the chain allowed', () => {
    for (const [route] of ROUTES) {
        it(`${route} records rbf false on a chain without RBF support when asked for rbf`, async () => {
            const h = makeHost();
            const res = await h.send(route, { chainId: DOGE.id, walletId: 'w1', rbf: true });
            expect(res.ok, JSON.stringify(res)).toBe(true);
            expect(h.record().rbf).toBe(false);
            expect(h.record().psbtHex).toBe('signed-psbt');
        });
    }

    it('keeps rbf true on a chain that declares RBF support', async () => {
        const h = makeHost();
        await h.send('action.send', { chainId: BTC.id, walletId: 'w1', rbf: true });
        expect(h.record().rbf).toBe(true);
    });

    it('records rbf false when false was asked for', async () => {
        const h = makeHost();
        await h.send('action.send', { chainId: BTC.id, walletId: 'w1', rbf: false });
        expect(h.record().rbf).toBe(false);
    });

    it('adds no rbf when the request carries none', async () => {
        const h = makeHost();
        await h.send('action.send', { chainId: BTC.id, walletId: 'w1' });
        expect(h.record()).not.toHaveProperty('rbf');
    });

    it('records rbf false for a chain the registry does not know', async () => {
        const h = makeHost();
        await h.send('action.send', { chainId: 'unknown-chain', walletId: 'w1', rbf: true });
        expect(h.record().rbf).toBe(false);
    });
});
