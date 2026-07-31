// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the authoring fee row must not announce a protocol fee on an action
// that has none. Most actions the row mounts on are unpriced (no gas-schedule
// entry) or free in the ordinary case (ORDER/SWAP/DISPENSER under the
// expiration free-days rule), and on LTC/DOGE the row asserted a coin payment
// that would be forfeited for every one of them.

import { describe, it, expect } from 'vitest';
import {
    normalizeProtocolFee,
    protocolFeeRowCopy,
} from '../../../packages/core/src/flows/protocolFeeRow.js';

describe('normalizeProtocolFee', () => {
    it('reads nothing at all as unknown, never as free', () => {
        for (const v of [undefined, null]) {
            expect(normalizeProtocolFee(v)).toEqual({ known: false, free: false, amount: null });
        }
    });

    it('reads a zero quote as free in every decimal spelling', () => {
        for (const v of ['0', '0.0', '0.00000000', 0]) {
            expect(normalizeProtocolFee(v)).toEqual({ known: true, free: true, amount: null });
        }
    });

    it('reads a positive amount as priced, with trailing zeros trimmed', () => {
        expect(normalizeProtocolFee('0.16500000')).toEqual({
            known: true, free: false, amount: '0.165',
        });
        expect(normalizeProtocolFee('1.00000000')).toEqual({
            known: true, free: false, amount: '1',
        });
    });

    it('takes the bet-feed create quote shape as it stands', () => {
        expect(normalizeProtocolFee({ days: 44, billableDays: 0, free: true, fee: '0.00000000' }))
            .toEqual({ known: true, free: true, amount: null });
        expect(normalizeProtocolFee({ days: 120, billableDays: 30, free: false, fee: '0.16500000' }))
            .toEqual({ known: true, free: false, amount: '0.165' });
    });

    it('takes a /feequote or /preflight answer through xchainFee', () => {
        expect(normalizeProtocolFee({ supported: true, valid: true, xchainFee: '0.00000000' }))
            .toEqual({ known: true, free: true, amount: null });
    });

    // The indexer answers `xchainFee: null` when the dry-run was rejected before
    // a fee record was staged. That is "we do not know", and reading it as zero
    // would reintroduce the same lie in the opposite direction.
    it('treats a null fee figure as unknown rather than zero', () => {
        expect(normalizeProtocolFee({ xchainFee: null }).known).toBe(false);
        expect(normalizeProtocolFee({ fee: '' }).known).toBe(false);
        expect(normalizeProtocolFee({ fee: 'n/a' }).known).toBe(false);
        expect(normalizeProtocolFee(Number.NaN).known).toBe(false);
    });

    it('keeps "charged" when the verdict says so but the amount is unreadable', () => {
        expect(normalizeProtocolFee({ free: false, fee: null }))
            .toEqual({ known: true, free: false, amount: null });
        expect(normalizeProtocolFee({ free: false }))
            .toEqual({ known: true, free: false, amount: null });
    });

    it('lets an explicit free verdict outrank a stray amount beside it', () => {
        expect(normalizeProtocolFee({ free: true, fee: '0.16500000' }).free).toBe(true);
    });
});

describe('protocolFeeRowCopy', () => {
    it('states the chain rule conditionally when no quote is in hand', () => {
        const copy = protocolFeeRowCopy({ coinTicker: 'LTC', mandatory: true });
        expect(copy.variant).toBe('statement');
        // No promise that THIS action charges anything.
        expect(copy.label).toBe('Protocol fees are paid in LTC');
        expect(copy.hint).toContain('LTC is the only way to pay a protocol fee on this chain');
        expect(copy.hint).toContain('If this action charges one');
        expect(copy.hint).not.toContain('The fee is sent on-chain');
    });

    it('says plainly that a quoted-free action costs nothing, and drops the forfeit warning', () => {
        for (const mandatory of [true, false]) {
            const copy = protocolFeeRowCopy({ fee: { free: true }, coinTicker: 'LTC', mandatory });
            // Even on Bitcoin: a switch between two ways of paying nothing is
            // the other half of the  finding.
            expect(copy.variant).toBe('statement');
            expect(copy.label).toBe('This action has no protocol fee');
            expect(copy.hint).not.toMatch(/not refunded/i);
            expect(copy.hint).not.toMatch(/LTC/);
        }
    });

    it('keeps the definite wording, plus the figure, once a charge is known', () => {
        const copy = protocolFeeRowCopy({
            fee: { free: false, fee: '0.16500000' }, coinTicker: 'LTC', mandatory: true,
        });
        expect(copy.label).toBe('Protocol fee is paid in LTC');
        expect(copy.hint).toContain("This action's protocol fee is 0.165 XCHAIN.");
        expect(copy.hint).toContain('The fee is sent on-chain and is not refunded');
        expect(copy.hint).not.toContain('If this action charges one');
    });

    it('offers the payment-mode switch on a chain that has both lanes', () => {
        const copy = protocolFeeRowCopy({ coinTicker: 'BTC', mandatory: false });
        expect(copy.variant).toBe('toggle');
        expect(copy.label).toBe('Pay protocol fee in BTC instead of XCHAIN');
    });

    // : DEPLOY/EXECUTE are priced without a verdict, and the extra
    // sentence belongs only where coin is actually being spent.
    it('appends the unverified notice only when the fee is paid in coin', () => {
        const mandatory = protocolFeeRowCopy({ coinTicker: 'LTC', mandatory: true, unverified: true });
        expect(mandatory.hint).toMatch(/not been checked|unverified|cannot be pre-judged|whether/i);

        const ticked = protocolFeeRowCopy({ coinTicker: 'BTC', checked: true, unverified: true });
        const unticked = protocolFeeRowCopy({ coinTicker: 'BTC', checked: false, unverified: true });
        expect(ticked.hint.length).toBeGreaterThan(unticked.hint.length);
    });

    it('says nothing about forfeiting a fee that is quoted at zero, on either lane', () => {
        const copy = protocolFeeRowCopy({
            fee: '0.00000000', coinTicker: 'BTC', checked: true, unverified: true,
        });
        expect(copy.label).toBe('This action has no protocol fee');
        expect(copy.hint).not.toMatch(/refund/i);
    });
});
