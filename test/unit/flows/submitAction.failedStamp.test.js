// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A permanent rejection of a LATER leg (phase 2 or the envelope reveal) must not
// retire a row whose phase 1 is already on the network, and a reveal that landed
// must put the reveal txid on the row even when the cleanup after it throws.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async () => {
    const actual = await vi.importActual('../../../packages/core/src/sdk/submitWithSigner.js');
    return {
        BroadcastFailedError: actual.BroadcastFailedError,
        submitWithSigner: (...args) => submitWithSignerMock(...args),
    };
});

const clearMock = vi.fn();
vi.mock('../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js', () => ({
    recordPendingCommit: vi.fn(),
    clearPendingCommit: (...args) => clearMock(...args),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const real = await vi.importActual('../../../packages/core/src/sdk/submitWithSigner.js');
const { BroadcastFailedError } = real;

function memCollection() {
    const m = new Map();
    return {
        put: async (rec) => { m.set(rec.id, JSON.parse(JSON.stringify(rec))); },
        list: async () => Array.from(m.values()),
    };
}

function harness() {
    const pendingTxs = memCollection();
    return {
        pendingTxs,
        args: {
            vault: {
                pendingTxs,
                settings: { get: async () => ({}), put: async () => {} },
            },
            walletId: 'w1',
            chainRegistry: { get: () => ({ coin: 'bitcoin', networkKind: 'regtest' }) },
            sdkRegistry: {},
            chainId: 'bitcoin-regtest',
            actionData: { action: 'ISSUE', params: { TICK: 'AAA' } },
            encoderOpts: { pubkey: '02aa' },
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
            signer: { lock() {} },
            pendingTxMeta: { fromAddress: 'a', toAddress: 'b', actionSummary: 's' },
        },
    };
}

function failure(phase, reason) {
    return new BroadcastFailedError({
        cause: new Error(reason), signedTxHex: 'beef', txid: 'later-txid',
        chainId: 'bitcoin-regtest', signedAt: 1, encoding: 'P2SH', phase,
    });
}

describe('submitAction failed stamp', () => {
    beforeEach(() => { submitWithSignerMock.mockReset(); clearMock.mockReset(); });

    it.each(['phase2', 'envelope_reveal'])(
        'keeps a %s permanent rejection on broadcast, not failed',
        async (phase) => {
            const h = harness();
            submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
                await onProgress('broadcasting', { txid: 'commit-txid' });
                await onProgress(phase === 'phase2' ? 'p2sh_spending' : 'envelope_revealing', {
                    phase1Txid: 'commit-txid', commitTxid: 'commit-txid',
                });
                throw failure(phase, 'bad-txns-inputs-missingorspent');
            });
            await expect(submitAction(h.args)).rejects.toThrow();
            const [row] = await h.pendingTxs.list();
            expect(row.status).toBe('broadcast');
            expect(row.txid).toBe('commit-txid');
            expect(row.error).toMatch(/missingorspent/);
        },
    );

    it('still marks a phase1 permanent rejection failed', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'commit-txid' });
            throw failure('phase1', 'bad-txns-inputs-missingorspent');
        });
        await expect(submitAction(h.args)).rejects.toThrow();
        const [row] = await h.pendingTxs.list();
        expect(row.status).toBe('failed');
    });

    it('moves the row to the reveal txid once the reveal is delivered', async () => {
        const h = harness();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            await onProgress('broadcasting', { txid: 'commit-txid' });
            await onProgress('envelope_revealing', { commitTxid: 'commit-txid' });
            await onProgress('envelope_revealed', { txid: 'reveal-txid', commitTxid: 'commit-txid' });
            throw new Error('later failure');
        });
        await expect(submitAction(h.args)).rejects.toThrow('later failure');
        const [row] = await h.pendingTxs.list();
        expect(row.status).toBe('broadcast');
        expect(row.txid).toBe('reveal-txid');
    });
});

describe('submitWithSigner reveal cleanup', () => {
    it('reports success with the reveal txid when clearPendingCommit throws', async () => {
        clearMock.mockImplementation(() => { throw new Error('storage gone'); });
        const events = [];
        const encoder = {
            createTx: async () => ({
                psbt: 'c0', encoding: 'TAPROOT', revealPsbt: 'r0',
                envelope: {
                    commitTxid: 'commit-txid', commitVout: 0, commitValue: 1,
                    commitAddress: 'addr', tapleafHash: 'leaf',
                },
            }),
            broadcastTx: async () => {},
        };
        const signer = {
            signPsbt: async ({ envelopeReveal }) => (envelopeReveal
                ? { txid: 'reveal-txid', txHex: 'rr', signedPsbtHex: 'r1' }
                : { txid: 'commit-txid', txHex: 'cc', signedPsbtHex: 'c1' }),
        };
        const result = await real.submitWithSigner({
            sdkRegistry: { get: () => ({ encoder, actions: { createAction: () => ({ actionString: 'x', action: 'ISSUE' }) }, wallet: {} }) },
            chainRegistry: { get: () => ({}) },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'ISSUE', params: {} },
            encoderOpts: { pubkey: '02aa' },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
            onProgress: (phase, data) => { events.push([phase, data]); },
        });
        expect(result.txid).toBe('reveal-txid');
        expect(events.find(([p]) => p === 'envelope_revealed')[1].txid).toBe('reveal-txid');
    });
});
