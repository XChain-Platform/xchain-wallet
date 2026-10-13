// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: 1, fiatCurrency: 'EUR' }),
}));

const { DetailCard } = await import('../../../packages/core/src/shared/routes/History.jsx');

afterEach(() => cleanup());

describe('History amount formatting', () => {
    it('keeps a native amount exact and uses the selected fiat currency', () => {
        const amount = '9007199254740993.01';
        const messaging = { listContacts: vi.fn().mockResolvedValue([]) };
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: 'bitcoin-mainnet',
            raw: { tick: 'BTC', amount },
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
        expect(amountRow.textContent).toContain('9,007,199,254,740,993.01');
        expect(amountRow.textContent).toContain('€9,007,199,254,740,993.01');
        expect(amountRow.textContent).not.toContain('$');
    });
});
