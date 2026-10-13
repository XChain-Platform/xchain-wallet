// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { DetailCard } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function provider(messaging, child) {
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>{child}</ToastHost>
        </MessagingProvider>
    );
}

afterEach(() => cleanup());

describe('History usability', () => {
    it('caps a large recipient preview without creating a nested scroll area', async () => {
        const recipients = Array.from({ length: 25 }, (_, i) => ({
            address: `bc1qrecipient${String(i).padStart(2, '0')}`,
            balance: String(i + 1),
        }));
        const messaging = {
            getDividendRecipients: vi.fn().mockResolvedValue({ recipients }),
            saveContact: vi.fn(),
            listContacts: vi.fn().mockResolvedValue([]),
        };
        const entry = {
            action: 'DIVIDEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: CHAIN,
            raw: { TICK: 'PEPE' },
        };
        render(provider(
            messaging,
            <DetailCard
                entry={entry}
                peerCache={{}}
                walletId="wallet-a"
                showFiatInHistory={false}
                fiatCurrency="USD"
            />,
        ));

        fireEvent.click(screen.getByRole('button', { name: 'Show holders' }));

        expect(await screen.findByText('25 holders')).toBeInTheDocument();
        expect(screen.getByText('… and 5 more not shown')).toBeInTheDocument();
        expect(screen.getByText('bc1qrecipient19')).toBeInTheDocument();
        expect(screen.queryByText('bc1qrecipient20')).toBeNull();
        const preview = screen.getByText('bc1qrecipient00').parentElement.parentElement;
        expect(preview.style.overflowY).toBe('');
        expect(preview.style.maxHeight).toBe('');
    });

    it('reports copy failures for detail values and action links', async () => {
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn(() => false),
        });
        const messaging = {
            listContacts: vi.fn().mockResolvedValue([]),
        };
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: CHAIN,
            txHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0',
            source: ADDRESS,
            address: ADDRESS,
            raw: {},
        };
        render(provider(
            messaging,
            <DetailCard
                entry={entry}
                peerCache={{}}
                walletId="wallet-a"
                showFiatInHistory={false}
                fiatCurrency="USD"
            />,
        ));

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        fireEvent.click(screen.getByRole('button', { name: 'Copy index' }));
        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy action link' }));
        expect(document.execCommand).toHaveBeenCalledTimes(2);
        await waitFor(() => {
            expect(screen.getAllByText('Copy failed: clipboard unavailable')).toHaveLength(2);
        });
    });
});
