// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A two-phase pair whose commit was refused at submit is queued whole, with its
// donation claim still held. When the core drain later delivers the commit, it
// books that commit as its own transaction, as the live send does: an envelope
// commit settles the payout it carried, so a reveal refused or discarded after
// it cannot release a claim the chain already paid.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await import('../../../../packages/core/src/sdk/submitWithSigner.js');
const { bookQueuedCommitLeg } = await import('../../../../packages/core/src/flows/adsDelivery.js');
const { drainQueuedBroadcast, discardQueuedBroadcast } = await import('../../../../packages/core/src/flows/queuedBroadcast.js');
const { MAINNET_LAUNCH_EPOCH } = await import('../../../../packages/core/src/flows/mainnetPrelaunch.js');
const { createDefaultSettings, validateSettings } = await import('../../../../packages/core/src/schemas/settings.js');
const { validatePendingTx } = await import('../../../../packages/core/src/schemas/pendingTx.js');

const CHAINS = {
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' },
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' },
};
const chainRegistry = {
    get: (id) => CHAINS[id],
    chainIdFor: (coin, network) => Object.values(CHAINS)
        .find((d) => d.coin === coin && d.networkKind === network)?.id ?? null,
};

const ENVELOPE = 'TAPROOT';
const CHUNK = 'P2SH';
const PERMANENT = 'bad-txns-inputs-missingorspent';

function wallet() {
    const base = createDefaultSettings();
    let settings = {
        ...base,
        fiatCurrency: 'USD',
        ads: {
            ...base.ads, currency: 'USD', perTransaction: '0.05', sendAt: '5', queued: '30',
            reserved: { id: 'review-1', fiat: '30', currency: 'USD', chainId: 'bitcoin-mainnet', pendingTxId: null, at: 1, review: true },
        },
    };
    const rows = new Map();
    const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    return {
        ads: () => settings.ads,
        settings: () => copy(settings),
        row: () => copy([...rows.values()][0]),
        vault: {
            settings: { get: async () => copy(settings), put: async (n) => { settings = copy(n); } },
            pendingTxs: {
                put: async (r) => { rows.set(r.id, copy(r)); },
                get: async (id) => copy(rows.get(id) ?? null),
                list: async () => [...rows.values()].map(copy),
                delete: async (id) => rows.delete(id),
                findBy: async (k, v) => [...rows.values()].filter((r) => r[k] === v).map(copy),
            },
        },
    };
}

// A submit whose commit the node refuses for a temporary reason: the pair is
// queued with its signed reveal and the claim stays held on the queue.
async function queuePair(w, encoding, chainId = 'bitcoin-mainnet') {
    submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
        onProgress('signing', { encoding });
        await onProgress('broadcasting', { txid: 'commit-txid', txHex: 'c0', revealTxid: 'reveal-txid', revealTxHex: 'r0' });
        throw new BroadcastFailedError({
            cause: new Error('connection reset'), signedTxHex: 'c0', txid: 'commit-txid', chainId,
            signedAt: 1, encoding, phase: 'phase1', revealTxHex: 'r0', revealTxid: 'reveal-txid',
        });
    });
    await expect(submitAction({
        vault: w.vault,
        walletId: 'w1',
        chainRegistry,
        sdkRegistry: {},
        chainId,
        actionData: { action: 'ISSUE', params: { TICK: 'AAA' } },
        encoderOpts: { pubkey: '02aa' },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        signer: { kind: 'software', lock() {} },
        pendingTxMeta: { fromAddress: 'src', toAddress: null, actionSummary: 'Issue' },
        prebuiltPsbt: { psbtHex: 'aa', adsDonation: { included: true, fiat: '30', currency: 'USD', reservationId: 'review-1' } },
        onBroadcastFailure: async () => true,
    })).rejects.toBeInstanceOf(BroadcastFailedError);
    return w.row();
}

async function drain(w, broadcastTx) {
    const now = vi.spyOn(Date, 'now').mockReturnValue(MAINNET_LAUNCH_EPOCH * 1000 + 1);
    try {
        return await drainQueuedBroadcast({
            vault: w.vault, chainRegistry, pendingTxId: w.row().id,
            sdkRegistry: { get: () => ({ encoder: { broadcastTx } }) },
        });
    } finally {
        now.mockRestore();
    }
}

const revealRefused = (message) => async (hex) => {
    if (hex === 'r0') throw new Error(message);
    return 'commit-txid';
};

beforeEach(() => { submitWithSignerMock.mockReset(); });

describe('a queued two-phase pair the core drain delivers', () => {
    it('queues the pair with its claim held and the signed encoding on its verdict', async () => {
        const w = wallet();
        const row = await queuePair(w, ENVELOPE);
        expect(row).toMatchObject({ status: 'queued', txHex: 'c0', revealTxHex: 'r0' });
        expect(row.adsCommit).toMatchObject({ donationIncluded: true, reservationId: row.id, encoding: ENVELOPE });
        expect(validatePendingTx(row)).toMatchObject({ ok: true });
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', reserved: { id: row.id } });
    });

    for (const encoding of [ENVELOPE, CHUNK]) {
        it(`accrues twice and settles the payout once when a queued ${encoding} pair lands`, async () => {
            const w = wallet();
            const row = await queuePair(w, encoding);
            const out = await drain(w, async (hex) => (hex === 'r0' ? 'reveal-txid' : 'commit-txid'));
            expect(out.broadcast).toBe(true);
            expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
            expect(w.ads().reserved).toBeUndefined();
            expect(w.ads().bookedKeys.queuedDelivery).toEqual(expect.arrayContaining([row.id, `${row.id}:commit`]));
            expect(w.row().adsBooking).toMatchObject({ fiat: '30', currency: 'USD' });
            expect(validateSettings(w.settings())).toMatchObject({ ok: true });
        });
    }

    it('books a commit the node already holds once, however often it is delivered', async () => {
        const w = wallet();
        const row = await queuePair(w, ENVELOPE);
        await drain(w, async (hex) => {
            if (hex === 'c0') throw new Error('txn-already-known');
            return 'reveal-txid';
        });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        await bookQueuedCommitLeg({ vault: w.vault, chainRegistry, pendingTxId: row.id, adsCommit: row.adsCommit });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
    });

    it('keeps the totals of a landed pair for a verdict saved before the encoding was', async () => {
        const w = wallet();
        const row = await queuePair(w, ENVELOPE);
        const { encoding: _dropped, ...older } = row.adsCommit;
        await w.vault.pendingTxs.put({ ...row, adsCommit: older });
        await drain(w, async (hex) => (hex === 'r0' ? 'reveal-txid' : 'commit-txid'));
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('settles the payout once when a drain resumes a pair a crash left broadcasting', async () => {
        const w = wallet();
        const row = await queuePair(w, ENVELOPE);
        await w.vault.pendingTxs.put({ ...row, status: 'broadcasting', error: null });
        const out = await drain(w, revealRefused(PERMANENT));
        expect(out.broadcast).toBe(false);
        expect(w.row()).toMatchObject({ status: 'broadcast', commitLanded: true });
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('accrues nothing for a queued regtest pair', async () => {
        const w = wallet();
        await queuePair(w, ENVELOPE, 'bitcoin-regtest');
        await drain(w, async (hex) => (hex === 'r0' ? 'reveal-txid' : 'commit-txid'));
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
    });
});

describe('a queued pair whose reveal is refused after the drain lands its commit', () => {
    it('settles the payout an envelope commit carried when the reveal is refused for good', async () => {
        const w = wallet();
        await queuePair(w, ENVELOPE);
        const out = await drain(w, revealRefused(PERMANENT));
        expect(out.broadcast).toBe(false);
        expect(w.row()).toMatchObject({ status: 'broadcast', txid: 'commit-txid', commitLanded: true });
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('settles the claim when a chunk-lane reveal is refused after its commit lands', async () => {
        const w = wallet();
        await queuePair(w, CHUNK);
        await drain(w, revealRefused(PERMANENT));
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('keeps the payout an envelope commit carried when its queued reveal is discarded', async () => {
        const w = wallet();
        const row = await queuePair(w, ENVELOPE);
        await drain(w, revealRefused('connection reset'));
        expect(w.row()).toMatchObject({ status: 'queued', commitLanded: true });
        expect(w.row().adsCommit).toMatchObject({ donationIncluded: false, reservationId: null, bookingKey: row.id });
        expect(await discardQueuedBroadcast({ vault: w.vault, pendingTxId: row.id })).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });
});
