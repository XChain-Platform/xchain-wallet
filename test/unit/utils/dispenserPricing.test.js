// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The shared dispenser price text and open-offer test every dispenser list
// uses. Rows are shaped as the explorer's list lanes serve them: decimal
// strings, GET_AMOUNT 0 on a fiat-priced dispenser, no FIAT_CODE.

import { describe, it, expect } from 'vitest';
import {
    DISPENSER_PRICE_STALE_MESSAGE,
    dispenserRateLabel,
    isOpenOffer,
    isOpenDispenserSelling,
} from '../../../packages/core/src/shared/utils/dispenserPricing.js';

const ORACLE = 'ndDEAAsomeoracleaddresssomeoracleaddress01';
const MODE_B = {
    give_tick: 'MGRTEST', give_amount: '1', get_coin: 'DOGE', get_tick: null, get_amount: '0',
    oracle_address: ORACLE,
};
const FEED = { tick: 'MGRTEST', fiat: 'USD', live: { value: '0.05' } };

describe('dispenserRateLabel', () => {
    it('quotes a fixed coin price as served', () => {
        expect(dispenserRateLabel({ give_tick: 'DOGI', give_amount: '1000', get_coin: 'BTC', get_amount: '0.01' }))
            .toBe('1,000 DOGI per 0.01 BTC');
    });

    it('prices a Mode B fill from the oracle feed, never as zero coin', () => {
        expect(dispenserRateLabel(MODE_B, [FEED])).toBe('1 MGRTEST per 0.05 USD (oracle ndDEAA…ss01)');
        expect(dispenserRateLabel({ ...MODE_B, give_amount: '5' }, [FEED])).toMatch(/5 MGRTEST per 0\.25 USD/);
    });

    it('says the oracle is stale when its feed has no live price', () => {
        expect(dispenserRateLabel(MODE_B, [{ ...FEED, live: null }])).toMatch(/USD \(oracle .*\): no current price, stale/);
    });

    it('never prints zero coin while the feed is unread or unreadable', () => {
        expect(dispenserRateLabel(MODE_B, undefined)).toMatch(/oracle-set price \(checking/);
        expect(dispenserRateLabel(MODE_B, null)).toMatch(/open the dispenser for the price/);
        expect(dispenserRateLabel(MODE_B, null)).not.toMatch(/\b0 DOGE\b/);
    });

    it('uses a served FIAT_CODE to pick between two feeds for the same tick', () => {
        const feeds = [FEED, { tick: 'MGRTEST', fiat: 'EUR', live: { value: '0.04' } }];
        expect(dispenserRateLabel(MODE_B, feeds)).toMatch(/open the dispenser for the price/);
        expect(dispenserRateLabel({ ...MODE_B, fiat_code: 'EUR' }, feeds)).toMatch(/0\.04 EUR/);
    });

    it('states a Mode A fixed fiat amount when the row carries one', () => {
        const modeA = { ...MODE_B, oracle_address: null, fiat_code: 'USD', fiat_amount: '3' };
        expect(dispenserRateLabel(modeA)).toBe('1 MGRTEST per 3 USD');
        expect(dispenserRateLabel({ ...modeA, fiat_amount: null, fiat_code: null }))
            .toMatch(/priced in fiat: open the dispenser/);
    });

    it('uses the served stale-price state only when it is explicitly true', () => {
        expect(dispenserRateLabel({ ...MODE_B, price_stale: true }, [FEED]))
            .toBe(DISPENSER_PRICE_STALE_MESSAGE);
        expect(dispenserRateLabel({ ...MODE_B, price_stale: false }, [FEED]))
            .toBe('1 MGRTEST per 0.05 USD (oracle ndDEAA…ss01)');
        expect(dispenserRateLabel(MODE_B, [FEED]))
            .toBe('1 MGRTEST per 0.05 USD (oracle ndDEAA…ss01)');
    });
});

describe('isOpenDispenserSelling', () => {
    it('keeps a row whose status is the explorer string label', () => {
        expect(isOpenDispenserSelling({ status: 'valid', give_tick: 'X' }, 'X')).toBe(true);
    });

    it('lets the lifecycle overrule the frozen create status', () => {
        expect(isOpenDispenserSelling({ status: 'valid', current_status: 'open', give_tick: 'X' }, 'X')).toBe(true);
        expect(isOpenDispenserSelling({ status: 'valid', current_status: 'cancelled', give_tick: 'X' }, 'X')).toBe(false);
    });

    it('drops a dispenser priced IN the tick, which buys it rather than sells it', () => {
        expect(isOpenDispenserSelling({ status: 'valid', give_tick: 'OTHER', get_tick: 'X' }, 'X')).toBe(false);
        expect(isOpenDispenserSelling({ status: 'valid', give_tick: 'OTHER' }, '^1234')).toBe(true);
    });

    it('drops an invalid create', () => {
        expect(isOpenDispenserSelling({ status: 'invalid: insufficient funds', give_tick: 'X' }, 'X')).toBe(false);
    });
});

describe('isOpenOffer', () => {
    it('accepts valid create rows and lets lifecycle status overrule them', () => {
        expect(isOpenOffer({ status: 'valid' })).toBe(true);
        expect(isOpenOffer({ status: 'valid', order_status: 'open' })).toBe(true);
        expect(isOpenOffer({ status: 'valid', order_status: 'cancelled' })).toBe(false);
        expect(isOpenOffer({ status: 'valid', swap_status: 'settled' })).toBe(false);
    });

    it('rejects an invalid create row', () => {
        expect(isOpenOffer({ status: 'invalid: expired' })).toBe(false);
    });
});
