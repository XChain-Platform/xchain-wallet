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
        const status = { list_any_coin_items: { TBTC: true, RLTC: true, LTC: false } };
        expect(anyCoinItemCoins(status, TESTNET_BTC)).toEqual(['bitcoin']);
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
        expect(coins).toEqual(['bitcoin', 'dogecoin']);
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
