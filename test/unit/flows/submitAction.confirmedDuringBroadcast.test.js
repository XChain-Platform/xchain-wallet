// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The explorer can report a send before the broadcast call that made it has
// returned. The watchers stamp the stored record in that gap; submitAction's
// own final write must keep what they stamped.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async () => {
    const actual = await vi.importActual('../../../packages/core/src/sdk/submitWithSigner.js');
    return {
        BroadcastFailedError: actual.BroadcastFailedError,
        submitWithSigner: (...args) => submitWithSignerMock(...args),
    };
});

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const {
    markPendingTxIndexed,
    markPendingTxMempoolSeen,
} = await import('../../../packages/core/src/notifications/pendingTxBridge.js');

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        findBy: async (field, value) => Array.from(m.values()).filter((r) => r[field] === value),
    };
}

function harness() {
    const pendingTxs = memCollection();
    const vault = { pendingTxs, settings: { get: async () => ({}), put: async () => {} } };
    return {
        vault,
        pendingTxs,
        args: {
            vault,
            walletId: 'w1',
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
            sdkRegistry: {},
            chainId: 'bitcoin-regtest',
            actionData: { action: 'SEND', params: { TICK: 'AAA', AMOUNT: '1', DESTINATION: 'b' } },
            encoderOpts: { pubkey: '02aa' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer: { lock() {} },
            pendingTxMeta: { fromAddress: 'a', toAddress: 'b', actionSummary: 's' },
        },
    };
}

describe('submitAction when the network reports the send before the call returns', () => {
    beforeEach(() => { submitWithSignerMock.mockReset(); });

    it('keeps a confirmation stamped during the broadcast', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'tx-1', txHex: 'beef' });
            await markPendingTxIndexed(h.vault, 'tx-1');
            return { txid: 'tx-1', signed: { txHex: 'beef' } };
        });
        await submitAction(h.args);
        const [row] = await h.pendingTxs.list();
        expect(row.status).toBe('indexed');
        expect(row.confirmedAt).toBeTruthy();
    });

    it('keeps a network sighting stamped during the broadcast', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'tx-2', txHex: 'beef' });
            await markPendingTxMempoolSeen(h.vault, 'tx-2', { now: () => '2026-10-23T00:00:00.000Z' });
            return { txid: 'tx-2', signed: { txHex: 'beef' } };
        });
        await submitAction(h.args);
        const [row] = await h.pendingTxs.list();
        expect(row.status).toBe('broadcast');
        expect(row.mempoolSeenAt).toBe('2026-10-23T00:00:00.000Z');
    });
});
