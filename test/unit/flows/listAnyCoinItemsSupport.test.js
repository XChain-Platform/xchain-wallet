// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    anyCoinItemCoins,
    listAnyCoinItemsSupport,
} from '../../../packages/core/src/flows/listAnyCoinItemsSupport.js';
import { tickerForCoin } from '../../../packages/core/src/registry/coinTicker.js';

// Quoted from xchain-indexer/src/config/currencies.js (config['COINS']): the
// coins its list-item check accepts once the gate is open. If the indexer's set
// changes, WALLET_COINS and this quote change with it.
const INDEXER_COINS = ['BTC', 'LTC', 'DOGE'];
const REGTEST_BTC = { coin: 'bitcoin', networkKind: 'regtest' };

const TESTNET_BTC = { coin: 'bitcoin', networkKind: 'testnet' };

function registryWith(getStatus) {
    return { get: () => ({ explorer: { coin: 'TBTC', getStatus } }) };
}

describe('anyCoinItemCoins', () => {
    it('lists every coin the status carries on the same network when the chain flag is true', () => {
        const status = { list_any_coin_items: { TBTC: true, TLTC: true, TDOGE: false } };
        expect(anyCoinItemCoins(status, TESTNET_BTC)).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
    });

    it('never widens to a coin the status only lists on another network', () => {
        // Flags for other networks never change the answer; the set is the fixed one.
        const status = { list_any_coin_items: { TBTC: true, RLTC: true, LTC: false } };
        expect(anyCoinItemCoins(status, TESTNET_BTC)).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
    });

    it('does not depend on which other coins the explorer measures', () => {
        const status = { list_any_coin_items: { RBTC: true, BTC: false } };
        expect(anyCoinItemCoins(status, REGTEST_BTC)).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
        expect(anyCoinItemCoins({ list_any_coin_items: { TBTC: true } }, TESTNET_BTC))
            .toEqual(['bitcoin', 'litecoin', 'dogecoin']);
    });

    it('matches the coin set the indexer accepts', () => {
        const coins = anyCoinItemCoins({ list_any_coin_items: { TBTC: true } }, TESTNET_BTC);
        expect(coins.map(tickerForCoin)).toEqual(INDEXER_COINS);
    });

    it('hands back a copy, so a caller cannot change the shared set', () => {
        const status = { list_any_coin_items: { TBTC: true } };
        anyCoinItemCoins(status, TESTNET_BTC).push('monero');
        expect(anyCoinItemCoins(status, TESTNET_BTC)).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
    });

    it('keeps the empty answer on a regtest chain whose own flag is not true', () => {
        const status = { list_any_coin_items: { RBTC: false, RLTC: true } };
        expect(anyCoinItemCoins(status, REGTEST_BTC)).toEqual([]);
    });

    it.each([
        ['false', { list_any_coin_items: { TBTC: false, TLTC: true } }],
        ['a truthy non-boolean', { list_any_coin_items: { TBTC: 'true', TLTC: true } }],
        ['absent for this chain', { list_any_coin_items: { TLTC: true } }],
        ['an older explorer with no field', { last_block: { TBTC: 10 } }],
        ['no body', null],
    ])('answers [] when the flag is %s', (_label, status) => {
        expect(anyCoinItemCoins(status, TESTNET_BTC)).toEqual([]);
    });
});

describe('listAnyCoinItemsSupport', () => {
    it('reads the gate through the chain SDK explorer client', async () => {
        const getStatus = vi.fn().mockResolvedValue({ list_any_coin_items: { TBTC: true, TDOGE: true } });
        const coins = await listAnyCoinItemsSupport({
            sdkRegistry: registryWith(getStatus), chainId: 'bitcoin-testnet', ...TESTNET_BTC,
        });
        expect(coins).toEqual(['bitcoin', 'litecoin', 'dogecoin']);
        expect(getStatus).toHaveBeenCalledOnce();
    });

    it('answers [] when the status read throws', async () => {
        const coins = await listAnyCoinItemsSupport({
            sdkRegistry: registryWith(async () => { throw new Error('boom'); }),
            chainId: 'bitcoin-testnet', ...TESTNET_BTC,
        });
        expect(coins).toEqual([]);
    });

    it('answers [] for an SDK with no explorer client', async () => {
        const coins = await listAnyCoinItemsSupport({
            sdkRegistry: { get: () => ({}) }, chainId: 'bitcoin-testnet', ...TESTNET_BTC,
        });
        expect(coins).toEqual([]);
    });
});
