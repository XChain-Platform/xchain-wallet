// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A payment link can fill the amount with a hundred-digit value. Its fiat
// estimate is one grouped number with no space to break at, so the estimate
// must be allowed to wrap inside the unit toggle; without that it ran past
// both edges of a phone-width form, clipped at the start and the end.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { AmountField } from '../../../packages/core/src/shared/components/AmountField.jsx';

const STYLES = readFileSync('packages/core/src/shared/components/AmountField.module.css', 'utf8');

function cssRule(selector) {
    return STYLES.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

afterEach(cleanup);

describe('estimate for a very long amount', () => {
    it('renders the whole estimate in a span that may break between any digits', () => {
        const amount = '9'.repeat(120);
        const { container } = render(
            <AmountField
                id="a"
                amount={amount}
                tick="BTC"
                fiatRate={{ rate: 65000, fiatCurrency: 'USD' }}
                onAmountFieldChange={() => {}}
                toggleAmountInputMode={() => {}}
            />,
        );
        const value = [...container.querySelectorAll('span')].find((el) => el.textContent.startsWith('≈ $'));
        expect(value.textContent.replace(/[^\d]/g, '').length).toBeGreaterThan(120);
        expect(cssRule('amountSwapValue')).toMatch(/overflow-wrap:\s*anywhere/);
        expect(cssRule('amountSwapValue')).toMatch(/min-width:\s*0/);
    });
});
