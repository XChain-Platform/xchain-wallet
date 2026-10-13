// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Balance rows speak the user's currency. Set to euros, a phone showed
// "€0.00 EUR" on the balance card and "$0.00" on every coin row under it.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BalanceList, formatFiat } from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { CollectiblesView } from '../../../packages/core/src/shared/components/CollectiblesView.jsx';

afterEach(() => cleanup());

describe('formatFiat', () => {
    it('keeps USD as the default', () => {
        expect(formatFiat('0')).toBe('$0.00');
        expect(formatFiat('1234.5')).toBe('$1,234.50');
        expect(formatFiat('0.004')).toBe('<$0.01');
    });

    it('formats in the currency asked for', () => {
        expect(formatFiat('0', 'EUR')).toBe('€0.00');
        expect(formatFiat('1234.5', 'eur')).toBe('€1,234.50');
        expect(formatFiat('0.004', 'GBP')).toBe('<£0.01');
    });

    it('still renders an unknown code', () => {
        expect(formatFiat('5', 'NOTACODE')).toBe('5 NOTACODE');
    });
});

describe('BalanceList rows', () => {
    it('show the fiat value in the given currency', () => {
        const rows = [{
            kind: 'native', chainId: 'bitcoin-mainnet', tick: 'BTC', quantity: '50000000',
            divisibility: 8, fiatRate: 80000, displayName: 'Bitcoin',
        }];
        render(<BalanceList rows={rows} fiatCurrency="EUR" />);
        expect(screen.getByText('€40,000.00')).toBeTruthy();
        expect(screen.queryByText('$40,000.00')).toBeNull();
    });
});

describe('empty list views', () => {
    it('renders the shared empty state and runs the balance action', () => {
        const onAction = vi.fn();
        render(
            <BalanceList
                rows={[]}
                emptyTitle="No matching balances"
                emptyBody="Clear the filter to see every balance."
                emptyActionLabel="Clear filter"
                onEmptyAction={onAction}
            />,
        );

        expect(screen.getByRole('heading', { name: 'No matching balances' })).toBeTruthy();
        expect(screen.getByText('Clear the filter to see every balance.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
        expect(onAction).toHaveBeenCalledOnce();
    });

    it('renders the shared empty state and runs the collectibles action', () => {
        const onReceive = vi.fn();
        render(
            <CollectiblesView
                rows={[]}
                emptyTitle="No collectibles"
                emptyBody="Receive one to see it here."
                onReceive={onReceive}
            />,
        );

        expect(screen.getByRole('heading', { name: 'No collectibles' })).toBeTruthy();
        expect(screen.getByText('Receive one to see it here.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Receive' }));
        expect(onReceive).toHaveBeenCalledOnce();
    });
});
