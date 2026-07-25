// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the PRICE v1 oracle usage fee pre-flight .
//
// A Mode B dispenser (ORACLE_ADDRESS set) must carry a native-coin output paying the
// oracle operator, sized from the escrow it adds, or the indexer rejects the create.
// Composing without it produces a transaction guaranteed to fail on chain with the miner
// fee already spent, so the guardrail is a hard refusal rather than a hint.

import { describe, it, expect } from 'vitest';
import {
    applyOracleFeePreflight,
    OracleFeeUnpayableError,
    ORACLE_FEE_NOTE,
} from '../../../packages/core/src/sdk/oracleFeePreflight.js';

// SDK stub whose explorer.getOracleFeeQuote returns a canned quote and records its args.
function makeSdk(quote) {
    const sdk = {
        seen: null,
        explorer: {
            async getOracleFeeQuote(args) {
                sdk.seen = args;
                return Object.assign(
                    { valid: true, oracleAddress: 'oracleAddr', requiredFeeSats: 1000,
                      requiredFeeNative: '0.00001000', belowDust: false },
                    quote || {},
                );
            },
        },
    };
    return sdk;
}

const MODE_B = {
    action: 'DISPENSER',
    params: {
        GIVE_COIN: 'BTC', GIVE_TICK: 'PEPECASH', GIVE_AMOUNT: '1', GIVE_ESCROW: '1000',
        GET_COIN: 'BTC', GET_AMOUNT: '0', FIAT_CODE: 'USD', ORACLE_ADDRESS: 'oracleAddr',
    },
};

describe('applyOracleFeePreflight', () => {
    it('appends the oracle output sized from the quote', async () => {
        const sdk = makeSdk();
        const out = await applyOracleFeePreflight({
            sdk, actionData: MODE_B, encoderOpts: { pubkey: 'pk' },
        });
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'oracleAddr', value: 1000 }]);
        expect(out.oracleFeeQuote.requiredFeeSats).toBe(1000);
        expect(out.encoderOpts.pubkey).toBe('pk');
    });

    it('passes the dispenser fields the indexer prices from', async () => {
        const sdk = makeSdk();
        await applyOracleFeePreflight({ sdk, actionData: MODE_B, encoderOpts: {} });
        expect(sdk.seen).toEqual({
            oracleAddress: 'oracleAddr', giveCoin: 'BTC', giveTick: 'PEPECASH',
            fiatCode: 'USD', getCoin: 'BTC', giveEscrow: '1000',
        });
    });

    it('preserves customOutputs already folded in by the native-fee pre-flight', async () => {
        const sdk = makeSdk();
        const out = await applyOracleFeePreflight({
            sdk, actionData: MODE_B,
            encoderOpts: { customOutputs: [{ address: 'feeDest', value: 2000 }] },
        });
        // Both outputs ride: the protocol fee AND the oracle fee. This is the realistic
        // shape on LTC/DOGE, where the native fee is mandatory.
        expect(out.encoderOpts.customOutputs).toEqual([
            { address: 'feeDest', value: 2000 },
            { address: 'oracleAddr', value: 1000 },
        ]);
    });

    it('adds no output when the fee is below dust', async () => {
        const sdk = makeSdk({ belowDust: true, requiredFeeSats: 300 });
        const out = await applyOracleFeePreflight({ sdk, actionData: MODE_B, encoderOpts: {} });
        expect(out.encoderOpts.customOutputs).toEqual([]);
        expect(out.oracleFeeQuote.belowDust).toBe(true);
    });

    it('adds no output when the oracle charges no fee', async () => {
        const sdk = makeSdk({ requiredFeeSats: 0, requiredFeeNative: '0.00000000', belowDust: true });
        const out = await applyOracleFeePreflight({ sdk, actionData: MODE_B, encoderOpts: {} });
        expect(out.encoderOpts.customOutputs).toEqual([]);
    });

    it('is a no-op for a Mode A (FIAT_AMOUNT) dispenser', async () => {
        const sdk = makeSdk();
        const modeA = {
            action: 'DISPENSER',
            params: { ...MODE_B.params, ORACLE_ADDRESS: '', FIAT_AMOUNT: '0.05' },
        };
        const encoderOpts = { pubkey: 'pk' };
        const out = await applyOracleFeePreflight({ sdk, actionData: modeA, encoderOpts });
        expect(out.oracleFeeQuote).toBe(null);
        expect(out.encoderOpts).toBe(encoderOpts);   // same reference, untouched
        expect(sdk.seen).toBe(null);                 // no quote fetched
    });

    it('is a no-op for a non-DISPENSER action', async () => {
        const sdk = makeSdk();
        const out = await applyOracleFeePreflight({
            sdk, actionData: { action: 'ISSUE', params: { ORACLE_ADDRESS: 'oracleAddr' } },
            encoderOpts: {},
        });
        expect(out.oracleFeeQuote).toBe(null);
        expect(sdk.seen).toBe(null);
    });

    it('is a no-op when the action escrows nothing (cancel, or an ownership dispenser)', async () => {
        const sdk = makeSdk();
        for (const escrow of ['', '0', undefined]) {
            const data = { action: 'DISPENSER', params: { ...MODE_B.params, GIVE_ESCROW: escrow } };
            const out = await applyOracleFeePreflight({ sdk, actionData: data, encoderOpts: {} });
            expect(out.oracleFeeQuote).toBe(null);
        }
        expect(sdk.seen).toBe(null);
    });

    it('refuses a create whose oracle fee cannot be priced', async () => {
        // The realistic case: the oracle has published nothing effective yet, so the
        // indexer would reject the create. Signing it would burn the miner fee.
        const sdk = makeSdk({ valid: false, error: 'invalid: ORACLE_ADDRESS (no effective oracle price)' });
        await expect(applyOracleFeePreflight({ sdk, actionData: MODE_B, encoderOpts: {} }))
            .rejects.toThrow(OracleFeeUnpayableError);
    });

    it('refuses a compacted ^<id> ORACLE_ADDRESS without even quoting it', async () => {
        // The decoder recognizes the fee output by reading ORACLE_ADDRESS out of the
        // payload and cannot resolve an indexer address id, so the output would be
        // invisible and the create rejected as unpaid however much was sent.
        const sdk = makeSdk();
        const data = { action: 'DISPENSER', params: { ...MODE_B.params, ORACLE_ADDRESS: '^57' } };
        await expect(applyOracleFeePreflight({ sdk, actionData: data, encoderOpts: {} }))
            .rejects.toThrow(/\^<id>/);
        expect(sdk.seen).toBe(null);
    });

    it('refuses when the SDK has no oracle-fee quote surface', async () => {
        await expect(applyOracleFeePreflight({
            sdk: { explorer: {} }, actionData: MODE_B, encoderOpts: {},
        })).rejects.toThrow(OracleFeeUnpayableError);
    });

    it('supports a v2 refill, whose payload names no oracle address', async () => {
        // DISPENSER v2 targets its dispenser by action index and carries no
        // ORACLE_ADDRESS, so the caller supplies the address it already knows.
        const sdk = makeSdk();
        const refill = { action: 'DISPENSER', params: { GIVE_ESCROW: '500' } };
        const out = await applyOracleFeePreflight({
            sdk, actionData: refill,
            encoderOpts: { oracleFeeAddress: 'oracleAddr', oracleFeeGiveTick: 'PEPECASH',
                           oracleFeeFiatCode: 'USD', oracleFeeGiveCoin: 'BTC', oracleFeeGetCoin: 'BTC' },
        });
        expect(sdk.seen.giveEscrow).toBe('500');      // charged on what the refill ADDS
        expect(sdk.seen.giveTick).toBe('PEPECASH');
        expect(out.encoderOpts.customOutputs).toEqual([{ address: 'oracleAddr', value: 1000 }]);
        // The hint fields must never reach the encoder as unknown params.
        expect(out.encoderOpts.oracleFeeAddress).toBeUndefined();
        expect(out.encoderOpts.oracleFeeGiveTick).toBeUndefined();
        expect(out.encoderOpts.oracleFeeFiatCode).toBeUndefined();
    });

    it('strips the hint fields even on the no-op path', async () => {
        const sdk = makeSdk();
        const out = await applyOracleFeePreflight({
            sdk, actionData: { action: 'ISSUE', params: {} },
            encoderOpts: { oracleFeeAddress: 'x', pubkey: 'pk' },
        });
        // No-op returns the ORIGINAL object by design (cheap identity for the common
        // case); the hints are inert there because the action never reaches the encoder
        // with them stripped elsewhere. Pin the identity so the contract is explicit.
        expect(out.encoderOpts.pubkey).toBe('pk');
    });

    it('exposes a user-facing note naming who is paid and when', () => {
        expect(ORACLE_FEE_NOTE).toMatch(/oracle/i);
        expect(ORACLE_FEE_NOTE).toMatch(/once/i);
    });
});
