// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { DetailCard, EntryRow } from '../../../packages/core/src/shared/routes/History.jsx';
import { formatLocalDateTime } from '../../../packages/core/src/shared/utils/dateTime.js';

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
    it('shows an exact History timestamp in local time', () => {
        const timestamp = Date.parse('2024-01-15T20:30:00Z') / 1000;
        const messaging = {
            listContacts: vi.fn().mockResolvedValue([]),
        };
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: CHAIN,
            timestamp,
            raw: {},
        };
        const expected = formatLocalDateTime(timestamp);

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

        expect(screen.getByText(expected)).toBeInTheDocument();
        // On a host whose local zone is UTC the local rendering legitimately
        // ends in UTC, so the absence check only means something elsewhere.
        const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (localZone !== 'UTC' && localZone !== 'Etc/UTC') {
            expect(screen.queryByText(/ UTC$/)).toBeNull();
        }
    });

    it('opens the selected row', () => {
        const onClick = vi.fn();
        render(provider(
            {},
            <ul>
                <EntryRow
                    entry={{
                        key: 'bitcoin-mainnet:12',
                        action: 'SEND',
                        actionIndex: '12',
                        blockIndex: 100,
                        chainId: CHAIN,
                        source: ADDRESS,
                        raw: {},
                    }}
                    selected={false}
                    showConnector={false}
                    onClick={onClick}
                    peerCache={{}}
                    walletId="wallet-a"
                />
            </ul>,
        ));

        fireEvent.click(screen.getByRole('button', { name: /Send.*Confirmed/i }));

        expect(onClick).toHaveBeenCalledOnce();
    });

    it('announces signed settled amounts as sent or received phrases', () => {
        render(provider(
            {},
            <ul>
                <EntryRow
                    entry={{
                        key: 'bitcoin-mainnet:sent',
                        action: 'SEND',
                        actionIndex: '12',
                        blockIndex: 100,
                        chainId: CHAIN,
                        source: ADDRESS,
                        address: ADDRESS,
                        raw: { amount: '2', tick: 'BTC' },
                    }}
                    selected={false}
                    showConnector={false}
                    onClick={() => {}}
                    peerCache={{}}
                    walletId="wallet-a"
                />
                <EntryRow
                    entry={{
                        key: 'bitcoin-mainnet:received',
                        action: 'SEND',
                        actionIndex: '13',
                        blockIndex: 101,
                        chainId: CHAIN,
                        source: 'bc1qsender',
                        address: ADDRESS,
                        raw: { amount: '3.5', tick: 'BTC' },
                    }}
                    selected={false}
                    showConnector={false}
                    onClick={() => {}}
                    peerCache={{}}
                    walletId="wallet-a"
                />
            </ul>,
        ));

        expect(screen.getByLabelText('Sent 2 BTC')).toHaveTextContent('-2 BTC');
        expect(screen.getByLabelText('Received 3.5 BTC')).toHaveTextContent('+3.5 BTC');
    });

    it('labels a history address row with its chain and non-mainnet kind', () => {
        render(provider(
            {},
            <ul>
                <EntryRow
                    entry={{
                        key: 'litecoin-regtest:12',
                        action: 'SEND',
                        actionIndex: '12',
                        blockIndex: 100,
                        chainId: 'litecoin-regtest',
                        source: 'rltc1qsource',
                        raw: {},
                    }}
                    selected={false}
                    showConnector={false}
                    onClick={() => {}}
                    peerCache={{}}
                    walletId="wallet-a"
                />
            </ul>,
        ));

        const row = screen.getByRole('button', { name: /Send.*Confirmed/i });
        expect(row).toHaveTextContent(/Litecoin\s+regtest/i);
        expect(row).toHaveTextContent('rltc1qsource');
    });

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

    it('reports copy failures for detail values and receipts', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Copy transaction ID' }));
        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'More' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy receipt' }));
        expect(document.execCommand).toHaveBeenCalledTimes(2);
        await waitFor(() => {
            expect(screen.getAllByText('Copy failed: clipboard unavailable')).toHaveLength(2);
        });
    });

    it('copies the full transaction hash and builds working explorer destinations', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const txHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: CHAIN,
            txHash,
            source: ADDRESS,
            address: ADDRESS,
            raw: {},
        };

        try {
            render(provider(
                { listContacts: vi.fn().mockResolvedValue([]) },
                <DetailCard
                    entry={entry}
                    peerCache={{}}
                    walletId="wallet-a"
                    showFiatInHistory={false}
                    fiatCurrency="USD"
                />,
            ));

            fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
            fireEvent.click(screen.getByRole('button', { name: 'Copy transaction ID' }));
            await waitFor(() => expect(writeText).toHaveBeenCalledWith(txHash));

            expect(screen.getByRole('link', { name: 'XChain' }))
                .toHaveAttribute('href', 'https://explorer.xchain.io/BTC/action/12');
            expect(screen.getByRole('link', { name: 'Mempool' }))
                .toHaveAttribute('href', `https://mempool.space/tx/${txHash}`);
            expect(screen.getByRole('link', { name: 'Blockstream' }))
                .toHaveAttribute('href', `https://blockstream.info/tx/${txHash}`);
        } finally {
            if (clipboardDescriptor) {
                Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
            } else {
                delete navigator.clipboard;
            }
        }
    });

    it('copies a plain-text transaction receipt from the detail menu', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const txHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0';
        const entry = {
            action: 'SEND',
            actionIndex: '12',
            blockIndex: 100,
            chainId: 'dogecoin-testnet',
            timestamp: 1705350600,
            txHash,
            source: 'private-source',
            address: 'private-wallet-address',
            raw: {
                amount: '15',
                tick: 'DOGE',
                fee: '0.25',
                destination: 'private-destination',
                memo: 'private memo',
            },
        };

        try {
            render(provider(
                { listContacts: vi.fn().mockResolvedValue([]) },
                <DetailCard
                    entry={entry}
                    peerCache={{}}
                    walletId="wallet-a"
                    showFiatInHistory={false}
                    fiatCurrency="USD"
                />,
            ));

            fireEvent.click(screen.getByRole('button', { name: 'More' }));
            fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy receipt' }));

            await waitFor(() => expect(writeText).toHaveBeenCalledWith([
                'Date: 2024-01-15T20:30:00.000Z',
                'Chain: Dogecoin Testnet',
                'Amount: 15 DOGE',
                'Network fee: 0.25 DOGE',
                `Transaction ID: ${txHash}`,
                `Explorer: https://explorer.xchain.io/TDOGE/tx/${txHash}`,
            ].join('\n')));
            expect(writeText.mock.calls[0][0]).not.toMatch(/private|memo|wallet-a/i);
            expect(await screen.findByText('Transaction receipt copied.')).toBeInTheDocument();
        } finally {
            if (clipboardDescriptor) {
                Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
            } else {
                delete navigator.clipboard;
            }
        }
    });
});
