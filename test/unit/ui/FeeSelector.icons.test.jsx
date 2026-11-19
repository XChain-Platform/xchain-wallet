// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every button in the fee selector carries an icon: the four speed stops and
// both click-to-edit figures.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FeeSelector } from '../../../packages/core/src/ui/FeeSelector.jsx';

afterEach(cleanup);

const estimate = (rateValue, coinAmount, etaMinutes) => ({
    rateValue, rate: `${rateValue} sat/vB`, coinAmount, etaMinutes, unit: 'sat/vB', vsize: 250,
});
const tiers = {
    low: estimate(1, '0.00000250', 60),
    normal: estimate(6, '0.00001500', 30),
    fast: estimate(12, '0.00003000', 10),
    unit: 'sat/vB',
    minimumRate: 1,
};

describe('FeeSelector button icons', () => {
    it('puts an svg icon in every button in tier mode', () => {
        const { container } = render(<FeeSelector tiers={tiers} value={{ mode: 'normal' }} onChange={() => {}} />);
        const buttons = [...container.querySelectorAll('button')];
        // Four stops plus the amount and rate edit links.
        expect(buttons).toHaveLength(6);
        for (const b of buttons) expect(b.querySelector('svg[data-xc-icon]')).not.toBeNull();
    });

    it('puts an svg icon in every button in custom mode', () => {
        const { container } = render(
            <FeeSelector
                tiers={tiers}
                value={{ mode: 'custom', customRate: 4 }}
                customEstimate={{ rate: '4 sat/vB', rateValue: 4, coinAmount: '0.00000400', vsize: 100 }}
                onChange={() => {}}
            />,
        );
        const buttons = [...container.querySelectorAll('button')];
        expect(buttons.length).toBeGreaterThanOrEqual(5);
        for (const b of buttons) expect(b.querySelector('svg[data-xc-icon]')).not.toBeNull();
    });

    it('gives the four stops four different icons', () => {
        const { container } = render(<FeeSelector tiers={tiers} value={{ mode: 'normal' }} onChange={() => {}} />);
        const stops = [...container.querySelectorAll('button[aria-label]')].slice(0, 4);
        const shapes = stops.map((b) => b.querySelector('svg').innerHTML);
        expect(new Set(shapes).size).toBe(4);
    });
});
