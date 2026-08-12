// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-16 engine tests (§14 rule 4): the payer lease, locked-session
// fallback, reservation lifecycle, and duplicate defenses are
// cross-shell/session behaviors no regtest run can exercise, so they
// are pinned here with mocked vault/SDK/ledger and a driven clock.
// pollOnce() is called directly; no real timers, no network.

import { describe, it, expect, vi } from 'vitest';
import { CoinpayAutopayWatcher, pendingTxReferencesMatch } from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';
import { PAYER_LEASE_ID } from '../../../packages/core/src/schemas/autopayLease.js';

const NOW = 1_800_000_000_000; // ms

function consentRow(over = {}) {
    return {
        schemaVersion: 1,
        id: 'bitcoin-regtest::aa',
        walletId: 'w1',
        chainId: 'bitcoin-regtest',
        sourceAddress: 'addr-payer',
        txid: 'aa',
        orderActionIndex: '500',
        giveCoinAmount: '0.05',
        getTick: 'PEPE',
        getAmount: '1000',
        autopay: true,
        payments: [],
        createdAt: new Date(0).toISOString(),
        ...over,
    };
}

function obligationRow(over = {}) {
    return {
        action_index: '900',
        payer_address: 'addr-payer',
        payee_address: 'addr-seller',
        coin: 'BTC',
        coin_amount: '500000',
        expiration: Math.floor(NOW / 1000) + 7000,
        block_index: 100,
        coinpay_status: 'pending_coinpay',
        ...over,
    };
}

function matchRow(over = {}) {
    return {
        action_index: '900',
        // The row's two column families do NOT pair up: the amounts are the
        // TRIGGERING order's give/get and that order is get_action_index, while
        // give_action_index names the counterparty (xchain-indexer db.js
        // createOrderMatch). This fixture was written the other way round, which
        // is how orientMatch's inversion survived: the consented order '500' owes
        // the COIN, so it must be the side whose give_amount is the coin fill.
        give_action_index: '600', // the counterparty
        get_action_index: '500',  // the consented order, which triggered the match
        give_amount: '0.005',     // its give: the coin fill
        get_amount: '100',        // its get: the token fill
        settlement_type: 'coinpay',
        status: 'pending_coinpay',
        ...over,
    };
}

function makeVault({ consents = [consentRow()], lease = null, pendingTxs = [], addresses } = {}) {
    const autopayStore = new Map(consents.map((r) => [r.id, r]));
    const leaseStore = new Map(lease ? [[lease.id, lease]] : []);
    const addressRows = addresses ?? [{
        id: 'addr-id-1',
        chain: 'bitcoin',
        network: 'regtest',
        address: 'addr-payer',
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
    }];
    return {
        autopayStore,
        leaseStore,
        autopayOrders: {
            get: vi.fn(async (id) => autopayStore.get(id) || null),
            put: vi.fn(async (r) => { autopayStore.set(r.id, r); }),
            list: vi.fn(async () => Array.from(autopayStore.values())),
        },
        autopayLeases: {
            get: vi.fn(async (id) => leaseStore.get(id) || null),
            put: vi.fn(async (r) => { leaseStore.set(r.id, r); }),
        },
        pendingTxs: { list: vi.fn(async () => pendingTxs) },
        addresses: { list: vi.fn(async () => addressRows) },
    };
}

function makeSdkRegistry({ obligations = [obligationRow()], matches = [matchRow()], tip = 101 } = {}) {
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: tip } })),
        explorer: { coin: 'RBTC' },
        getCoinpayObligations: vi.fn(async () => ({ data: obligations })),
        getOrderMatches: vi.fn(async () => ({ data: matches })),
        getTransaction: vi.fn(async () => null),
        onCoinpayRequired: vi.fn(() => () => {}),
    };
    return { sdk, registry: { get: vi.fn(() => sdk) } };
}

const chainRegistry = {
    get: vi.fn(() => ({ coin: 'bitcoin' })),
    chainIdFor: vi.fn((chain, network) => `${chain}-${network}`),
};

function makeWatcher(over = {}) {
    const vault = over.vault ?? makeVault();
    const { registry } = over.sdkRegistryPair ?? makeSdkRegistry();
    const ledger = { reserve: vi.fn(async () => {}), release: vi.fn(async () => {}) };
    const notify = vi.fn(async () => {});
    const signer = over.signer === undefined ? { id: 'signer-1' } : over.signer;
    const coinpayAction = over.coinpayAction ?? vi.fn(async ({ onProgress }) => {
        onProgress?.('broadcast');
        return { txid: 'paytx1' };
    });
    const watcher = new CoinpayAutopayWatcher({
        vault,
        sdkRegistry: over.sdkRegistry ?? registry,
        chainRegistry,
        getSigner: vi.fn(() => signer),
        reservationLedger: ledger,
        notify,
        shellKind: over.shellKind ?? 'web',
        intervalMs: 60_000,
        now: () => over.now ?? NOW,
        coinpayAction,
    });
    return { watcher, vault, ledger, notify, coinpayAction };
}

describe('happy path', () => {
    it('pays a confirmed match: reserve, sign via injected signer, ledger the payment, notify', async () => {
        const { watcher, vault, ledger, notify, coinpayAction } = makeWatcher();
        await watcher.pollOnce();

        expect(ledger.reserve).toHaveBeenCalledTimes(1);
        const hold = ledger.reserve.mock.calls[0][0];
        expect(hold.id).toBe('autopay:bitcoin-regtest:900');
        expect(hold.chainId).toBe('bitcoin-regtest');

        expect(coinpayAction).toHaveBeenCalledTimes(1);
        const call = coinpayAction.mock.calls[0][0];
        expect(call.orderMatchActionIndex).toBe('900');
        expect(call.payeeAddress).toBe('addr-seller');
        expect(String(call.coinAmount)).toBe('500000');
        expect(call.signer).toEqual({ id: 'signer-1' });
        expect(call.from.address).toBe('addr-payer');
        expect(call.actionSummary).toContain('Auto-paid match #900');

        const consent = vault.autopayStore.get('bitcoin-regtest::aa');
        expect(consent.payments).toHaveLength(1);
        expect(consent.payments[0]).toMatchObject({ orderMatchActionIndex: '900', txid: 'paytx1' });

        expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'coinpaid'.replace('coinpaid', 'coinpay-autopaid') }));
        // Broadcast alone never releases the hold.
        expect(ledger.release).not.toHaveBeenCalled();
    });

    it('claims the payer lease on a clean vault and renews its own', async () => {
        const { watcher, vault } = makeWatcher();
        await watcher.pollOnce();
        const lease = vault.leaseStore.get(PAYER_LEASE_ID);
        expect(lease).toBeTruthy();
        expect(lease.shellKind).toBe('web');
        await watcher.pollOnce();
        expect(vault.leaseStore.get(PAYER_LEASE_ID).holderId).toBe(lease.holderId);
    });
});

describe('single active payer', () => {
    it('stays notify-only (no payment, no notification) while a foreign lease is live', async () => {
        const vault = makeVault({
            lease: {
                schemaVersion: 1, id: PAYER_LEASE_ID, holderId: 'other-instance',
                shellKind: 'web', renewedAt: new Date(NOW - 1000).toISOString(),
            },
        });
        const { watcher, ledger, notify, coinpayAction } = makeWatcher({ vault });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        expect(ledger.reserve).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        expect(vault.leaseStore.get(PAYER_LEASE_ID).holderId).toBe('other-instance');
    });

    it('takes over an expired lease (3 unrenewed cycles) and pays', async () => {
        const vault = makeVault({
            lease: {
                schemaVersion: 1, id: PAYER_LEASE_ID, holderId: 'dead-instance',
                shellKind: 'desktop', renewedAt: new Date(NOW - 3 * 60_000 - 1).toISOString(),
            },
        });
        const { watcher, coinpayAction } = makeWatcher({ vault });
        await watcher.pollOnce();
        expect(coinpayAction).toHaveBeenCalledTimes(1);
        expect(vault.leaseStore.get(PAYER_LEASE_ID).holderId).not.toBe('dead-instance');
    });
});

describe('signing fallbacks', () => {
    it('locked session (no signer): high-urgency manual notification, no payment', async () => {
        const { watcher, notify, coinpayAction, ledger } = makeWatcher({ signer: null });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        expect(ledger.reserve).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            kind: 'coinpay-autopay-manual',
            data: expect.objectContaining({ reason: 'locked', urgency: 'high' }),
        }));
        expect(watcher.statusSnapshot()).toMatchObject({ payer: true, armed: 1, unsignable: ['w1'] });
    });

    it('source address no longer in the vault: manual notification, no payment', async () => {
        const vault = makeVault({ addresses: [] });
        const { watcher, notify, coinpayAction } = makeWatcher({ vault });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ reason: 'source-missing' }),
        }));
    });
});

describe('duplicate and failure defenses', () => {
    it('an own pendingTx for the match counts as attempted: no second payment', async () => {
        const vault = makeVault({
            pendingTxs: [{
                action: 'COINPAY', status: 'broadcast',
                actionSummary: 'Pay COINPAY: 500000 (base units) for ORDER_MATCH #900',
                params: null,
            }],
        });
        const { watcher, coinpayAction, notify } = makeWatcher({ vault });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        // alreadyAttempted + >30min left = wait quietly for settlement.
        expect(notify).not.toHaveBeenCalled();
    });

    // The restart half. submitWithSigner now AWAITS the durable
    // 'broadcasting' put before broadcastTx, so any transaction the network could
    // have accepted has left this exact row behind. This watcher is a fresh instance
    // with an empty _attempted set - the restarted process - and the durable row is
    // the only thing standing between the match and a second payment.
    it("a durable 'broadcasting' row blocks the payment after a restart", async () => {
        const vault = makeVault({
            pendingTxs: [{
                action: 'COINPAY', status: 'broadcasting',
                actionSummary: 'Auto-paid match #900 for order #7',
                params: null,
            }],
        });
        const { watcher, coinpayAction } = makeWatcher({ vault });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
    });

    it('compose failure before broadcast frees the attempt and the hold; balance-short is classified', async () => {
        const failing = vi.fn(async () => { throw new Error('Insufficient funds for output + fee'); });
        const { watcher, ledger, notify } = makeWatcher({ coinpayAction: failing });
        await watcher.pollOnce();
        expect(ledger.reserve).toHaveBeenCalledTimes(1);
        expect(ledger.release).toHaveBeenCalledTimes(1); // nothing left the wallet
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Match found, balance short',
            data: expect.objectContaining({ reason: 'balance-short' }),
        }));
        // Retry allowed on the next cycle (attempt freed); notification deduped.
        notify.mockClear();
        await watcher.pollOnce();
        expect(failing).toHaveBeenCalledTimes(2);
        expect(notify).not.toHaveBeenCalled();
    });

    it('failure AFTER broadcast keeps the attempt and the hold (unknown chain state)', async () => {
        const failing = vi.fn(async ({ onProgress }) => {
            onProgress?.('broadcasting');
            throw new Error('socket hang up');
        });
        const { watcher, ledger } = makeWatcher({ coinpayAction: failing });
        await watcher.pollOnce();
        expect(ledger.release).not.toHaveBeenCalled();
        await watcher.pollOnce();
        expect(failing).toHaveBeenCalledTimes(1); // attempted stays set
    });
});

describe('policy degradation paths', () => {
    it('never pays when the explorer omits match fill amounts (pre-PC-16 explorer)', async () => {
        const pair = makeSdkRegistry({ matches: [matchRow({ give_amount: undefined, get_amount: undefined })] });
        const { watcher, notify, coinpayAction } = makeWatcher({ sdkRegistryPair: pair });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        expect(notify).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ reason: 'amounts-unavailable' }),
        }));
    });

    it('waits below confirm depth without notifying', async () => {
        const pair = makeSdkRegistry({ tip: 100 }); // depth 1
        const { watcher, notify, coinpayAction } = makeWatcher({ sdkRegistryPair: pair });
        await watcher.pollOnce();
        expect(coinpayAction).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('releases the hold when the obligation later leaves pending', async () => {
        const pair = makeSdkRegistry();
        const { watcher, ledger } = makeWatcher({ sdkRegistryPair: pair });
        await watcher.pollOnce();
        expect(ledger.release).not.toHaveBeenCalled();
        pair.sdk.getCoinpayObligations.mockImplementation(async () => ({
            data: [obligationRow({ coinpay_status: 'fulfilled' })],
        }));
        await watcher.pollOnce();
        expect(ledger.release).toHaveBeenCalledWith('autopay:bitcoin-regtest:900');
    });
});

describe('pendingTxReferencesMatch', () => {
    it('matches structured params first, then both summary wordings, never other actions', () => {
        expect(pendingTxReferencesMatch(
            { action: 'COINPAY', params: { ORDER_MATCH_ACTION_INDEX: '900' } }, '900')).toBe(true);
        expect(pendingTxReferencesMatch(
            { action: 'COINPAY', actionSummary: 'Pay COINPAY: 1 (base units) for ORDER_MATCH #900' }, '900')).toBe(true);
        expect(pendingTxReferencesMatch(
            { action: 'COINPAY', actionSummary: 'Auto-paid match #900 for order #500' }, '900')).toBe(true);
        expect(pendingTxReferencesMatch(
            { action: 'COINPAY', actionSummary: 'Auto-paid match #9001 for order #500' }, '900')).toBe(false);
        expect(pendingTxReferencesMatch(
            { action: 'SEND', actionSummary: 'ORDER_MATCH #900' }, '900')).toBe(false);
    });
});
