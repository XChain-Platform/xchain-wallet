// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Another surface removes the sending wallet while its send is signing or
// broadcasting. removeWallet deletes the send's pending record with the
// wallet's addresses; the send's own later writes must not put it back, or a
// pending send stays on an address no wallet holds.

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
const { BroadcastFailedError } = await import('../../../packages/core/src/sdk/submitWithSigner.js');

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        get: async (id) => (m.has(id) ? JSON.parse(JSON.stringify(m.get(id))) : null),
        delete: async (id) => { m.delete(id); },
        list: async () => Array.from(m.values()).map((r) => JSON.parse(JSON.stringify(r))),
        findBy: async (field, value) => Array.from(m.values()).filter((r) => r[field] === value),
    };
}

function harness() {
    const pendingTxs = memCollection();
    const vault = { pendingTxs, settings: { get: async () => ({}), put: async () => {} } };
    // What removeWallet does to the send's record: delete every pending row.
    const removeWalletRecords = async () => {
        for (const row of await pendingTxs.list()) await pendingTxs.delete(row.id);
    };
    return {
        pendingTxs,
        removeWalletRecords,
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

describe('submitAction when the wallet is removed mid-send', () => {
    beforeEach(() => { submitWithSignerMock.mockReset(); });

    it('leaves the record deleted when the removal lands during the broadcast', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'tx-1', txHex: 'beef' });
            await h.removeWalletRecords();
            return { txid: 'tx-1', signed: { txHex: 'beef' } };
        });
        const result = await submitAction(h.args);
        expect(result.txid).toBe('tx-1');
        expect(await h.pendingTxs.list()).toEqual([]);
    });

    it('leaves the record deleted when the removal lands during signing', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await h.removeWalletRecords();
            await onProgress('signing', { encoding: 'P2WPKH' });
            await onProgress('broadcasting', { txid: 'tx-2', txHex: 'beef' });
            return { txid: 'tx-2', signed: { txHex: 'beef' } };
        });
        await submitAction(h.args);
        expect(await h.pendingTxs.list()).toEqual([]);
    });

    it('leaves the record deleted when the broadcast then fails', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'tx-3', txHex: 'beef' });
            await h.removeWalletRecords();
            throw new BroadcastFailedError({
                cause: new Error('connection refused'),
                signedTxHex: 'beef',
                txid: 'tx-3',
                chainId: 'bitcoin-regtest',
                signedAt: 1,
            });
        });
        await expect(submitAction(h.args)).rejects.toBeInstanceOf(BroadcastFailedError);
        expect(await h.pendingTxs.list()).toEqual([]);
    });

    it('still settles a record nobody removed', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'tx-4', txHex: 'beef' });
            return { txid: 'tx-4', signed: { txHex: 'beef' } };
        });
        await submitAction(h.args);
        const [row] = await h.pendingTxs.list();
        expect(row.status).toBe('broadcast');
        expect(row.txid).toBe('tx-4');
    });
});
