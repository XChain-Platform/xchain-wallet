// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// No double automatic-donation payout across the extension's retry queue
// (§36, 2026-11-14), end to end over ONE vault: submitAction signs a send that
// carries the due donation, its broadcast fails transiently and the extension
// host queues the signed bytes. While they wait, the claim on the queue is
// held in settings.ads.reserved, so a second send carries no payout. The
// queued bytes landing settles the claim once; a discard or a permanent
// refusal releases it, and the next send may carry the payout again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { resolveAdsPayout } from '../../../packages/core/src/flows/ads.js';
import { MAINNET_LAUNCH_EPOCH } from '../../../packages/core/src/flows/mainnetPrelaunch.js';
import { _resetPriceLookupForTests, configureFiatRateSource } from '../../../packages/core/src/flows/priceLookup.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { signedTxFor, trackerFor } from '../../helpers/signedTx.js';

const W = 'w1';
const MAIN = 'bitcoin-mainnet';
const DONATE = 'bc1qdonate-protocol';
const SOURCE = 'bc1qsource';
// The queued bytes must verify against a coin the stand-in tracker knows.
const SIGNED = signedTxFor({ inputs: [{ type: 'p2wpkh' }] });
const DESCRIPTOR = {
    id: MAIN, coin: 'bitcoin', networkKind: 'mainnet',
    adsDonationAddresses: { DONATE1: DONATE, DONATE2: 'bc1qdonate-community', EXPLORER: 'bc1qdonate-explorer' },
    adsDonationAddress: DONATE,
};
const chainRegistry = {
    get: (id) => (id === MAIN ? DESCRIPTOR : undefined),
    list: () => [],
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'mainnet' ? MAIN : null),
};

function memCollection() {
    const m = new Map();
    const copy = (v) => JSON.parse(JSON.stringify(v));
    return {
        get: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        put: async (rec) => { m.set(rec.id, copy(rec)); },
        list: async () => Array.from(m.values()).map(copy),
        delete: async (id) => m.delete(id),
        find: async (id) => (m.has(id) ? copy(m.get(id)) : null),
        findBy: async (k, v) => Array.from(m.values()).filter((r) => r[k] === v).map(copy),
    };
}

// EUR keeps a live build's price on the stubbed CoinGecko path.
function walletVault(ads = {}) {
    const base = createDefaultSettings();
    let settings = {
        ...base,
        fiatCurrency: 'EUR',
        ads: { ...base.ads, currency: 'EUR', queued: '30', sendAt: '25', perTransaction: '0.05', ...ads },
    };
    const vault = {
        pendingTxs: memCollection(),
        wallets: { list: async () => [{ id: W, name: 'Main' }] },
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    return { vault, ads: () => settings.ads, settings: () => settings };
}

// The host's queue storage, seeded by the submit's own onBroadcastFailure
// payload: the path a queued entry takes into a fresh host.
function queueBlob() {
    const blob = { [W]: [] };
    return {
        blob,
        storage: {
            load: async () => JSON.parse(JSON.stringify(blob)),
            save: async (snapshot) => { Object.assign(blob, JSON.parse(JSON.stringify(snapshot))); },
            clear: async () => {},
        },
        enqueue: vi.fn(async (payload) => {
            blob[W].push({ id: `q-${blob[W].length + 1}`, ...JSON.parse(JSON.stringify(payload)) });
            return true;
        }),
    };
}

function makeHost(vault, storage, broadcastTx) {
    const tracker = trackerFor(SIGNED.prevouts, networks.regtest);
    const sdk = {
        encoder: { broadcastTx, getUTXOs: tracker.getUTXOs },
        wallet: { getBitcoinNetwork: () => networks.regtest },
    };
    const host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: storage,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return (type, request) => host.handle({ type, request });
}

// A send whose bytes were composed with the donation folded in (the confirm
// route), and whose first broadcast fails transiently.
function composedSend(vault, onBroadcastFailure, { broadcast = async () => { throw new Error('ECONNREFUSED'); } } = {}) {
    const sdk = {
        encoder: { createTx: vi.fn(), broadcastTx: vi.fn(broadcast) },
        actions: { createAction: vi.fn() },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    return submitAction({
        vault,
        walletId: W,
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId: MAIN,
        actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
        encoderOpts: { pubkey: 'pub' },
        prebuiltPsbt: {
            psbtHex: 'PSBT-A', encoding: 'OP_RETURN', actionString: 'ISSUE|0|JDOG', version: 0,
            deferredFeeOutput: null, deferredOutputs: [],
            adsDonation: { included: true, fiat: '30', currency: 'EUR' },
        },
        pendingTxMeta: { fromAddress: SOURCE, toAddress: 'payee', actionSummary: 'Issue JDOG' },
        signer: { kind: 'software', signPsbt: vi.fn(async () => ({ txHex: SIGNED.txHex, txid: 'txid-A' })) },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        onBroadcastFailure,
    });
}

// A native-coin payment built at submit time (Auto pay, the live lane), which
// folds a due donation at the encoder. Records each build's outputs.
function liveSend(vault, { broadcast = async () => ({}), onBroadcastFailure, refuseSettingsWrite = false } = {}) {
    const seen = [];
    let last = [];
    const sdk = {
        actions: { createAction: vi.fn() },
        encoder: {
            createTx: vi.fn(async (opts) => {
                seen.push((opts.customOutputs || []).map((o) => ({ ...o })));
                last = (opts.customOutputs || []).map((o) => ({ ...o }));
                return { psbt: 'PSBT-LIVE', encoding: 'OP_RETURN' };
            }),
            broadcastTx: vi.fn(broadcast),
        },
        wallet: {
            getBitcoinNetwork: () => ({ dustThreshold: 546 }),
            decomposePsbt: () => ({
                inputs: [{ address: SOURCE, value: 10_000_000_000 }],
                outputs: last.map((o) => ({ address: o.address, value: o.value, scriptType: 'p2wpkh' })),
            }),
        },
    };
    if (refuseSettingsWrite) vault.settings.put.mockImplementation(async () => { throw new Error('vault locked'); });
    const run = submitAction({
        vault,
        walletId: W,
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId: MAIN,
        actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.001', DESTINATION: 'payee' } },
        encoderOpts: { pubkey: 'pub', sourceAddress: SOURCE, change: SOURCE },
        pendingTxMeta: { fromAddress: SOURCE, toAddress: 'payee', actionSummary: 'Send BTC' },
        signer: {
            kind: 'software',
            signPsbt: vi.fn(async ({ psbtHex }) => ({ signedPsbtHex: psbtHex, txHex: SIGNED.txHex, txid: 'txid-live' })),
        },
        signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        verifyBuiltTx: true,
        ...(onBroadcastFailure ? { onBroadcastFailure } : {}),
    });
    const donations = () => seen.map((outputs) => outputs.filter((o) => o.address.startsWith('bc1qdonate')));
    return { run, donations };
}

const coingecko = () => vi.fn(async (url) => (String(url).includes('/simple/price')
    ? { ok: true, status: 200, json: async () => ({ bitcoin: { eur: 100000 } }), headers: new Headers() }
    : { ok: false, status: 404, json: async () => ({}), headers: new Headers() }));
const rateOf = (rate) => vi.fn(async () => ({ rate, stale: false }));

beforeEach(() => {
    _resetPriceLookupForTests();
    configureFiatRateSource({ fetch: coingecko() });
    // An XChain action on mainnet waits for launch: run a day past it.
    vi.spyOn(Date, 'now').mockReturnValue((MAINNET_LAUNCH_EPOCH + 86_400) * 1000);
});
afterEach(() => {
    vi.restoreAllMocks();
    _resetPriceLookupForTests();
});

describe('a send waiting in the retry queue holds the payout', () => {
    it('blocks a second payout while queued, then settles once when the queued bytes land', async () => {
        const w = walletVault();
        const q = queueBlob();

        // 1. The carrying send's first broadcast fails: the host queues it, and
        //    its claim on the donation queue stays held.
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow(/ECONNREFUSED/);
        const [record] = await w.vault.pendingTxs.list();
        expect(record.status).toBe('queued');
        expect(q.blob[W]).toHaveLength(1);
        expect(q.blob[W][0].adsCommit).toEqual({
            chainId: MAIN, donationIncluded: true, donatedFiat: '30', currency: 'EUR', mainnet: true, reservationId: record.id,
        });
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
        expect(w.ads().reserved).toMatchObject({ id: record.id, fiat: '30', currency: 'EUR', chainId: MAIN, pendingTxId: record.id });

        // 2. While it waits, the queue is still due but no other send carries it:
        //    neither the confirm route's plan nor a live build.
        const plan = await resolveAdsPayout({ settings: w.settings(), chainId: MAIN, chainRegistry, rateLoader: rateOf(100000) });
        expect(plan).toMatchObject({ canSubmit: false, reason: 'reserved' });
        const second = liveSend(w.vault);
        await second.run;
        expect(second.donations().flat()).toEqual([]);
        // The second send only accrued; the claim is untouched.
        expect(w.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
        expect(w.ads().reserved?.id).toBe(record.id);

        // 3. The queued bytes land: the claim's amount comes off once, plus the
        //    queued send's own per-transaction amount, and the claim is gone.
        const broadcastTx = vi.fn(async () => ({ txid: 'txid-A' }));
        const call = makeHost(w.vault, q.storage, broadcastTx);
        const res = await call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(broadcastTx).toHaveBeenCalledTimes(1);
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
        expect(await w.vault.pendingTxs.get(record.id)).toMatchObject({ status: 'broadcast' });
    });

    it('releases the claim when the queued send is discarded, so the next send pays', async () => {
        const w = walletVault();
        const q = queueBlob();
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow();
        expect(w.ads().reserved).toBeTruthy();

        const call = makeHost(w.vault, q.storage, vi.fn(async () => ({ txid: 'never' })));
        const res = await call('broadcast.queue.discard', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });

        // The queue is still due and free: the next mainnet send carries it.
        const next = liveSend(w.vault);
        await next.run;
        expect(next.donations()).toEqual([[{ address: DONATE, value: 30000 }]]);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('releases the claim when the queued bytes are refused for good', async () => {
        const w = walletVault();
        const q = queueBlob();
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow();
        const call = makeHost(w.vault, q.storage, vi.fn(async () => {
            throw new Error('rejected: bad-txns-inputs-missingorspent');
        }));
        const res = await call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('BroadcastFailedPermanentError');
        expect(w.ads().reserved).toBeUndefined();
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
    });

    it('settles the claim when a transient retry is answered "already known"', async () => {
        const w = walletVault();
        const q = queueBlob();
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow();
        const call = makeHost(w.vault, q.storage, vi.fn(async () => { throw new Error('txn-already-known'); }));
        const res = await call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id });
        expect(res.ok, JSON.stringify(res.error ?? {})).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a transient retry failure keeps the claim held', async () => {
        const w = walletVault();
        const q = queueBlob();
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow();
        const id = w.ads().reserved.id;
        const call = makeHost(w.vault, q.storage, vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
        expect((await call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id })).ok).toBe(false);
        expect(w.ads().reserved?.id).toBe(id);
        expect(w.ads()).toMatchObject({ queued: '30', donated: '0' });
    });

    it('an entry rebuilt from its PendingTx alone (no verdict) still settles the claim it holds', async () => {
        const w = walletVault();
        const q = queueBlob();
        await expect(composedSend(w.vault, q.enqueue)).rejects.toThrow();
        // A worker restart rebuilt the entry from the vault: no ADS verdict rides it.
        const { adsCommit: _dropped, ...bare } = q.blob[W][0];
        q.blob[W][0] = bare;
        const call = makeHost(w.vault, q.storage, vi.fn(async () => ({ txid: 'txid-A' })));
        expect((await call('broadcast.queue.broadcast', { walletId: W, id: bare.id })).ok).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a live build that carries the payout and is queued settles the same way', async () => {
        const w = walletVault();
        const q = queueBlob();
        const first = liveSend(w.vault, {
            broadcast: async () => { throw new Error('ECONNREFUSED'); },
            onBroadcastFailure: q.enqueue,
        });
        await expect(first.run).rejects.toThrow(/ECONNREFUSED/);
        expect(first.donations()).toEqual([[{ address: DONATE, value: 30000 }]]);
        const [record] = await w.vault.pendingTxs.list();
        expect(q.blob[W][0].adsCommit).toMatchObject({ donationIncluded: true, donatedFiat: '30', reservationId: record.id });
        expect(w.ads().reserved?.id).toBe(record.id);

        // A second live build while it waits carries nothing.
        const second = liveSend(w.vault);
        await second.run;
        expect(second.donations().flat()).toEqual([]);

        const call = makeHost(w.vault, q.storage, vi.fn(async () => ({ txid: 'txid-live' })));
        expect((await call('broadcast.queue.broadcast', { walletId: W, id: q.blob[W][0].id })).ok).toBe(true);
        expect(w.ads()).toMatchObject({ queued: '0.10', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });
});

describe('a claim never blocks or fails a send', () => {
    it('a claim whose PendingTx is gone is let go by the next send, which pays', async () => {
        const w = walletVault({
            reserved: { id: 'lost', fiat: '30', currency: 'EUR', chainId: MAIN, pendingTxId: 'lost', at: 1 },
        });
        const next = liveSend(w.vault);
        await next.run;
        expect(next.donations()).toEqual([[{ address: DONATE, value: 30000 }]]);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a claim whose bytes already broadcast is settled, never paid a second time', async () => {
        const w = walletVault({
            reserved: { id: 'landed', fiat: '30', currency: 'EUR', chainId: MAIN, pendingTxId: 'landed', at: 1 },
        });
        await w.vault.pendingTxs.put({ id: 'landed', chain: 'bitcoin', network: 'mainnet', status: 'broadcast' });
        const next = liveSend(w.vault);
        await next.run;
        // The landed claim paid the 30; this send found the queue below send-at.
        expect(next.donations().flat()).toEqual([]);
        expect(w.ads()).toMatchObject({ queued: '0.05', donated: '30', donationCount: 1 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a dropped donation whose release write fails is cleared unpaid by the landing', async () => {
        const w = walletVault();
        const seen = [];
        const sdk = {
            actions: { createAction: vi.fn() },
            encoder: {
                // The address cannot cover the donation: the build drops it.
                createTx: vi.fn(async (opts) => {
                    const outputs = (opts.customOutputs || []).map((o) => ({ ...o }));
                    seen.push(outputs);
                    if (outputs.some((o) => o.address === DONATE)) throw new Error('Insufficient funds');
                    return { psbt: 'PSBT-LIVE', encoding: 'OP_RETURN' };
                }),
                broadcastTx: vi.fn(async () => ({})),
            },
            wallet: {
                getBitcoinNetwork: () => ({ dustThreshold: 546 }),
                decomposePsbt: () => ({ inputs: [{ address: SOURCE, value: 10_000_000_000 }], outputs: [] }),
            },
        };
        // The claim lands; the release write right after it is refused once.
        const put = w.vault.settings.put.getMockImplementation();
        let writes = 0;
        w.vault.settings.put.mockImplementation(async (r) => {
            writes += 1;
            if (writes === 2) throw new Error('vault busy');
            return put(r);
        });
        await submitAction({
            vault: w.vault,
            walletId: W,
            chainRegistry,
            sdkRegistry: { get: () => sdk },
            chainId: MAIN,
            actionData: { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.001', DESTINATION: 'payee' } },
            encoderOpts: { pubkey: 'pub', sourceAddress: SOURCE, change: SOURCE },
            pendingTxMeta: { fromAddress: SOURCE, toAddress: 'payee', actionSummary: 'Send BTC' },
            signer: { kind: 'software', signPsbt: vi.fn(async ({ psbtHex }) => ({ signedPsbtHex: psbtHex, txHex: SIGNED.txHex, txid: 'txid-live' })) },
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        });
        expect(seen.map((o) => o.some((x) => x.address === DONATE))).toEqual([true, false]);
        // Nothing was paid, the send accrued, and no claim is left holding the queue.
        expect(w.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
        expect(w.ads().reserved).toBeUndefined();
    });

    it('a send still goes out when the claim cannot be written, without the donation', async () => {
        const w = walletVault();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const send = liveSend(w.vault, { refuseSettingsWrite: true });
        const result = await send.run;
        expect(result.txid).toBeTruthy();
        expect(send.donations().flat()).toEqual([]);
        warn.mockRestore();
    });
});
