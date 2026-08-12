// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P8: SignApproval decode for BET. One action name carries four formats,
// so the decisive property is that the confirm screen names WHICH format is
// being signed and surfaces that format's irreversibility.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

const decode = (params) => decodeAction({ action: 'BET', params });

describe('decodeAction BET', () => {
    it('never falls through to the generic "no plain-English summary" fallback', () => {
        // The whole point of the branch: a BET confirm must not read as raw params.
        for (const version of ['0', '1', '2', '3']) {
            const d = decode({ version, feedActionIndex: '2343', outcome: '0', amount: '1', label: 'x', outcomes: 'Yes,No', tick: 'T' });
            expect(d.warnings.join(' ')).not.toContain('No plain-English summary');
        }
    });

    describe('v2 place a bet', () => {
        const params = { version: '2', feedActionIndex: '2343', outcome: '1', amount: '10.5' };

        it('summarises the stake, outcome and market', () => {
            const d = decode(params);
            expect(d.summary).toBe('Bet 10.5 on outcome 1 of market 2343');
        });

        it('warns that bets are final and that odds are not fixed', () => {
            const w = decode(params).warnings.join(' ');
            expect(w).toContain('final');
            expect(w).toContain('parimutuel');
        });

        it('flags a non-positive stake', () => {
            expect(decode({ ...params, amount: '0' }).warnings.join(' ')).toContain('not positive');
        });
    });

    describe('v3 resolve', () => {
        it('names the payout decision rather than a generic sign prompt', () => {
            const d = decode({ version: '3', feedActionIndex: '77', outcome: '0' });
            expect(d.summary).toBe('Resolve market 77 to outcome 0');
            const w = d.warnings.join(' ');
            expect(w).toContain('pays out');
            expect(w).toContain('cannot be undone');
        });

        it('is distinguishable from a place-bet at a glance', () => {
            // A resolve and a place-bet differ only by AMOUNT on the wire, which is
            // exactly why the SDK pins the version rather than inferring it. The
            // confirm screen must not blur them back together.
            const resolve = decode({ version: '3', feedActionIndex: '77', outcome: '0' });
            const bet = decode({ version: '2', feedActionIndex: '77', outcome: '0', amount: '5' });
            expect(resolve.summary).not.toBe(bet.summary);
            expect(resolve.summary.startsWith('Resolve')).toBe(true);
            expect(bet.summary.startsWith('Bet')).toBe(true);
        });
    });

    describe('v1 cancel', () => {
        it('says every bet is refunded and the market ends', () => {
            const d = decode({ version: '1', feedActionIndex: '99' });
            expect(d.summary).toBe('Cancel market 99 and refund every bet');
            expect(d.warnings.join(' ')).toContain('refunded in full');
        });
    });

    describe('v0 create a market', () => {
        const params = {
            version: '0', label: 'Will it rain?', outcomes: 'Yes,No', tick: 'XCHAIN',
            fee: '2.00', deadline: '1800000000', refundWindow: '3600',
        };

        it('summarises the market and its wager token', () => {
            expect(decode(params).summary).toBe('Open a betting market on XCHAIN: Will it rain?');
        });

        it('labels FEE as the ORACLE percent, keeping it distinct from the market duration fee', () => {
            const row = decode(params).details.find((d) => /oracle fee/i.test(d.label));
            expect(row).toBeTruthy();
            expect(row.value).toBe('2.00%');
        });

        it('warns that markets are immutable and that the signer becomes the oracle', () => {
            const w = decode(params).warnings.join(' ');
            expect(w).toContain('cannot be edited');
            expect(w).toContain('You are the oracle');
        });

        it('flags a market with fewer than two outcomes', () => {
            expect(decode({ ...params, outcomes: 'OnlyOne' }).warnings.join(' ')).toContain('at least two outcomes');
        });

        it('treats a version-less params object as a create (only creates carry a label)', () => {
            const d = decode({ label: 'No version field', outcomes: 'A,B', tick: 'T' });
            expect(d.summary).toContain('Open a betting market');
        });
    });

    it('reads the uppercase wire spelling too, for pasted or imported raw actions', () => {
        const d = decode({ VERSION: '2', FEED_ACTION_INDEX: '2343', OUTCOME: '1', AMOUNT: '4' });
        expect(d.summary).toBe('Bet 4 on outcome 1 of market 2343');
    });

    it('flags a memo carrying the protocol field separators', () => {
        const w = decode({ version: '2', feedActionIndex: '1', outcome: '0', amount: '1', memo: 'a|b' }).warnings.join(' ');
        expect(w).toContain('will reject');
    });

    it('names the chain in the summary, so a wrong-network approval is visible', () => {
        // With no registry the chainId itself is the fallback label, matching every
        // other decoder branch.
        const d = decodeAction({ action: 'BET', params: { version: '1', feedActionIndex: '5' }, chainId: 'bitcoin-regtest', chainRegistry: null });
        expect(d.summary).toBe('Cancel market 5 and refund every bet on bitcoin-regtest');
    });
});
