// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A two-phase action broadcasts two transactions, a commit and then a reveal
// (or a P2SH/P2WSH phase-2 spend), and every mainnet transaction adds the
// per-transaction amount to the donation queue. The donation output rides one
// leg only: an envelope keeps every custom output on its commit, while the
// chunk lane defers them all to the reveal. So the payout settles on the leg
// that carried it, a landed envelope commit has already paid it even when its
// reveal is refused, and a refused chunk-lane reveal never paid it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const submitWithSignerMock = vi.fn();
vi.mock('../../../../packages/core/src/sdk/submitWithSigner.js', async (importOriginal) => ({
    ...(await importOriginal()),
    submitWithSigner: (...args) => submitWithSignerMock(...args),
}));

const { submitAction } = await import('../../../../packages/core/src/flows/submitAction.js');
const { BroadcastFailedError } = await import('../../../../packages/core/src/sdk/submitWithSigner.js');
const { bookQueuedDelivery, bookLandedCommit } = await import('../../../../packages/core/src/flows/adsDelivery.js');
const { drainQueuedBroadcast } = await import('../../../../packages/core/src/flows/queuedBroadcast.js');
const { MAINNET_LAUNCH_EPOCH } = await import('../../../../packages/core/src/flows/mainnetPrelaunch.js');
const { createDefaultSettings, validateSettings } = await import('../../../../packages/core/src/schemas/settings.js');

const CHAINS = {
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet' },
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' },
};
const chainRegistry = {
    get: (id) => CHAINS[id],
    chainIdFor: (coin, network) => Object.values(CHAINS)
        .find((d) => d.coin === coin && d.networkKind === network)?.id ?? null,
};

// The lanes: the encoding signed, the progress the landed commit emits, and
// the phase a refused second leg reports.
const ENVELOPE = { encoding: 'TAPROOT', landed: 'envelope_revealing', refused: 'envelope_reveal' };
const CHUNK = { encoding: 'P2SH', landed: 'p2sh_spending', refused: 'phase2' };

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
    const writes = [];
    const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    return {
        ads: () => settings.ads,
        settings: () => copy(settings),
        rows: () => [...rows.values()].map(copy),
        checkpoint: () => writes.filter((r) => r.status === 'broadcasting').at(-1),
        vault: {
            settings: { get: async () => copy(settings), put: async (n) => { settings = copy(n); } },
            pendingTxs: {
                put: async (r) => { rows.set(r.id, copy(r)); writes.push(copy(r)); },
                get: async (id) => copy(rows.get(id) ?? null),
                list: async () => [...rows.values()].map(copy),
                delete: async (id) => rows.delete(id),
                findBy: async (k, v) => [...rows.values()].filter((r) => r[k] === v).map(copy),
            },
        },
    };
}

function send(w, chainId = 'bitcoin-mainnet') {
    return submitAction({
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
    });
}

// Drive the commit onto the network, then either land the second leg or refuse it.
function twoPhase(lane, outcome) {
    submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
        onProgress('signing', { encoding: lane.encoding });
        await onProgress('broadcasting', { txid: 'commit-txid', txHex: 'c0' });
        onProgress(lane.landed, { commitTxid: 'commit-txid', phase1Txid: 'commit-txid' });
        if (outcome) {
            throw new BroadcastFailedError({
                cause: new Error(outcome), signedTxHex: 'r0', txid: 'reveal-txid',
                chainId: 'bitcoin-mainnet', signedAt: 1, encoding: lane.encoding, phase: lane.refused,
            });
        }
        await onProgress('waiting', { txid: 'reveal-txid' });
        return { txid: 'reveal-txid', signed: { txHex: 'r0' }, encoding: lane.encoding };
    });
}

const PERMANENT = 'bad-txns-inputs-missingorspent';
const TRANSIENT = 'connection reset';

beforeEach(() => { submitWithSignerMock.mockReset(); });

describe('a mainnet two-phase send accrues per landed transaction', () => {
    for (const lane of [ENVELOPE, CHUNK]) {
        it(`accrues twice and settles the payout once when a ${lane.encoding} pair lands`, async () => {
            const w = wallet();
            twoPhase(lane, null);
            const result = await send(w);
            expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
            expect(w.ads().reserved).toBeUndefined();
            expect(w.ads().bookedKeys.queuedDelivery).toEqual(
                expect.arrayContaining([result.pendingTxId, `${result.pendingTxId}:commit`]));
            const [row] = w.rows();
            expect(row.adsBooking).toMatchObject({ fiat: '30', currency: 'USD' });
            expect(validateSettings(w.settings())).toMatchObject({ ok: true });
        });
    }

    it('keys the commit leg apart from the record, once per record', async () => {
        const w = wallet();
        const verdict = { donationIncluded: false, donatedFiat: null, currency: null, mainnet: true, reservationId: null };
        const book = (pendingTxId) => bookLandedCommit({
            vault: w.vault, verdict, encoding: 'P2SH', landedPhase: 'p2sh_spending', pendingTxId,
        });
        await book('rec-1');
        await book('rec-1');
        expect(w.ads().queued).toBe('30.05');
        await book('rec-2');
        expect(w.ads().queued).toBe('30.10');
        expect(w.ads().bookedKeys.queuedDelivery).toEqual(['rec-1:commit', 'rec-2:commit']);
    });

    for (const lane of [ENVELOPE, CHUNK]) {
        it(`books nothing more when a restart resumes a ${lane.encoding} pair booked live`, async () => {
            const w = wallet();
            twoPhase(lane, null);
            await send(w);
            const checkpoint = w.checkpoint();
            expect(checkpoint.adsCommit).toMatchObject({ donationIncluded: true, bookingKey: checkpoint.id });
            await bookQueuedDelivery({ vault: w.vault, chainRegistry, pendingTxId: checkpoint.id, adsCommit: checkpoint.adsCommit });
            expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        });
    }

    it('accrues nothing for a regtest pair', async () => {
        const w = wallet();
        twoPhase(ENVELOPE, null);
        await send(w, 'bitcoin-regtest');
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
    });

    it('still accrues once for a single-transaction send', async () => {
        const w = wallet();
        submitWithSignerMock.mockImplementation(async ({ onProgress }) => {
            onProgress('signing', { encoding: 'OP_RETURN' });
            await onProgress('broadcasting', { txid: 'only-txid', txHex: 'aa' });
            await onProgress('waiting', { txid: 'only-txid' });
            return { txid: 'only-txid', signed: { txHex: 'aa' }, encoding: 'OP_RETURN' };
        });
        await send(w);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
    });
});

describe('a landed commit whose second leg is refused', () => {
    it('settles the payout an envelope commit carried when its reveal is refused for good', async () => {
        const w = wallet();
        twoPhase(ENVELOPE, PERMANENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('releases the payout a refused chunk-lane reveal would have carried and accrues the commit', async () => {
        const w = wallet();
        twoPhase(CHUNK, PERMANENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        expect(w.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('queues an envelope reveal accrue-only once its commit settled the payout', async () => {
        const w = wallet();
        twoPhase(ENVELOPE, TRANSIENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        const [row] = w.rows();
        expect(row.adsCommit).toMatchObject({ donationIncluded: false, reservationId: null, bookingKey: row.id });
        await bookQueuedDelivery({ vault: w.vault, chainRegistry, pendingTxId: row.id, adsCommit: row.adsCommit });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
    });

    it('pays the payout once when a restart resumes the checkpoint after the commit settled it', async () => {
        const w = wallet();
        twoPhase(ENVELOPE, TRANSIENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        const checkpoint = w.checkpoint();
        await bookQueuedDelivery({ vault: w.vault, chainRegistry, pendingTxId: checkpoint.id, adsCommit: checkpoint.adsCommit });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
    });

    it('accrues the queued envelope reveal once more when the core drain delivers it', async () => {
        const w = wallet();
        twoPhase(ENVELOPE, TRANSIENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        const [row] = w.rows();
        expect(row).toMatchObject({ status: 'queued', commitLanded: true });
        const now = vi.spyOn(Date, 'now').mockReturnValue(MAINNET_LAUNCH_EPOCH * 1000 + 1);
        try {
            const out = await drainQueuedBroadcast({
                vault: w.vault, chainRegistry, pendingTxId: row.id,
                sdkRegistry: { get: () => ({ encoder: { broadcastTx: async () => 'reveal-txid' } }) },
            });
            expect(out.broadcast).toBe(true);
        } finally {
            now.mockRestore();
        }
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
    });

    it('queues a chunk-lane reveal with the payout after accruing its landed commit', async () => {
        const w = wallet();
        twoPhase(CHUNK, TRANSIENT);
        await expect(send(w)).rejects.toBeInstanceOf(BroadcastFailedError);
        expect(w.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
        const [row] = w.rows();
        expect(row.adsCommit).toMatchObject({ donationIncluded: true, reservationId: row.id });
        await bookQueuedDelivery({ vault: w.vault, chainRegistry, pendingTxId: row.id, adsCommit: row.adsCommit });
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });
});
