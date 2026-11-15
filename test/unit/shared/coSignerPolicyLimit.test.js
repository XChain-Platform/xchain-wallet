// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    confirmationThresholdSummary,
    perActionLimitSummary,
    policyNoLimitText,
    rollingLimitSummary,
} from '../../../packages/core/src/shared/utils/coSignerPolicyLimit.js';

describe('co-signer policy limit summaries', () => {
    it('describes action caps with display labels and wildcard wording', () => {
        expect(perActionLimitSummary({
            SEND: { BTC: '0.25', '*': '100' },
            MINT: { XCP: '2' },
        })).toEqual([
            'Send: up to 0.25 BTC per action',
            'Send: up to 100 of any token per action',
            'Mint: up to 2 XCP per action',
        ]);
    });

    it('describes every rolling cap without dropping per-token limits', () => {
        expect(rollingLimitSummary({
            hours: 12,
            maxActions: 4,
            perTick: { BTC: '2', XCP: '50' },
        })).toEqual([
            'At most 4 actions every 12 hours',
            'Up to 2 BTC every 12 hours',
            'Up to 50 XCP every 12 hours',
        ]);
        expect(rollingLimitSummary({ hours: 6, perTick: { BTC: '1' } }))
            .toEqual(['Up to 1 BTC every 6 hours']);
    });

    it('describes large-request flags without claiming extra approval', () => {
        expect(confirmationThresholdSummary({ perTick: { BTC: '1.5' } }))
            .toEqual(['Flag requests over 1.5 BTC as large']);
    });

    it('keeps null policies as no limit', () => {
        expect(policyNoLimitText(null)).toBe('No limit');
        expect(perActionLimitSummary(null)).toBeNull();
        expect(rollingLimitSummary(null)).toBeNull();
        expect(confirmationThresholdSummary(null)).toBeNull();
    });
});
