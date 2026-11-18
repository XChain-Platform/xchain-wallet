// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The auto-pay engine finds an obligation's order match by reading the
// obligation's whole block. The explorer serves 100 matches a page, so a block
// with more matches than that has its older matches on later pages; a match
// the engine never reads is one it can never pay.

import { describe, it, expect, vi } from 'vitest';
import { CoinpayAutopayWatcher } from '../../../packages/core/src/notifications/CoinpayAutopayWatcher.js';
import { readBlockOrderMatches } from '../../../packages/core/src/market/obligationPaging.js';

const NOW = 1_800_000_000_000;

const consentRow = (over = {}) => ({
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
});

const obligationRow = (over = {}) => ({
    action_index: '900',
    payer_address: 'addr-payer',
    payee_address: 'addr-seller',
    coin: 'BTC',
    coin_amount: '0.005',
    expiration: Math.floor(NOW / 1000) + 7000,
    block_index: 100,
    coinpay_status: 'pending_coinpay',
    ...over,
});

const matchRow = (over = {}) => ({
    action_index: '900',
    give_action_index: '600',
    get_action_index: '500',
    give_amount: '0.005',
    get_amount: '100',
    settlement_type: 'coinpay',
    status: 'pending_coinpay',
    ...over,
});

// Matches of no consented order, newest first, as the explorer lists a block.
const filler = (count) => Array.from({ length: count }, (_, i) => matchRow({
    action_index: String(5000 - i), give_action_index: String(7000 + i), get_action_index: String(8000 + i),
}));

function makeVault(consents = [consentRow()]) {
    const autopayStore = new Map(consents.map((r) => [r.id, r]));
    return {
        autopayStore,
        autopayOrders: {
            get: vi.fn(async (id) => autopayStore.get(id) || null),
            put: vi.fn(async (r) => { autopayStore.set(r.id, r); }),
            list: vi.fn(async () => Array.from(autopayStore.values())),
        },
        autopayLeases: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
        pendingTxs: { list: vi.fn(async () => []) },
        addresses: {
            list: vi.fn(async () => [{
                id: 'addr-id-1', chain: 'bitcoin', network: 'regtest', address: 'addr-payer', publicKey: '02ab',
                derivationPath: "m/84'/1'/0'/0/0", source: 'hd', accountId: 'acct-w1',
            }]),
        },
        accounts: { get: vi.fn(async (id) => (id === 'acct-w1' ? { id, walletId: 'w1' } : null)) },
        wallets: { get: vi.fn(async (id) => (id === 'w1' ? { id, importedKeys: [] } : null)) },
    };
}

// An explorer answering a block's matches 100 a page by `page`, with the total.
function pagedMatches(all, { failPage = null, shortPage = null } = {}) {
    return vi.fn(async (_query, _type, opts = {}) => {
        const page = opts.page ?? 1;
        if (page === failPage) throw new Error('explorer down');
        const rows = all.slice((page - 1) * 100, page * 100);
        return { data: page === shortPage ? rows.slice(0, rows.length - 1) : rows, total: all.length };
    });
}

function setup({ matches, obligations = [obligationRow()], consents, getOrderMatches }) {
    const sdk = {
        getStatus: vi.fn(async () => ({ last_block: { RBTC: 101 } })),
        explorer: { coin: 'RBTC' },
        getCoinpayObligations: vi.fn(async () => ({ data: obligations })),
        getOrderMatches: getOrderMatches ?? pagedMatches(matches),
        getTransaction: vi.fn(async () => null),
        onCoinpayRequired: vi.fn(() => () => {}),
    };
    const notify = vi.fn(async () => {});
    const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const coinpayAction = vi.fn(async () => ({ txid: 'paytx1' }));
    const watcher = new CoinpayAutopayWatcher({
        vault: makeVault(consents),
        sdkRegistry: { get: vi.fn(() => sdk) },
        chainRegistry: { get: vi.fn(() => ({ coin: 'bitcoin' })), chainIdFor: vi.fn((chain, network) => `${chain}-${network}`) },
        getSigner: vi.fn(() => ({ id: 'signer-1' })),
        getSettings: vi.fn(async () => ({ notifications: { incomingReceipts: true } })),
        reservationLedger: { reserve: vi.fn(async () => {}), release: vi.fn(async () => {}) },
        notify,
        shellKind: 'web',
        intervalMs: 60_000,
        now: () => NOW,
        coinpayAction,
        logger,
    });
    return { watcher, sdk, notify, logger, coinpayAction };
}

describe('auto-pay block match lookup past the first explorer page', () => {
    it('pays a match that sits on the second page of a 150-match block', async () => {
        const matches = [...filler(149), matchRow()];
        const { watcher, sdk, coinpayAction } = setup({ matches });
        await watcher.pollOnce();

        expect(coinpayAction).toHaveBeenCalledTimes(1);
        expect(coinpayAction.mock.calls[0][0].orderMatchActionIndex).toBe('900');
        expect(sdk.getOrderMatches).toHaveBeenCalledTimes(2);
        expect(sdk.getOrderMatches).toHaveBeenNthCalledWith(1, '100', 'block');
        expect(sdk.getOrderMatches).toHaveBeenNthCalledWith(2, '100', 'block', { page: 2, limit: 100 });
    });

    it('reads a block once per cycle for every obligation in it', async () => {
        const matches = [
            ...filler(148),
            matchRow({ action_index: '901', get_action_index: '501' }),
            matchRow(),
        ];
        const obligations = [obligationRow(), obligationRow({ action_index: '901' })];
        const consents = [consentRow(), consentRow({ id: 'bitcoin-regtest::bb', txid: 'bb', orderActionIndex: '501' })];
        const { watcher, sdk, coinpayAction } = setup({ matches, obligations, consents });
        await watcher.pollOnce();

        expect(coinpayAction).toHaveBeenCalledTimes(2);
        expect(sdk.getOrderMatches).toHaveBeenCalledTimes(2);
    });

    it('waits, neither paying nor notifying, when a later page fails', async () => {
        const matches = [...filler(149), matchRow()];
        const { watcher, coinpayAction, notify } = setup({
            getOrderMatches: pagedMatches(matches, { failPage: 2 }),
            matches,
        });
        await watcher.pollOnce();

        expect(coinpayAction).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
    });

    it('waits when a later page comes back short of the rows the total implies', async () => {
        const matches = [...filler(149), matchRow()];
        const { watcher, coinpayAction } = setup({
            getOrderMatches: pagedMatches(matches, { shortPage: 2 }),
            matches,
        });
        await watcher.pollOnce();

        expect(coinpayAction).not.toHaveBeenCalled();
    });

    it('logs once per match, and does not pay or notify, when the whole block lacks the match', async () => {
        const { watcher, notify, logger, coinpayAction } = setup({ matches: filler(150) });
        await watcher.pollOnce();
        await watcher.pollOnce();

        expect(coinpayAction).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        const lines = logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('is not in block'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('match 900 is not in block 100');
    });

    it('does not log a missing match when the block read itself failed', async () => {
        const { watcher, logger } = setup({
            matches: [],
            getOrderMatches: vi.fn(async () => { throw new Error('explorer down'); }),
        });
        await watcher.pollOnce();

        expect(logger.warn.mock.calls.map((c) => String(c[0])).some((m) => m.includes('is not in block'))).toBe(false);
    });
});

describe('readBlockOrderMatches', () => {
    it('makes one plain read for a block that fits one page', async () => {
        const sdk = { getOrderMatches: vi.fn(async () => ({ data: filler(3), total: 3 })) };
        const rows = await readBlockOrderMatches(sdk, 7);
        expect(rows).toHaveLength(3);
        expect(sdk.getOrderMatches).toHaveBeenCalledTimes(1);
        expect(sdk.getOrderMatches).toHaveBeenCalledWith('7', 'block');
    });

    it('treats a reply with no total as the whole block, like a bare list', async () => {
        const sdk = { getOrderMatches: vi.fn(async () => ({ data: filler(100) })) };
        expect(await readBlockOrderMatches(sdk, 7)).toHaveLength(100);
        expect(sdk.getOrderMatches).toHaveBeenCalledTimes(1);
    });

    it('refuses a block whose first page is not a full page when the total says more', async () => {
        const sdk = { getOrderMatches: vi.fn(async () => ({ data: filler(40), total: 150 })) };
        await expect(readBlockOrderMatches(sdk, 7)).rejects.toThrow(/cannot be read whole/);
    });

    it('refuses a block deeper than the page cap rather than returning a short list', async () => {
        const sdk = { getOrderMatches: vi.fn(async () => ({ data: filler(100), total: 100 * 51 })) };
        await expect(readBlockOrderMatches(sdk, 7)).rejects.toThrow(/cannot be read whole/);
        expect(sdk.getOrderMatches).toHaveBeenCalledTimes(1);
    });
});
