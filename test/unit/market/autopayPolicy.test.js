// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-16 auto-pay decision policy. Every cap and cutoff the engine
// relies on is pinned here: an unattended signer must fail toward NOT
// paying on every ambiguous input, and the caps must hold in exact
// integer math (a DOGE obligation can exceed 2^53 base units).

import { describe, it, expect } from 'vitest';
import {
    ARMING_CUTOFF_SECONDS,
    RETRY_CUTOFF_SECONDS,
    DEFAULT_CONFIRM_DEPTH,
    confirmDepthForChain,
    decimalToBaseUnits,
    paidBase,
    remainingGiveBase,
    orientMatch,
    evaluateObligation,
    leaseState,
} from '../../../packages/core/src/market/autopayPolicy.js';

const NOW = 1_800_000_000; // fixed clock (unix seconds)

/** A healthy pay-ready scenario; tests override single fields to probe each gate. */
function scenario(over = {}) {
    const consent = {
        schemaVersion: 1,
        id: 'bitcoin-regtest::aa',
        walletId: 'w1',
        chainId: 'bitcoin-regtest',
        sourceAddress: 'addr-payer',
        txid: 'aa',
        orderActionIndex: '500',
        giveCoinAmount: '0.05',   // total 5,000,000 base units for 1000 tokens
        getTick: 'PEPE',
        getAmount: '1000',
        autopay: true,
        payments: [],
        createdAt: new Date(0).toISOString(),
        ...over.consent,
    };
    const obligation = {
        action_index: '900',
        payer_address: 'addr-payer',
        payee_address: 'addr-seller',
        coin: 'BTC',
        coin_amount: '500000',    // 0.005 coin for a 100-token fill (exact ratio)
        expiration: NOW + 7000,
        block_index: 100,
        coinpay_status: 'pending_coinpay',
        ...over.obligation,
    };
    const matchRow = over.matchRow === null ? null : {
        action_index: '900',
        // The row's two column families do NOT pair up (xchain-indexer db.js
        // createOrderMatch): the amounts are the TRIGGERING order's give/get, and
        // that order is the one named by get_action_index, while
        // give_action_index names the counterparty. This fixture used to be
        // written the other way round - the same misreading the code carried -
        // which is why the bug passed its own tests for as long as it existed.
        give_action_index: '600', // the counterparty's order
        get_action_index: '500',  // MY order: it triggered the match
        give_amount: '0.005',     // my give: the coin-side fill
        get_amount: '100',        // my get: the token-side fill
        settlement_type: 'coinpay',
        status: 'pending_coinpay',
        ...over.matchRow,
    };
    return {
        obligation,
        consent,
        matchRow,
        tipHeight: over.tipHeight ?? 101, // depth 2 exactly
        nowSeconds: over.nowSeconds ?? NOW,
        alreadyAttempted: over.alreadyAttempted ?? false,
    };
}

describe('decimalToBaseUnits', () => {
    it('converts plain decimals exactly at coin scale', () => {
        expect(decimalToBaseUnits('0.05')).toBe(5_000_000n);
        expect(decimalToBaseUnits('1')).toBe(100_000_000n);
        expect(decimalToBaseUnits('0.00000001')).toBe(1n);
    });

    it('survives past-2^53 amounts exactly (class)', () => {
        // 1.3e18 koinu ≈ the DOGE supply; Number would round this.
        expect(decimalToBaseUnits('13000000000.00000001'))
            .toBe(1_300_000_000_000_000_001n);
    });

    it('rejects garbage, negatives, exponentials, and over-precision', () => {
        for (const bad of ['', 'x', '-1', '1e8', '0.000000001', '1.2.3', null, 5]) {
            expect(decimalToBaseUnits(bad)).toBe(null);
        }
    });
});

describe('paidBase / remainingGiveBase', () => {
    it('sums recorded payments and subtracts from the GIVE total', () => {
        const consent = scenario().consent;
        consent.payments = [
            { orderMatchActionIndex: '1', coinAmountBase: '500000', txid: 't', at: new Date(0).toISOString() },
            { orderMatchActionIndex: '2', coinAmountBase: '1500000', txid: 't2', at: new Date(0).toISOString() },
        ];
        expect(paidBase(consent)).toBe(2_000_000n);
        expect(remainingGiveBase(consent)).toBe(3_000_000n);
    });

    it('floors at zero and rejects an unparseable stored total', () => {
        const consent = scenario().consent;
        consent.payments = [
            { orderMatchActionIndex: '1', coinAmountBase: '9000000', txid: 't', at: new Date(0).toISOString() },
        ];
        expect(remainingGiveBase(consent)).toBe(0n);
        expect(remainingGiveBase({ ...consent, giveCoinAmount: 'zzz' })).toBe(null);
    });
});

describe('orientMatch', () => {
    it('reads the coin fill from whichever side is the consented order', () => {
        const { matchRow } = scenario();
        // Mine triggered the match, so the row's amounts are already mine.
        expect(orientMatch(matchRow, '500')).toEqual({ coinFill: '0.005', tokenFill: '100' });
        // Seen from the counterparty, the sides swap: their give is my get.
        expect(orientMatch(matchRow, '600')).toEqual({ coinFill: '100', tokenFill: '0.005' });
    });

    // The regression, pinned against a row copied verbatim off the chain rather
    // than hand-built, because a hand-built fixture is what hid this: the old one
    // paired give_amount with give_action_index and so agreed with the bug.
    //
    // LTC regtest match 1559. Order 1558 GIVES 0.5 LTC and GETS 100 XCHAIN; order
    // 1557 is its counterparty. The row names 1557 as give_action_index and 1558
    // as get_action_index while carrying give_amount "0.5" - which only 1558 gives.
    it('[REGRESSION] orients a real on-chain row: the coin fill is what I owe', () => {
        const real = {
            action: 'ORDER_MATCH',
            action_index: '1559',
            block_index: '3494',
            give_action_index: '1557',
            get_action_index: '1558',
            give_amount: '0.5',
            get_amount: '100',
            give_coin: 'LTC',
            get_coin: 'LTC',
            settlement_type: 'coinpay',
            status: 'pending_coinpay',
        };
        // 1558 is the coin payer; it owes 0.5 LTC, not 100 of anything.
        expect(orientMatch(real, '1558'),
            'the coin payer is handed the TOKEN fill as their coin fill, so cap 2 compares a coin '
            + 'debt against a token quantity and auto-pay refuses every obligation it is offered')
            .toEqual({ coinFill: '0.5', tokenFill: '100' });
        // And the counterparty's own view is the mirror of it.
        expect(orientMatch(real, '1557')).toEqual({ coinFill: '100', tokenFill: '0.5' });
    });

    it('nulls when the row does not reference the order or lacks amounts', () => {
        const { matchRow } = scenario();
        expect(orientMatch(matchRow, '777')).toBe(null);
        expect(orientMatch({ ...matchRow, give_amount: undefined }, '500')).toBe(null);
        expect(orientMatch(null, '500')).toBe(null);
    });
});

describe('evaluateObligation - happy path', () => {
    it('pays a depth-confirmed, ratio-clean, in-budget obligation', () => {
        const d = evaluateObligation(scenario());
        expect(d).toEqual({ action: 'pay', reason: 'ok', payAmountBase: '500000' });
    });

    it('waits one block short of the confirm depth', () => {
        const d = evaluateObligation(scenario({ tipHeight: 100 })); // depth 1
        expect(d.action).toBe('wait');
        expect(confirmDepthForChain('bitcoin-regtest')).toBe(DEFAULT_CONFIRM_DEPTH);
    });
});

describe('evaluateObligation - terminal and consent gates', () => {
    it('skips non-pending obligations (fulfilled by anyone / expired-settled)', () => {
        const d = evaluateObligation(scenario({ obligation: { coinpay_status: 'fulfilled' } }));
        expect(d).toEqual({ action: 'skip', reason: 'not-pending' });
    });

    it('skips when consent was revoked', () => {
        const d = evaluateObligation(scenario({ consent: { autopay: false } }));
        expect(d.reason).toBe('consent-revoked');
    });

    it('never pays the same ORDER_MATCH twice (payments ledger)', () => {
        const d = evaluateObligation(scenario({
            consent: {
                payments: [{ orderMatchActionIndex: '900', coinAmountBase: '500000', txid: 't', at: new Date(0).toISOString() }],
            },
        }));
        expect(d).toEqual({ action: 'skip', reason: 'already-paid' });
    });
});

describe('evaluateObligation - deadline handling', () => {
    it('skips expired obligations (paying would burn the coin)', () => {
        const d = evaluateObligation(scenario({ obligation: { expiration: NOW - 1 } }));
        expect(d).toEqual({ action: 'skip', reason: 'expired' });
    });

    it('refuses rows with no usable deadline (opposite of the PC-15 display rule)', () => {
        const d = evaluateObligation(scenario({ obligation: { expiration: 'garbage' } }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'no-deadline' });
    });

    it('refuses a FIRST attempt inside the arming cutoff', () => {
        const d = evaluateObligation(scenario({
            obligation: { expiration: NOW + ARMING_CUTOFF_SECONDS },
        }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'past-arming-cutoff' });
    });

    it('allows a first attempt one second outside the arming cutoff', () => {
        const d = evaluateObligation(scenario({
            obligation: { expiration: NOW + ARMING_CUTOFF_SECONDS + 1 },
        }));
        expect(d.action).toBe('pay');
    });

    it('refuses a RETRY inside the retry cutoff but allows it outside', () => {
        const inside = evaluateObligation(scenario({
            alreadyAttempted: true,
            obligation: { expiration: NOW + RETRY_CUTOFF_SECONDS },
        }));
        expect(inside).toEqual({ action: 'notify-manual', reason: 'past-retry-cutoff' });
        const outside = evaluateObligation(scenario({
            alreadyAttempted: true,
            obligation: { expiration: NOW + RETRY_CUTOFF_SECONDS + 1 },
        }));
        expect(outside.action).toBe('pay');
    });

    it('pins the retry cutoff to the PC-15 at-risk band', () => {
        expect(RETRY_CUTOFF_SECONDS).toBe(30 * 60);
        expect(ARMING_CUTOFF_SECONDS).toBe(45 * 60);
    });
});

describe('evaluateObligation - trust-anchor caps', () => {
    it('degrades to manual when the match row is unavailable', () => {
        const d = evaluateObligation(scenario({ matchRow: null }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'match-unavailable' });
    });

    it('degrades to manual when fill amounts are missing (pre-PC-16 explorer)', () => {
        const d = evaluateObligation(scenario({ matchRow: { give_amount: undefined } }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'amounts-unavailable' });
    });

    it('waits while the consented order index is unresolved', () => {
        const d = evaluateObligation(scenario({ consent: { orderActionIndex: null } }));
        expect(d).toEqual({ action: 'wait', reason: 'order-index-unresolved' });
    });

    it('refuses a non-coinpay match shape and skips an invalid match', () => {
        expect(evaluateObligation(scenario({ matchRow: { settlement_type: 'instant' } })).reason)
            .toBe('match-shape');
        expect(evaluateObligation(scenario({ matchRow: { status: 'invalid: whatever' } })))
            .toEqual({ action: 'skip', reason: 'match-invalid' });
    });

    it('refuses when the obligation amount disagrees with the match fill', () => {
        const d = evaluateObligation(scenario({ obligation: { coin_amount: '500001' } }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'amount-mismatch' });
    });

    it('refuses a fill priced above the consented GIVE/GET ratio', () => {
        // 100 tokens should cost 500000 base; a 600000 fill overpays.
        const d = evaluateObligation(scenario({
            obligation: { coin_amount: '600000' },
            matchRow: { give_amount: '0.006' },
        }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'price-exceeds-terms' });
    });

    it('tolerates exactly one base unit of fill rounding, no more', () => {
        const okOne = evaluateObligation(scenario({
            obligation: { coin_amount: '500001' },
            matchRow: { give_amount: '0.00500001' },
        }));
        expect(okOne.action).toBe('pay');
        const overTwo = evaluateObligation(scenario({
            obligation: { coin_amount: '500002' },
            matchRow: { give_amount: '0.00500002' },
        }));
        expect(overTwo).toEqual({ action: 'notify-manual', reason: 'price-exceeds-terms' });
    });

    it('enforces the cumulative GIVE budget across recorded payments', () => {
        // 4.6m of the 5m budget already paid; a 0.005 (500k) fill busts it.
        const d = evaluateObligation(scenario({
            consent: {
                payments: [{ orderMatchActionIndex: '1', coinAmountBase: '4600000', txid: 't', at: new Date(0).toISOString() }],
            },
        }));
        expect(d).toEqual({ action: 'notify-manual', reason: 'exceeds-give-budget' });
    });

    it('holds the caps in exact integer math past 2^53 (DOGE-scale)', () => {
        const d = evaluateObligation(scenario({
            consent: { giveCoinAmount: '13000000000.00000001', getAmount: '1000' },
            obligation: { coin_amount: '1300000000000000001' },
            matchRow: { give_amount: '13000000000.00000001', get_amount: '1000' },
        }));
        expect(d).toEqual({ action: 'pay', reason: 'ok', payAmountBase: '1300000000000000001' });
    });
});

describe('leaseState', () => {
    const TTL = 180_000;
    it('claims an absent or stale lease, respects a live foreign one, renews its own', () => {
        const nowMs = NOW * 1000;
        expect(leaseState(null, 'me', nowMs, TTL)).toBe('claimable');
        const stale = { holderId: 'other', shellKind: 'web', renewedAt: new Date(nowMs - TTL - 1).toISOString() };
        expect(leaseState(stale, 'me', nowMs, TTL)).toBe('claimable');
        const live = { ...stale, renewedAt: new Date(nowMs - 1000).toISOString() };
        expect(leaseState(live, 'me', nowMs, TTL)).toBe('other-live');
        expect(leaseState({ ...live, holderId: 'me' }, 'me', nowMs, TTL)).toBe('mine');
    });

    it('treats an unparseable renewal timestamp as claimable', () => {
        expect(leaseState({ holderId: 'x', shellKind: 'web', renewedAt: 'zzz' }, 'me', 0, TTL))
            .toBe('claimable');
    });
});
