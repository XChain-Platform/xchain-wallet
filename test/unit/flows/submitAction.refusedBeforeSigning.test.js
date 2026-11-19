// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A submit that fails before the signer is handed bytes tags the error, so the
// confirm screen can release its held inputs; a failure after signing starts
// does not, because the hold covers bytes that may still be sent.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../packages/core/src/sdk/submitWithSigner.js', async () => {
    const actual = await vi.importActual('../../../packages/core/src/sdk/submitWithSigner.js');
    return {
        BroadcastFailedError: actual.BroadcastFailedError,
        submitWithSigner: (...args) => submitWithSignerMock(...args),
    };
});
vi.mock('../../../packages/core/src/shared/utils/envelopeRecoveryMemory.js', () => ({
    recordPendingCommit: vi.fn(),
    clearPendingCommit: vi.fn(),
}));

const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await vi.importActual('../../../packages/core/src/sdk/submitWithSigner.js');

function args() {
    const rows = new Map();
    return {
        vault: {
            pendingTxs: { put: async (r) => { rows.set(r.id, r); }, list: async () => [...rows.values()] },
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
    };
}

async function rejection(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected a rejection');
}

describe('submitAction refusedBeforeSigning tag', () => {
    beforeEach(() => { submitWithSignerMock.mockReset(); });

    it('tags an error thrown before the signing phase', async () => {
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            onProgress('creating', {});
            throw Object.assign(new Error('frozen'), { name: 'PanicModeActiveError' });
        });
        const err = await rejection(submitAction(args()));
        expect(err.refusedBeforeSigning).toBe(true);
        expect(err.name).toBe('PanicModeActiveError');
        expect(err.message).toBe('frozen');
    });

    it('tags an error thrown before any progress at all', async () => {
        submitWithSignerMock.mockImplementation(async () => { throw new Error('encoder is not initialized'); });
        expect((await rejection(submitAction(args()))).refusedBeforeSigning).toBe(true);
    });

    it('leaves an error thrown by the signer untagged', async () => {
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            onProgress('signing', {});
            throw new Error('device rejected');
        });
        expect('refusedBeforeSigning' in await rejection(submitAction(args()))).toBe(false);
    });

    it('leaves a broadcast failure untagged', async () => {
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            onProgress('signing', {});
            await onProgress('broadcasting', { txid: 't' });
            throw new BroadcastFailedError({
                cause: new Error('bad-txns-inputs-missingorspent'), signedTxHex: 'beef', txid: 't',
                chainId: 'bitcoin-regtest', signedAt: 1, encoding: 'OP_RETURN', phase: 'phase1',
            });
        });
        expect('refusedBeforeSigning' in await rejection(submitAction(args()))).toBe(false);
    });
});
