// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// , the other half. `fiatRateForTick` returns null for a token, and the
// whole fix rests on null meaning "render no fiat at all" in AmountField. That
// contract is documented in a JSDoc line and nowhere else, so it is pinned here:
// if a future edit made a null rate render "≈ 0.00 USD" or kept the unit toggle
// alive, the gate would go on returning null and the wrong number would come
// back with no test failing anywhere.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

const RATE = { rate: 67000, fiatCurrency: 'USD' };

function mount(props) {
    return render(React.createElement(AmountField, {
        amount: '2',
        tick: 'BTC',
        onAmountFieldChange() {},
        toggleAmountInputMode() {},
        amountInputMode: 'coin',
        ...props,
    }));
}

describe('AmountField fiat gate ', () => {
    it('shows the approximate value and the unit toggle when a rate is supplied', () => {
        const u = mount({ fiatRate: RATE });
        expect(u.getByRole('button', { name: /switch input to usd/i })).toBeTruthy();
        expect(u.container.textContent).toMatch(/≈\s*134,000\.00 USD/);
    });

    // What a token amount must look like: no number, no toggle, nothing to
    // misread as a valuation.
    it('renders no fiat preview and no toggle when the rate is null', () => {
        const u = mount({ fiatRate: null, tick: 'XCHAIN', amount: '50000' });
        expect(u.queryByRole('button', { name: /switch input to/i })).toBeNull();
        expect(u.container.textContent).not.toMatch(/≈/);
        expect(u.container.textContent).not.toMatch(/USD/);
    });

    // Belt and braces: even if a stale 'fiat' input mode survives the switch to
    // a token, a null rate must not resurrect the fiat rendering.
    it('ignores a stale fiat input mode when the rate is null', () => {
        const u = mount({
            fiatRate: null, tick: 'XCHAIN', amount: '50000',
            fiatAmount: '999', amountInputMode: 'fiat',
        });
        expect(u.container.textContent).not.toMatch(/≈/);
        expect(u.queryByRole('button', { name: /switch input to/i })).toBeNull();
    });
});
