// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: narrow labels and balances.
//
//   [P1] 2026-10-13: Compact controls could surrender label width at the
//        320px popup breakpoint, while a long balance could lose digits.

import { readFileSync } from 'node:fs';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BalanceList } from '../../packages/core/src/shared/components/BalanceList.jsx';
import { NetworkFilter } from '../../packages/core/src/shared/components/NetworkFilter.jsx';
import { formatAtomicAmount } from '../../packages/core/src/shared/utils/amountFormat.js';
import { Button } from '../../packages/core/src/ui/Button.jsx';
import buttonStyles from '../../packages/core/src/ui/Button.module.css';
import { ChainBadge } from '../../packages/core/src/ui/ChainBadge.jsx';
import chainBadgeStyles from '../../packages/core/src/ui/ChainBadge.module.css';
import { Chip } from '../../packages/core/src/ui/Chip.jsx';
import chipStyles from '../../packages/core/src/ui/Chip.module.css';
import filterStyles from '../../packages/core/src/shared/components/NetworkFilter.module.css';

const buttonCss = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');
const chainBadgeCss = readFileSync('packages/core/src/ui/ChainBadge.module.css', 'utf8');
const chipCss = readFileSync('packages/core/src/ui/Chip.module.css', 'utf8');
const filterCss = readFileSync(
    'packages/core/src/shared/components/NetworkFilter.module.css',
    'utf8',
);
const balanceCss = readFileSync(
    'packages/core/src/shared/components/BalanceList.module.css',
    'utf8',
);
const listRowCss = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');

const descriptor = {
    id: 'bitcoin-mainnet',
    coin: 'bitcoin',
    color: '#f7931a',
    displayName: 'Bitcoin',
    networkKind: 'mainnet',
};
const chainRegistry = {
    byCoin: (coin) => (coin === 'bitcoin' ? [descriptor] : []),
};
const initialInnerWidth = window.innerWidth;

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    window.dispatchEvent(new Event('resize'));
});

afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: initialInnerWidth,
    });
});

describe('regression/no-letter-wrap', () => {
    it('[REGRESSION P1] keeps compact control labels whole at 320px', () => {
        render(
            <div style={{ width: 320 }}>
                <Button icon={null}>Claim</Button>
                <Chip>Closing soon</Chip>
                <ChainBadge descriptor={descriptor} />
                <NetworkFilter
                    chainRegistry={chainRegistry}
                    coinFamilies={['bitcoin']}
                    value="all"
                    onChange={() => {}}
                />
            </div>,
        );

        const claim = screen.getByRole('button', { name: 'Claim' });
        const chip = screen.getByText('Closing soon');
        const badge = screen.getByText('Bitcoin').closest(`.${chainBadgeStyles.badge}`);
        const filter = screen.getByRole('button', { name: /All networks/ });
        const filterWrap = filter.closest(`.${filterStyles.wrap}`);

        expect(window.innerWidth).toBe(320);
        expect(claim).toHaveClass(buttonStyles.btn);
        expect(chip).toHaveClass(chipStyles.chip);
        expect(badge).toBeInTheDocument();
        expect(filter).toHaveClass(chipStyles.chip, filterStyles.trigger);
        expect(filter).toHaveTextContent('All networks');
        // The count is announced in the accessible name, not drawn beside the label.
        expect(filter).not.toHaveTextContent('1 network');
        expect(filterWrap).toBeInTheDocument();

        // Buttons keep flex-shrink 0 so a row never squeezes a short label, but
        // both batches let a label wider than its whole column wrap (the send
        // review footer carries amounts longer than a 320px line).
        expect.soft(rule(buttonCss, '.btn')).toMatch(/flex-shrink:\s*0/);
        expect.soft(rule(buttonCss, '.btn')).toMatch(/white-space:\s*normal/);
        for (const [css, selector] of [
            [chipCss, '.chip'],
            [chainBadgeCss, '.badge'],
        ]) {
            expect.soft(rule(css, selector), `${selector} must not flex-shrink`)
                .toMatch(/flex-shrink:\s*0/);
            expect.soft(rule(css, selector), `${selector} must not wrap`)
                .toMatch(/white-space:\s*nowrap/);
        }
        expect(rule(filterCss, '.wrap')).toMatch(/min-width:\s*min\(10rem, 100%\)/);
        expect(rule(filterCss, '.triggerLabel')).toMatch(/white-space:\s*nowrap/);
    });

    it('[REGRESSION P1] preserves every digit of a long balance at 320px', () => {
        const quantity = '100000000000000';
        const formattedQuantity = formatAtomicAmount(quantity, 7);

        render(
            <div style={{ width: 320 }}>
                <BalanceList
                    rows={[{
                        chainId: 'bitcoin-mainnet',
                        tick: 'EXTRAORDINARILYLONGTICKER',
                        kind: 'token',
                        displayName: 'A token name long enough to yield the narrow balance row',
                        quantity,
                        divisibility: 7,
                        fiatRate: null,
                    }]}
                    onSelectToken={() => {}}
                />
            </div>,
        );

        const renderedQuantity = screen.getByTitle(formattedQuantity);
        expect(window.innerWidth).toBe(320);
        expect(formattedQuantity.replace(/\D/g, '')).toHaveLength(quantity.length);
        expect(renderedQuantity).toHaveTextContent(formattedQuantity);
        expect(renderedQuantity.textContent.replace(/\D/g, '')).toBe(quantity);
        expect(rule(listRowCss, '.content')).toMatch(/flex:\s*1 1 auto;[^}]*min-width:\s*0/s);
        expect(listRowCss).toMatch(/\.trailing,[^{]*\{[^}]*flex:\s*0 0 auto/);
        expect(rule(balanceCss, '.amounts')).toMatch(/min-width:\s*0/);
        expect(rule(balanceCss, '.qty')).toMatch(/font-variant-numeric:\s*tabular-nums/);
        expect(rule(balanceCss, '.qty')).not.toMatch(/text-overflow:\s*ellipsis/);
    });
});
