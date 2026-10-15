// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { expect, test } from 'vitest';

import { priceStubBody } from '../../e2e/fixtures/priceStub.js';

const BASE = 'https://api.coingecko.com/api/v3';

test('a spot request is answered for every id and currency asked', () => {
    const body = priceStubBody(`${BASE}/simple/price?ids=bitcoin,unknowncoin&vs_currencies=usd,eur`);
    expect(Object.keys(body)).toEqual(['bitcoin', 'unknowncoin']);
    expect(body.bitcoin.usd).toBe(65000);
    expect(body.bitcoin.eur).toBe(65000);
    expect(body.unknowncoin.usd).toBeGreaterThan(0);
});

test('a chart request gets a price series', () => {
    const body = priceStubBody(`${BASE}/coins/bitcoin/market_chart?vs_currency=usd&days=7`);
    expect(body.prices.length).toBeGreaterThan(1);
});
