// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// Unit: test/e2e/global-setup.regtest.js - the order of the gas ISSUE and the price seed.
//
// On a re-genesised Bitcoin venue whose own hub finalizes price rounds, XCHAIN/USD
// cannot exist until XCHAIN is issued, so a setup that seeds the price first refuses
// at the seed and never issues the token. These cases pin that Bitcoin issues first,
// that a refusing seed still leaves the token issued, and that off-Bitcoin venues keep
// the bridge after the seed.

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    calls: [],
    coin: 'RBTC',
    seedError: null,
}));

vi.mock('../../e2e/fixtures/regtest.js', () => ({
    get REGTEST_COIN() { return mocks.coin; },
    GAS_HEADROOM_FLOOR: '1000000',
    assertVenueReachable: vi.fn(async () => { mocks.calls.push('reachable'); }),
    healVenueClock: vi.fn(async () => ({ clock: 'released' })),
    runInIndexer: vi.fn(async () => { mocks.calls.push('readState'); return '{}'; }),
    seedPrices: vi.fn(async () => {
        mocks.calls.push('seedPrices');
        if (mocks.seedError) throw mocks.seedError;
        return { seeded: false, xchainUsdPrice: '1.8', coinUsdPrice: '80000', oracleRound: 7 };
    }),
    assertGasHeadroom: vi.fn(async () => { mocks.calls.push('headroom'); }),
    readGasHeadroom: vi.fn(async () => '99999990'),
}));

vi.mock('../../e2e/fixtures/priceSeed.js', () => ({
    readStateScript: vi.fn(() => 'script'),
}));

vi.mock('../../e2e/fixtures/priceKeeper.js', () => ({
    startPriceKeeper: vi.fn(() => {
        mocks.calls.push('keeper');
        return { stop: () => ({ reseeds: 0, ticks: 0, failures: 0, skipped: 0 }) };
    }),
}));

vi.mock('../../e2e/fixtures/gasToken.js', () => ({
    ensureGasToken: vi.fn(async ({ baseURL }) => {
        mocks.calls.push(`ensureGasToken ${baseURL}`);
        return { issued: true };
    }),
}));

const { default: globalSetup } = await import('../../e2e/global-setup.regtest.js');

const CONFIG = { projects: [{ use: { baseURL: 'http://localhost:4183' } }] };

beforeEach(() => {
    mocks.calls.length = 0;
    mocks.coin = 'RBTC';
    mocks.seedError = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('regtest global setup: gas token and price order', () => {
    it('issues the gas token before the price seed on Bitcoin', async () => {
        const teardown = await globalSetup(CONFIG);
        expect(mocks.calls).toEqual([
            'reachable', 'readState', 'ensureGasToken http://localhost:4183',
            'seedPrices', 'headroom', 'keeper',
        ]);
        teardown();
    });

    it('still issues the gas token on Bitcoin when the seed refuses', async () => {
        mocks.seedError = new Error('Regtest RBTC cannot price a fee-bearing action: no current oracle price for XCHAIN/USD');
        await expect(globalSetup(CONFIG)).rejects.toThrow(/no current oracle price for XCHAIN\/USD/);
        expect(mocks.calls).toContain('ensureGasToken http://localhost:4183');
        expect(mocks.calls.indexOf('ensureGasToken http://localhost:4183'))
            .toBeLessThan(mocks.calls.indexOf('seedPrices'));
    });

    it('keeps the bridged gas token after the seed off Bitcoin', async () => {
        for (const coin of ['RLTC', 'RDOGE']) {
            mocks.calls.length = 0;
            mocks.coin = coin;
            const teardown = await globalSetup(CONFIG);
            expect(mocks.calls).toEqual([
                'reachable', 'readState', 'seedPrices',
                'ensureGasToken http://localhost:4183', 'headroom', 'keeper',
            ]);
            teardown();
        }
    });
});
