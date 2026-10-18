// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
    FUNDING_SATS,
    MIN_CLAIM_UTXO_SATS,
    preflightClaimantUtxo,
    preflightRunInput,
} from '../../e2e/fixtures/testnet_preflight.js';

const INPUT = Object.freeze({
    wif: 'treasury-private-key',
    address: 'treasury-address',
    claimant: Object.freeze({
        wif: 'claimant-private-key',
        address: 'claimant-address',
    }),
});

function row(value, confirmations = 1) {
    return { value: String(value), confirmations };
}

function fakeVenue({ treasury = [], claimant = [] } = {}) {
    return {
        utxos: vi.fn(async (address) => ({
            utxos: address === INPUT.address ? treasury : claimant,
        })),
    };
}

async function captureRefusal(run, input = INPUT) {
    let refusal;
    try {
        await run();
    } catch (error) {
        refusal = error;
    }
    expect(refusal).toBeInstanceOf(Error);
    for (const secret of [input.wif, input.address, input.claimant?.wif, input.claimant?.address]) {
        if (secret) expect(refusal.message).not.toContain(secret);
    }
    expect(refusal.message).toMatch(/held \d+ sats, needed \d+ sats, shortfall \d+ sats/);
    return refusal;
}

describe('testnet claimant UTXO preflight', () => {
    it('refuses a view holding only unconfirmed UTXOs', async () => {
        const venue = fakeVenue({
            claimant: [row(MIN_CLAIM_UTXO_SATS, 0), row(MIN_CLAIM_UTXO_SATS * 2, 0)],
        });

        const error = await captureRefusal(
            () => preflightClaimantUtxo(venue, INPUT.claimant.address),
        );

        expect(error.message).toContain(
            `held 0 sats, needed ${MIN_CLAIM_UTXO_SATS} sats, shortfall ${MIN_CLAIM_UTXO_SATS} sats`,
        );
    });

    it('refuses a largest confirmed UTXO one sat below the minimum', async () => {
        const venue = fakeVenue({
            claimant: [row(MIN_CLAIM_UTXO_SATS - 1), row(MIN_CLAIM_UTXO_SATS, 0)],
        });

        const error = await captureRefusal(
            () => preflightClaimantUtxo(venue, INPUT.claimant.address),
        );

        expect(error.message).toContain(
            `held ${MIN_CLAIM_UTXO_SATS - 1} sats, needed ${MIN_CLAIM_UTXO_SATS} sats, shortfall 1 sats`,
        );
    });

    it('returns the held and needed values at the exact minimum', async () => {
        const venue = fakeVenue({ claimant: [row(MIN_CLAIM_UTXO_SATS)] });

        await expect(preflightClaimantUtxo(venue, INPUT.claimant.address)).resolves.toEqual({
            held: MIN_CLAIM_UTXO_SATS,
            needed: MIN_CLAIM_UTXO_SATS,
        });
    });

    it('does not name the claimant key or address in a refusal', async () => {
        const input = {
            ...INPUT,
            claimant: {
                wif: 'private-key-that-must-not-leak',
                address: 'address-that-must-not-leak',
            },
        };
        const venue = fakeVenue({ claimant: [row(MIN_CLAIM_UTXO_SATS - 1)] });

        await captureRefusal(
            () => preflightClaimantUtxo(venue, input.claimant.address),
            input,
        );
    });
});

describe('testnet run-input preflight', () => {
    it('refuses confirmed treasury value that cannot cover funding and its two-output fee', async () => {
        const venue = fakeVenue({
            treasury: [row(FUNDING_SATS + 281), row(1_000_000, 0)],
            claimant: [row(MIN_CLAIM_UTXO_SATS)],
        });

        const error = await captureRefusal(() => preflightRunInput(venue, INPUT));

        expect(error.message).toContain(
            `held ${FUNDING_SATS + 281} sats, needed ${FUNDING_SATS + 282} sats, shortfall 1 sats`,
        );
        expect(venue.utxos).toHaveBeenCalledTimes(1);
        expect(venue.utxos).toHaveBeenCalledWith(INPUT.address);
    });

    it.each([
        ['no claimant object', undefined],
        ['no claimant fields', {}],
        ['no claimant address', { wif: INPUT.claimant.wif }],
        ['no claimant key', { address: INPUT.claimant.address }],
        ['empty claimant fields', { wif: '', address: '' }],
    ])('refuses run input with %s', async (_label, claimant) => {
        const venue = fakeVenue({ treasury: [row(FUNDING_SATS + 282)] });
        const input = { ...INPUT, claimant };

        const error = await captureRefusal(() => preflightRunInput(venue, input), input);

        expect(error.message).toContain(
            `held 0 sats, needed ${MIN_CLAIM_UTXO_SATS} sats, shortfall ${MIN_CLAIM_UTXO_SATS} sats`,
        );
        expect(venue.utxos).toHaveBeenCalledTimes(1);
    });

    it('includes every required input when sizing the treasury fee', async () => {
        const venue = fakeVenue({
            treasury: [row(250_200), row(250_200)],
            claimant: [row(MIN_CLAIM_UTXO_SATS)],
        });

        const error = await captureRefusal(() => preflightRunInput(venue, INPUT));

        expect(error.message).toContain('held 500400 sats, needed 500418 sats, shortfall 18 sats');
        expect(venue.utxos).toHaveBeenCalledTimes(1);
    });

    it('refuses when the claimant largest confirmed UTXO is below the minimum', async () => {
        const venue = fakeVenue({
            treasury: [row(FUNDING_SATS + 282)],
            claimant: [row(19_000), row(18_000), row(100_000, 0)],
        });

        const error = await captureRefusal(() => preflightRunInput(venue, INPUT));

        expect(error.message).toContain(`held 19000 sats, needed ${MIN_CLAIM_UTXO_SATS} sats, shortfall 1000 sats`);
        expect(venue.utxos).toHaveBeenNthCalledWith(2, INPUT.claimant.address);
    });

    it('passes at the exact treasury fee and claimant UTXO boundaries', async () => {
        const venue = fakeVenue({
            treasury: [row(FUNDING_SATS + 282), row(9_000, 0)],
            claimant: [row(MIN_CLAIM_UTXO_SATS), row(MIN_CLAIM_UTXO_SATS - 1)],
        });

        await expect(preflightRunInput(venue, INPUT)).resolves.toEqual({
            treasury: { held: FUNDING_SATS + 282, needed: FUNDING_SATS + 282 },
            claimant: { held: MIN_CLAIM_UTXO_SATS, needed: MIN_CLAIM_UTXO_SATS },
        });
        expect(venue.utxos.mock.calls).toEqual([[INPUT.address], [INPUT.claimant.address]]);
    });
});

describe('testnet global setup', () => {
    it('removes staged input before a preflight refusal propagates', async () => {
        const cleanup = vi.fn();
        const refusal = new Error('preflight refusal');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.resetModules();
        vi.doMock('../../e2e/fixtures/testnet.js', () => ({
            RUN_INPUT_ENV: 'TEST_RUN_INPUT',
            TESTNET_COIN: 'TBTC',
            checkTestnetVenue: vi.fn(async () => ({
                indexed: 9,
                price: { coinUsdPrice: '1', oracleRound: 2, xchainUsdPrice: '3' },
                tip: 10,
                tipAgeSeconds: 4,
            })),
            liveVenue: vi.fn(() => ({})),
            readRunInput: vi.fn(() => INPUT),
            stageRunInput: vi.fn(async () => ({ cleanup, file: 'staged-input' })),
            testnetEndpoints: vi.fn(() => ({ explorerUrl: 'explorer' })),
        }));
        vi.doMock('../../e2e/fixtures/testnet_preflight.js', () => ({
            preflightRunInput: vi.fn(async () => { throw refusal; }),
        }));
        vi.doMock('../../e2e/fixtures/testnet_origin.js', () => ({
            assertOriginsAllowed: vi.fn(async () => {}),
            suiteOrigin: vi.fn(() => 'http://localhost:4193'),
        }));

        try {
            const { default: globalSetup } = await import('../../e2e/global-setup.testnet.js');
            await expect(globalSetup()).rejects.toBe(refusal);
            expect(cleanup).toHaveBeenCalledTimes(1);
        } finally {
            vi.doUnmock('../../e2e/fixtures/testnet.js');
            vi.doUnmock('../../e2e/fixtures/testnet_preflight.js');
            vi.doUnmock('../../e2e/fixtures/testnet_origin.js');
            vi.resetModules();
            log.mockRestore();
        }
    });
});
