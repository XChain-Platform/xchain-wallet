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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assertOriginsAllowed: vi.fn(),
    checkTestnetVenue: vi.fn(),
    cleanup: vi.fn(),
    input: { address: 'treasury-address', claimant: { address: 'claimant-address' } },
    liveVenue: vi.fn(),
    preflightClaimantReward: vi.fn(),
    preflightGasHeadroom: vi.fn(),
    preflightRunInputKeys: vi.fn(),
    preflightRunInput: vi.fn(),
    readRunInput: vi.fn(),
    stageRunInput: vi.fn(),
    suiteOrigin: vi.fn(),
    testnetEndpoints: vi.fn(),
    venue: { kind: 'live venue' },
}));

vi.mock('../../e2e/fixtures/testnet.js', () => ({
    RUN_INPUT_ENV: 'XC_TESTNET_RUN_INPUT',
    TESTNET_COIN: 'TBTC',
    checkTestnetVenue: mocks.checkTestnetVenue,
    liveVenue: mocks.liveVenue,
    readRunInput: mocks.readRunInput,
    stageRunInput: mocks.stageRunInput,
    testnetEndpoints: mocks.testnetEndpoints,
}));

vi.mock('../../e2e/fixtures/testnet_origin.js', () => ({
    assertOriginsAllowed: mocks.assertOriginsAllowed,
    suiteOrigin: mocks.suiteOrigin,
}));

vi.mock('../../e2e/fixtures/testnet_gas_preflight.js', () => ({
    MINT_AMOUNT: 200,
    preflightGasHeadroom: mocks.preflightGasHeadroom,
}));

vi.mock('../../e2e/fixtures/testnet_keys.js', () => ({
    preflightRunInputKeys: mocks.preflightRunInputKeys,
}));

vi.mock('../../e2e/fixtures/testnet_preflight.js', () => ({
    preflightRunInput: mocks.preflightRunInput,
}));

vi.mock('../../e2e/fixtures/testnet_rewards.js', () => ({
    preflightClaimantReward: mocks.preflightClaimantReward,
}));

const { default: globalSetup } = await import('../../e2e/global-setup.testnet.js');

const RUN_INPUT_ENV = 'XC_TESTNET_RUN_INPUT';
const STAGED_FILE = '/private/staged-testnet-input.json';
const ENDPOINTS = Object.freeze({
    encoderUrl: 'https://encoder.invalid',
    explorerUrl: 'https://explorer.invalid',
    hubUrl: 'https://hub.invalid',
});
const REPORT = Object.freeze({
    indexed: 99,
    price: { coinUsdPrice: '60000', oracleRound: 7, xchainUsdPrice: '2' },
    tip: 100,
    tipAgeSeconds: 12,
});

let exitListenersBefore;
let originalRunInput;
let consoleLog;

beforeEach(() => {
    exitListenersBefore = new Set(process.listeners('exit'));
    originalRunInput = process.env[RUN_INPUT_ENV];
    delete process.env[RUN_INPUT_ENV];

    vi.resetAllMocks();
    mocks.assertOriginsAllowed.mockResolvedValue(undefined);
    mocks.checkTestnetVenue.mockResolvedValue(REPORT);
    mocks.liveVenue.mockReturnValue(mocks.venue);
    mocks.preflightClaimantReward.mockResolvedValue(undefined);
    mocks.preflightGasHeadroom.mockResolvedValue(undefined);
    mocks.preflightRunInputKeys.mockReturnValue(undefined);
    mocks.preflightRunInput.mockResolvedValue(undefined);
    mocks.readRunInput.mockReturnValue(mocks.input);
    mocks.stageRunInput.mockResolvedValue({ cleanup: mocks.cleanup, file: STAGED_FILE });
    mocks.suiteOrigin.mockReturnValue('http://localhost:4193');
    mocks.testnetEndpoints.mockReturnValue(ENDPOINTS);
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    for (const listener of process.listeners('exit')) {
        if (!exitListenersBefore.has(listener)) process.removeListener('exit', listener);
    }
    if (originalRunInput === undefined) delete process.env[RUN_INPUT_ENV];
    else process.env[RUN_INPUT_ENV] = originalRunInput;
    consoleLog.mockRestore();
});

describe('testnet global setup ordering', () => {
    it('refuses a disallowed origin before creating or checking the live venue or staging input', async () => {
        const refusal = new Error('origin refused');
        mocks.assertOriginsAllowed.mockRejectedValueOnce(refusal);

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.assertOriginsAllowed).toHaveBeenCalledWith(ENDPOINTS, {
            origin: 'http://localhost:4193',
        });
        expect(mocks.liveVenue).not.toHaveBeenCalled();
        expect(mocks.checkTestnetVenue).not.toHaveBeenCalled();
        expect(mocks.stageRunInput).not.toHaveBeenCalled();
    });

    it('refuses an unhealthy venue before staging input', async () => {
        const refusal = new Error('venue refused');
        mocks.checkTestnetVenue.mockRejectedValueOnce(refusal);

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.liveVenue).toHaveBeenCalledWith(ENDPOINTS);
        expect(mocks.checkTestnetVenue).toHaveBeenCalledWith(mocks.venue);
        expect(mocks.stageRunInput).not.toHaveBeenCalled();
    });

    it('refuses insufficient gas headroom after checking the venue and before staging input', async () => {
        const refusal = new Error('Gas headroom preflight refused');
        mocks.preflightGasHeadroom.mockRejectedValueOnce(refusal);

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.checkTestnetVenue).toHaveBeenCalledWith(mocks.venue);
        expect(mocks.checkTestnetVenue.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.preflightGasHeadroom.mock.invocationCallOrder[0]);
        expect(mocks.stageRunInput).not.toHaveBeenCalled();
    });

    it('cleans staged input when run-input preflight refuses', async () => {
        const refusal = new Error('run input refused');
        mocks.preflightRunInput.mockRejectedValueOnce(refusal);

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.cleanup).toHaveBeenCalledTimes(1);
        expect(mocks.preflightRunInput.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.cleanup.mock.invocationCallOrder[0]);
        expect(mocks.preflightClaimantReward).not.toHaveBeenCalled();
        expect(process.env[RUN_INPUT_ENV]).toBeUndefined();
    });

    it('cleans staged input when key preflight refuses before any UTXO read', async () => {
        const refusal = new Error('Key preflight refused: claimant');
        mocks.preflightRunInputKeys.mockImplementationOnce(() => { throw refusal; });

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.preflightRunInputKeys).toHaveBeenCalledOnce();
        expect(mocks.preflightRunInputKeys).toHaveBeenCalledWith(mocks.input);
        expect(mocks.cleanup).toHaveBeenCalledTimes(1);
        expect(mocks.preflightRunInput).not.toHaveBeenCalled();
        expect(mocks.preflightClaimantReward).not.toHaveBeenCalled();
        expect(process.env[RUN_INPUT_ENV]).toBeUndefined();
    });

    it('cleans staged input when claimant-reward preflight refuses', async () => {
        const refusal = new Error('claimant reward refused');
        mocks.preflightClaimantReward.mockRejectedValueOnce(refusal);

        await expect(globalSetup()).rejects.toBe(refusal);

        expect(mocks.cleanup).toHaveBeenCalledTimes(1);
        expect(mocks.preflightRunInput.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.preflightClaimantReward.mock.invocationCallOrder[0]);
        expect(mocks.preflightClaimantReward.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.cleanup.mock.invocationCallOrder[0]);
        expect(process.env[RUN_INPUT_ENV]).toBeUndefined();
    });

    it('passes staged input through both preflights and returns a cleanup teardown', async () => {
        const teardown = await globalSetup();

        expect(mocks.preflightGasHeadroom).toHaveBeenCalledTimes(1);
        expect(mocks.preflightGasHeadroom).toHaveBeenCalledWith(200, {
            explorerUrl: ENDPOINTS.explorerUrl,
            coin: 'TBTC',
        });
        expect(mocks.stageRunInput).toHaveBeenCalledWith(process.stdin);
        expect(mocks.readRunInput).toHaveBeenCalledWith(STAGED_FILE);
        expect(mocks.preflightRunInputKeys).toHaveBeenCalledOnce();
        expect(mocks.preflightRunInputKeys).toHaveBeenCalledWith(mocks.input);
        expect(mocks.preflightRunInput).toHaveBeenCalledWith(mocks.venue, mocks.input);
        expect(mocks.preflightClaimantReward).toHaveBeenCalledWith(mocks.input, {
            explorerUrl: ENDPOINTS.explorerUrl,
            coin: 'TBTC',
        });
        expect(mocks.preflightRunInputKeys.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.preflightRunInput.mock.invocationCallOrder[0]);
        expect(mocks.preflightRunInput.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.preflightClaimantReward.mock.invocationCallOrder[0]);
        expect(process.env[RUN_INPUT_ENV]).toBe(STAGED_FILE);
        expect(mocks.cleanup).not.toHaveBeenCalled();

        await teardown();

        expect(mocks.cleanup).toHaveBeenCalledTimes(1);
        expect(process.env[RUN_INPUT_ENV]).toBeUndefined();
    });
});
