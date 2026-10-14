// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    evaluateObligation,
    leaseState,
    orientMatch,
    paidBase,
    remainingGiveBase,
} from '../../../packages/core/src/market/autopayPolicy.js';

const NOW = 1_800_000_000;

function scenario(overrides = {}) {
    const consent = {
        chainId: 'bitcoin-regtest',
        orderActionIndex: '500',
        giveCoinAmount: '0.05',
        getAmount: '1000',
        autopay: true,
        payments: [],
        ...overrides.consent,
    };
    const obligation = {
        action_index: '900',
        coin_amount: '0.005',
        expiration: NOW + 7200,
        block_index: 100,
        coinpay_status: 'pending_coinpay',
        ...overrides.obligation,
    };
    const matchRow = overrides.matchRow === null ? null : {
        action_index: '900',
        give_action_index: '600',
        get_action_index: '500',
        give_amount: '0.005',
        get_amount: '100',
        settlement_type: 'coinpay',
        status: 'pending_coinpay',
        ...overrides.matchRow,
    };
    return {
        obligation,
        consent,
        matchRow,
        tipHeight: overrides.tipHeight ?? 101,
        nowSeconds: NOW,
        alreadyAttempted: false,
    };
}

describe('market/autopayPolicy uncovered input gates', () => {
    it('fails closed for missing inputs, match indexes, and payment ledgers', () => {
        expect(evaluateObligation({})).toEqual({ action: 'skip', reason: 'missing-input' });
        expect(evaluateObligation(scenario({ obligation: { action_index: null } })))
            .toEqual({ action: 'notify-manual', reason: 'no-match-index' });
        expect(evaluateObligation(scenario({ consent: { payments: null } })))
            .toEqual({ action: 'notify-manual', reason: 'terms-unparseable' });
    });

    it('rejects empty indexes, zero amounts, and non-digit payment amounts', () => {
        const consent = scenario().consent;
        expect(paidBase({ ...consent, payments: [null] })).toBeNull();
        expect(paidBase({
            ...consent,
            payments: [{ orderMatchActionIndex: '', coinAmountBase: '1' }],
        })).toBeNull();
        expect(paidBase({
            ...consent,
            payments: [{ orderMatchActionIndex: '1', coinAmountBase: '0' }],
        })).toBeNull();
        expect(paidBase({
            ...consent,
            payments: [{ orderMatchActionIndex: '1', coinAmountBase: '1.5' }],
        })).toBeNull();
        expect(remainingGiveBase({ ...consent, payments: null })).toBeNull();
    });

    it('rejects rows with an empty token fill or no identifying order', () => {
        const { matchRow } = scenario();
        expect(orientMatch(matchRow, '')).toBeNull();
        expect(orientMatch({ ...matchRow, get_amount: '' }, '500')).toBeNull();
    });
});

describe('market/autopayPolicy uncovered decision branches', () => {
    it('waits when either chain height is unusable', () => {
        expect(evaluateObligation(scenario({ obligation: { block_index: 'not-a-height' } })))
            .toEqual({ action: 'wait', reason: 'awaiting-depth' });
        expect(evaluateObligation(scenario({ tipHeight: 0 })))
            .toEqual({ action: 'wait', reason: 'awaiting-depth' });
    });

    it('checks the fetched match identity before its settlement fields', () => {
        expect(evaluateObligation(scenario({ matchRow: { action_index: '901' } })))
            .toEqual({ action: 'notify-manual', reason: 'match-mismatch' });
        expect(evaluateObligation(scenario({ matchRow: { status: 'INVALID: reorg' } })))
            .toEqual({ action: 'skip', reason: 'match-invalid' });
    });

    it('fails closed for invalid ratio terms and a zero requested total', () => {
        expect(evaluateObligation(scenario({ matchRow: { get_amount: 'not-an-amount' } })))
            .toEqual({ action: 'notify-manual', reason: 'terms-unparseable' });
        expect(evaluateObligation(scenario({ consent: { getAmount: '0' } })))
            .toEqual({ action: 'notify-manual', reason: 'terms-unparseable' });
        expect(evaluateObligation(scenario({ consent: { giveCoinAmount: 'invalid' } })))
            .toEqual({ action: 'notify-manual', reason: 'terms-unparseable' });
    });

    it('supports camel-case obligation fields through the full pay path', () => {
        const input = scenario();
        delete input.obligation.action_index;
        delete input.obligation.coin_amount;
        delete input.obligation.block_index;
        delete input.obligation.coinpay_status;
        Object.assign(input.obligation, {
            actionIndex: '900',
            coinAmount: '0.005',
            blockIndex: 100,
            coinpayStatus: 'pending_coinpay',
        });

        expect(evaluateObligation(input)).toEqual({
            action: 'pay',
            reason: 'ok',
            payAmountBase: '500000',
        });
    });
});

describe('market/autopayPolicy uncovered lease shapes', () => {
    it('treats a lease without a string renewal time as claimable', () => {
        expect(leaseState({ holderId: 'other', renewedAt: 123 }, 'me', NOW * 1000, 1000))
            .toBe('claimable');
    });
});
