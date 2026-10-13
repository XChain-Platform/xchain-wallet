// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: 1, fiatCurrency: 'EUR' }),
}));

const { DetailCard, EntryRow } = await import('../../../packages/core/src/shared/routes/History.jsx');

afterEach(() => cleanup());

describe('History amount formatting', () => {
    it.each([
        ['incoming', 'external-address', '1.25000000', 'in', '+1.25 BTC'],
        ['outgoing', 'wallet-address', '1.25000000', 'out', '-1.25 BTC'],
        ['incoming dust', 'external-address', '0.000000001', 'in', '+< 0.00000001 BTC'],
    ])('shows a consistent sign and precision for %s rows', (
        _label,
        source,
        amount,
        direction,
        expected,
    ) => {
        const entry = {
            key: `row-${direction}-${amount}`,
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: 'bitcoin-mainnet',
            address: 'wallet-address',
            source,
            raw: { source, tick: 'BTC', amount },
        };

        const { container } = render(
            <EntryRow
                entry={entry}
                selected={false}
                showConnector={false}
                onClick={vi.fn()}
                peerCache={{}}
                walletId="wallet-a"
            />,
        );

        const amountNode = container.querySelector('[data-history-amount]');
        expect(amountNode.getAttribute('data-history-amount')).toBe(direction);
        expect(amountNode.textContent).toBe(expected);
    });

    it('keeps a native amount exact and uses the selected fiat currency', () => {
        const amount = '9007199254740993.01';
        const messaging = { listContacts: vi.fn().mockResolvedValue([]) };
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: 'bitcoin-mainnet',
            address: 'wallet-address',
            source: 'external-address',
            raw: { source: 'external-address', tick: 'BTC', amount },
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <DetailCard
                        entry={entry}
                        peerCache={{}}
                        walletId="wallet-a"
                        showFiatInHistory
                        fiatCurrency="EUR"
                    />
                </ToastHost>
            </MessagingProvider>,
        );

        const amountRow = screen.getByRole('rowheader', { name: 'Amount' }).closest('tr');
        expect(amountRow.textContent).toContain('+9,007,199,254,740,993.01');
        expect(amountRow.textContent).toContain('€9,007,199,254,740,993.01');
        expect(amountRow.textContent).not.toContain('$');

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const amountRows = screen.getAllByRole('rowheader', { name: 'Amount' });
        expect(amountRows).toHaveLength(2);
        expect(amountRows[1].closest('tr').textContent)
            .toContain('+9,007,199,254,740,993.01');
    });
});
