// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A send whose worker dies inside the broadcast request leaves its PendingTx at
// the 'broadcasting' checkpoint. Restart recovery re-sends those bytes from the
// record, so the record has to carry the donation verdict the send was composed
// under, and the normal booking and the recovered one have to share a durable
// key so a send booked just before the worker died is never booked twice.
// Each case drives the real submitAction to the checkpoint and hands the
// record it wrote to the real recovery consumers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitAction } from '../../../../packages/core/src/flows/submitAction.js';
import { drainQueuedBroadcast } from '../../../../packages/core/src/flows/queuedBroadcast.js';
import { bookQueuedDelivery } from '../../../../packages/core/src/flows/adsDelivery.js';
import {
    _resetPriceLookupForTests,
    configureFiatRateSource,
} from '../../../../packages/core/src/flows/priceLookup.js';
import { createDefaultSettings } from '../../../../packages/core/src/schemas/settings.js';
import { validatePendingTx } from '../../../../packages/core/src/schemas/pendingTx.js';
import { createBroadcastQueueEngine } from '../../../../packages/extension/src/background/broadcastQueueEngine.js';
import { createBroadcastQueueStore } from '../../../../packages/extension/src/background/broadcastQueueStore.js';

const SOURCE = 'source-address';
const TXID = 'a'.repeat(64);
const DESCRIPTORS = {
    'bitcoin-mainnet': { id: 'bitcoin-mainnet', coin: 'bitcoin', networkKind: 'mainnet', adsDonationAddresses: { DONATE1: 'btc-protocol', DONATE2: 'btc-community', EXPLORER: 'btc-explorer' }, adsDonationAddress: 'btc-protocol' },
    'bitcoin-regtest': { id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest', adsDonationAddresses: { DONATE1: 'r-protocol', DONATE2: 'r-community', EXPLORER: 'r-explorer' }, adsDonationAddress: 'r-protocol' },
};
const chainRegistry = {
    get: (id) => DESCRIPTORS[id],
    chainIdFor: (coin, network) => Object.values(DESCRIPTORS)
        .find((d) => d.coin === coin && d.networkKind === network)?.id ?? null,
};

function priceFetch() {
    return vi.fn(async () => ({
        ok: true, status: 200, headers: new Headers(), json: async () => ({ bitcoin: { eur: 100000 } }),
    }));
}

// Settings plus a PendingTx table that keeps every write, so a case can read
// the record exactly as the checkpoint left it.
function wallet(ads) {
    const base = createDefaultSettings();
    let settings = { ...base, fiatCurrency: 'EUR', ads: { ...base.ads, currency: 'EUR', ...ads } };
    const rows = new Map();
    const writes = [];
    const copy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    const vault = {
        settings: { get: async () => copy(settings), put: async (r) => { settings = copy(r); } },
        pendingTxs: {
            put: async (r) => { rows.set(r.id, copy(r)); writes.push(copy(r)); },
            get: async (id) => copy(rows.get(id) ?? null),
            findBy: async (k, v) => [...rows.values()].filter((r) => r[k] === v).map(copy),
        },
        accounts: { findBy: async () => [{ id: 'acct-1', walletId: 'w1' }] },
        addresses: { list: async () => [{ id: 'addr-1', accountId: 'acct-1', address: SOURCE }] },
    };
    return { vault, ads: () => settings.ads, writes, restore: (r) => rows.set(r.id, copy(r)) };
}

function chainSdk(broadcastTx) {
    let last = [];
    return {
        actions: { createAction: vi.fn() },
        encoder: {
            createTx: vi.fn(async (opts) => {
                last = (opts.customOutputs || []).map((o) => ({ ...o }));
                return { psbt: 'PSBTHEX', encoding: 'OP_RETURN' };
            }),
            broadcastTx,
        },
        wallet: {
            getBitcoinNetwork: () => ({ dustThreshold: 546 }),
            decomposePsbt: () => ({
                inputs: [{ address: SOURCE, value: 10_000_000_000 }],
                outputs: last.map((o) => ({ address: o.address, value: o.value, scriptType: 'p2wpkh' })),
            }),
        },
    };
}

function send(w, chainId, sdk) {
    return submitAction({
        vault: w.vault,
        walletId: 'w1',
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId,
        actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.001', DESTINATION: 'payee' } },
        encoderOpts: { pubkey: 'pub', sourceAddress: SOURCE, change: SOURCE },
        signer: {
            kind: 'software',
            signPsbt: vi.fn(async ({ psbtHex }) => ({ signedPsbtHex: psbtHex, txHex: '02000000', txid: TXID })),
        },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        pendingTxMeta: { fromAddress: SOURCE, toAddress: 'payee', actionSummary: 'Send' },
    });
}

// Run a send until its bytes are handed to the network, which never answers:
// the worker dies there. Returns the record the checkpoint wrote.
async function interruptedAtCheckpoint(w, chainId) {
    const broadcastTx = vi.fn(() => new Promise(() => {}));
    void send(w, chainId, chainSdk(broadcastTx)).catch(() => {});
    await vi.waitFor(() => expect(broadcastTx).toHaveBeenCalled());
    const checkpoint = w.writes.filter((r) => r.status === 'broadcasting').at(-1);
    expect(checkpoint).toBeTruthy();
    return checkpoint;
}

const landed = () => vi.fn(async () => ({}));
const alreadyKnown = () => vi.fn(async () => { throw new Error('rejected: txn-already-known'); });

function drain(w, checkpoint, broadcastTx) {
    return drainQueuedBroadcast({
        vault: w.vault, chainRegistry, pendingTxId: checkpoint.id, sdkRegistry: { get: () => chainSdk(broadcastTx) },
    });
}

beforeEach(() => {
    _resetPriceLookupForTests();
    configureFiatRateSource({ fetch: priceFetch(), now: () => Date.now() });
});
afterEach(() => _resetPriceLookupForTests());

describe('a mainnet send interrupted at the broadcasting checkpoint', () => {
    it('checkpoints the compose-time verdict under the record id, in a shape the schema accepts', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        const checkpoint = await interruptedAtCheckpoint(w, 'bitcoin-mainnet');
        expect(checkpoint.adsCommit).toMatchObject({
            chainId: 'bitcoin-mainnet', donationIncluded: false, mainnet: true, bookingKey: checkpoint.id,
        });
        expect(validatePendingTx(checkpoint).ok).toBe(true);
    });

    it('accrues once when the core drain resumes it and the bytes land', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        const checkpoint = await interruptedAtCheckpoint(w, 'bitcoin-mainnet');
        await drain(w, checkpoint, landed());
        expect(w.ads().queued).toBe('0.05');
    });

    it('accrues once when the resumed bytes are already known to the node', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        const checkpoint = await interruptedAtCheckpoint(w, 'bitcoin-mainnet');
        await drain(w, checkpoint, alreadyKnown());
        expect(w.ads().queued).toBe('0.05');
    });

    it('settles the held payout and accrues once when the send carried the donation', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20', queued: '20' });
        const checkpoint = await interruptedAtCheckpoint(w, 'bitcoin-mainnet');
        expect(checkpoint.adsCommit).toMatchObject({ donationIncluded: true, reservationId: checkpoint.id });
        await drain(w, checkpoint, landed());
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '20', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('accrues once through the extension restore and its delivery booking', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        await interruptedAtCheckpoint(w, 'bitcoin-mainnet');
        await new Promise((r) => setTimeout(r, 5));
        const engine = createBroadcastQueueEngine({
            store: createBroadcastQueueStore({ storage: null, prunedLedger: null }),
            importedAddressIdsFor: async () => new Set(),
            discardQueuedBroadcast: async () => {},
        });
        await engine.ensureQueueLoaded();
        await engine.restoreQueueFromVault(w.vault, chainRegistry, 'w1');
        const [entry] = engine.getQueue('w1');
        expect(entry).toMatchObject({ resumedClaim: true });
        await bookQueuedDelivery({ vault: w.vault, chainRegistry, pendingTxId: entry.pendingTxId, adsCommit: entry.adsCommit });
        expect(w.ads().queued).toBe('0.05');
    });
});

describe('the normal booking and the recovered booking share one key', () => {
    it('does not accrue again when a send booked before its broadcast status was written is resumed', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        await send(w, 'bitcoin-mainnet', chainSdk(landed()));
        expect(w.ads().queued).toBe('0.05');
        // The worker died after the booking and before the 'broadcast' write:
        // the record on disk is still the checkpoint.
        const checkpoint = w.writes.filter((r) => r.status === 'broadcasting').at(-1);
        w.restore(checkpoint);
        await drain(w, checkpoint, alreadyKnown());
        expect(w.ads().queued).toBe('0.05');
    });

    it('accrues nothing for a regtest send on either path', async () => {
        const w = wallet({ perTransaction: '0.05', sendAt: '20' });
        const checkpoint = await interruptedAtCheckpoint(w, 'bitcoin-regtest');
        await drain(w, checkpoint, landed());
        await send(w, 'bitcoin-regtest', chainSdk(landed()));
        expect(w.ads().queued).toBe('0');
        expect(w.ads().bookedKeys).toBeUndefined();
    });
});
