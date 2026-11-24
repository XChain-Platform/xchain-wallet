// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { confirmHeadline } from '../../../packages/core/src/shared/utils/confirmStandardModel.js';

describe('bet confirmation provenance', () => {
    it('uses the composed stake and outcome instead of a conflicting form summary', () => {
        const headline = confirmHeadline({
            actionName: 'BET',
            summary: { amount: '20', ticker: 'XCHAIN', target: 'No' },
            decoded: {
                summary: 'Buy 10 of outcome 0 in market 123',
                details: [
                    { label: 'Market', value: '123' },
                    { label: 'Outcome', value: '0 ("Yes")' },
                    { label: 'Stake', value: '10' },
                ],
            },
        });
        expect(headline.sentence).toBe('Buy 10 XCHAIN of Yes (outcome 0)');
        expect(headline.sentence).not.toContain('20');
        expect(headline.sentence).not.toContain('No');
    });

    it('does not rewrite a market resolution as a purchase', () => {
        const headline = confirmHeadline({
            actionName: 'BET',
            decoded: {
                summary: 'Resolve market 123 to outcome 0',
                details: [{ label: 'Winning outcome', value: '0 ("Yes")' }],
            },
        });
        expect(headline.sentence).toBe('Resolve market 123 to outcome 0');
    });
});
