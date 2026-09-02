// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// Unit: test/e2e/fixtures/gasToken.js - is the gas token on the venue?
//
// The verdict decides whether global setup ISSUES a second XCHAIN, so the
// payloads here are the venue's own (recorded 2026-09-01 off a fresh Dogecoin
// regtest and a priced Litecoin one), and the third case pins the refusal to
// guess: anything that is neither a valid quote nor a TICK (unknown) refusal
// throws with the body instead of becoming "absent".

import { describe, it, expect } from 'vitest';
import { gasTokenVerdict, GAS_ISSUE, GAS_TICK } from '../e2e/fixtures/gasToken.js';

const ABSENT = { status: 'invalid: TICK (unknown)', error: 'invalid: TICK (unknown)', validated: true, valid: false };
const PRESENT = { supported: true, action: 'MINT', coin: 'DOGE', status: 'valid', validated: true, xchainFee: '0.00000000' };

describe('gasTokenVerdict', () => {
    it('reads a valid MINT quote as the token being present', () => {
        expect(gasTokenVerdict(PRESENT)).toBe('present');
    });

    it('reads the venue naming the tick as unknown as absent', () => {
        expect(gasTokenVerdict(ABSENT)).toBe('absent');
    });

    it('refuses to guess on any other shape, naming the body', () => {
        for (const body of [
            { error: 'DB_ERROR', code: 'DB_ERROR' },
            { status: 'invalid: no current oracle price for DOGE/USD (missing or stale beyond 1800s)' },
            { status: 'busy' },
            null,
            {},
        ]) {
            expect(() => gasTokenVerdict(body)).toThrow(/cannot tell whether XCHAIN exists/);
        }
    });

    it('mirrors the e2e-test suite faucet issuance, so both suites agree what XCHAIN is', () => {
        // initialCheck.test.js gas-token-check: MAX_SUPPLY 100000000, MAX_MINT
        // 100000, decimals 0, "XChain GAS Token", MINT_SUPPLY 0.
        expect(GAS_TICK).toBe('XCHAIN');
        expect(GAS_ISSUE).toEqual({
            MAX_SUPPLY: '100000000',
            MAX_MINT: '100000',
            DECIMALS: '0',
            DESCRIPTION: 'XChain GAS Token',
            MINT_SUPPLY: '0',
        });
    });
});
