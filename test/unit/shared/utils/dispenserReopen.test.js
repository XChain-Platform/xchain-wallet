// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    isTerminalDispenserStatus,
    reopenTermsFrom,
    terminalDispenserNotice,
} from '../../../../packages/core/src/shared/utils/dispenserReopen.js';

const BASE_DISPENSER = {
    source: 'S',
    give_tick: 'sat',
    give_amount: '1.500',
    give_escrow: '10.0',
};
const REOPEN_OPTIONS = { chainId: 'bitcoin', nowSeconds: 1000 };

describe('isTerminalDispenserStatus', () => {
    it.each([
        'empty',
        'complete',
        'max_dispenses_reached',
        'cancelled',
        'closed',
        'expired',
    ])('recognizes terminal status %s', (status) => {
        expect(isTerminalDispenserStatus(status)).toBe(true);
    });

    it.each(['open', undefined, null])('rejects non-terminal status %s', (status) => {
        expect(isTerminalDispenserStatus(status)).toBe(false);
    });
});

describe('terminalDispenserNotice', () => {
    it('explains how the owner can replace a sold-out dispenser', () => {
        expect(terminalDispenserNotice('empty', { canReopen: true })).toBe(
            "This dispenser sold out. Sold-out dispensers can't be refilled, but you can open a new one on the same address.",
        );
    });

    it('explains that a cancelled dispenser cannot be reopened', () => {
        expect(terminalDispenserNotice('cancelled', { canReopen: false })).toBe(
            "This dispenser was closed and any escrow left was returned. A closed dispenser can't be reopened.",
        );
    });

    it.each(['open', 'unknown'])('returns null for status %s', (status) => {
        expect(terminalDispenserNotice(status, { canReopen: true })).toBeNull();
    });
});

describe('reopenTermsFrom pricing', () => {
    it('normalizes token-priced terms and preserves a future expiration', () => {
        const dispenser = {
            ...BASE_DISPENSER,
            get_tick: 'USD',
            get_amount: '2.50',
            address: 'A',
        };

        expect(reopenTermsFrom(dispenser, { expiration: 2000 }, REOPEN_OPTIONS)).toEqual({
            chainId: 'bitcoin',
            tick: 'SAT',
            giveAmount: '1.5',
            escrow: '10',
            payWith: 'token',
            getTick: 'USD',
            getTokenAmount: '2.5',
            expiration: 2000,
            allowList: '',
            blockList: '',
            source: 'S',
            dispenserAddress: 'A',
        });
    });

    it('clears a past expiration', () => {
        const result = reopenTermsFrom(BASE_DISPENSER, { expiration: 500 }, REOPEN_OPTIONS);
        expect(result.expiration).toBeNull();
    });

    it('uses a fixed fiat amount when no oracle is configured', () => {
        const dispenser = { ...BASE_DISPENSER, fiat: 'USD', fiat_amount: '3.00' };
        const result = reopenTermsFrom(dispenser, {}, REOPEN_OPTIONS);

        expect(result).toMatchObject({
            payWith: 'coin',
            fiatCode: 'USD',
            fiatAmount: '3',
            oracleAddress: '',
        });
    });

    it('keeps an oracle address instead of a fixed fiat amount', () => {
        const dispenser = {
            ...BASE_DISPENSER,
            fiat: 'USD',
            fiat_amount: '3.00',
            oracle_address: 'oracle-address',
        };
        const result = reopenTermsFrom(dispenser, {}, REOPEN_OPTIONS);

        expect(result).toMatchObject({
            payWith: 'coin',
            fiatCode: 'USD',
            fiatAmount: '',
            oracleAddress: 'oracle-address',
        });
    });
});

describe('reopenTermsFrom fallbacks', () => {
    it.each([
        ['0.0', ''],
        ['0.0010', '0.001'],
    ])('normalizes coin trigger price %s', (getAmount, triggerPrice) => {
        const dispenser = { ...BASE_DISPENSER, get_amount: getAmount };
        expect(reopenTermsFrom(dispenser, {}, REOPEN_OPTIONS)).toMatchObject({
            payWith: 'coin',
            triggerPrice,
        });
    });

    it.each([
        [{ address: 'address', get_address: 'get-address', source: 'source' }, 'address'],
        [{ get_address: 'get-address', source: 'source' }, 'get-address'],
        [{ source: 'source' }, 'source'],
    ])('selects dispenser address fallback %#', (addresses, expected) => {
        const result = reopenTermsFrom(addresses, {}, REOPEN_OPTIONS);
        expect(result.dispenserAddress).toBe(expected);
    });
});
