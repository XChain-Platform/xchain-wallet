// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    consensusRefusalDetail,
    consensusRefusalMessage,
} from '../../../packages/core/src/shared/utils/preflightFindingKey.js';

function refusal(status) {
    return { severity: 'error', data: { status } };
}

describe('consensusRefusalMessage', () => {
    it('maps the current price-batch trailing-data refusal', () => {
        const raw = 'invalid: trailing data after batch signatures';
        const finding = refusal(raw);
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this price batch because it contains extra data after its signatures.');
        expect(consensusRefusalMessage(finding)).not.toContain('trailing data');
    });

    it('keeps an unknown refusal out of display copy and exposes it as details', () => {
        const raw = 'invalid: future internal consensus wording';
        const finding = refusal(raw);
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this action for a reason the wallet could not explain.');
        expect(consensusRefusalDetail(finding)).toBe('future internal consensus wording');
    });

    it('hides the encoder service\'s uninformative internal error', () => {
        const finding = refusal('invalid: Internal encoder error');
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this action for a reason the wallet could not explain.');
        expect(consensusRefusalDetail(finding)).toBe('Internal encoder error');
    });

    it('keeps addresses and access-list numbers in a specific refusal', () => {
        const reason = 'address tb1qexample is not on allow-list #42';
        expect(consensusRefusalMessage(refusal(`invalid: ${reason}`)))
            .toBe('The network refused this action: Address tb1qexample is not on allow-list #42.');
    });
});
