// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActivityRow, actionIconForAction } from '../../../packages/core/src/shared/components/ActivityRow.jsx';
import rowStyles from '../../../packages/core/src/shared/components/ActivityRow.module.css';
import { ReceiveIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { EntryRow } from '../../../packages/core/src/shared/routes/HistoryEntryRow.jsx';

afterEach(() => cleanup());

const css = readFileSync('packages/core/src/shared/components/ActivityRow.module.css', 'utf8');

function gridRows(source) {
    const areas = /grid-template-areas:\s*([^;]+);/s.exec(source)?.[1] || '';
    return [...areas.matchAll(/"([^"]+)"/g)].map((match) => match[1].split(/\s+/));
}

describe('ActivityRow block line', () => {
    it('places the action and status, amount, then block and time on three lines', () => {
        expect(gridRows(css)).toEqual([
            ['mark', 'label', 'label', 'status', 'trailing'],
            ['mark', 'primary', 'primary', 'primary', 'trailing'],
            ['mark', 'block', 'block', 'time', 'trailing'],
        ]);
        const narrow = /@media \(max-width: 400px\)\s*\{([\s\S]+)\}\s*$/.exec(css)?.[1] || '';
        expect(gridRows(narrow)).toEqual(gridRows(css));
    });

    it('renders a confirmed block in its cell and leaves only the time for pending activity', () => {
        const { container, rerender } = render(
            <ActivityRow
                chainId="bitcoin-regtest"
                tick="BTC"
                isNative
                label="Sent"
                actionIcon={actionIconForAction('send')}
                amount="-0.01 BTC"
                status="confirmed"
                block="Block 123,456"
                timestamp={1_700_000_000}
                onClick={vi.fn()}
            />,
        );

        expect(screen.getByText('Sent').closest(`.${rowStyles.labelCell}`)).not.toBeNull();
        const actionIcon = container.querySelector(`.${rowStyles.actionIcon}`);
        expect(actionIcon).toHaveAttribute('aria-hidden', 'true');
        expect(actionIcon?.querySelector('svg[data-xc-icon]')).not.toBeNull();
        expect(screen.getByText('Confirmed')).toHaveClass(rowStyles.status);
        expect(screen.getByText('-0.01 BTC')).toHaveClass(rowStyles.primary);
        expect(screen.getByText('Block 123,456')).toHaveClass(rowStyles.block);
        expect(container.querySelector(`time.${rowStyles.time}`)).not.toBeNull();

        rerender(
            <ActivityRow
                chainId="bitcoin-regtest"
                tick="BTC"
                isNative
                label="Sending"
                amount="-0.01 BTC"
                status="pending"
                timestamp={1_700_000_000}
                onClick={vi.fn()}
            />,
        );
        expect(container.querySelector(`.${rowStyles.block}`)).toBeNull();
        expect(screen.queryByText(/Block/)).toBeNull();
        expect(container.querySelector(`time.${rowStyles.time}`)).not.toBeNull();
    });

    it('maps real action ids to their decorative inline icons', () => {
        const { container } = render(
            <ActivityRow
                chainId="bitcoin-regtest"
                tick="XCP"
                label="Dividend"
                actionIcon={actionIconForAction('DIVIDEND')}
                amount="0.5 XCP per unit"
                status="confirmed"
                onClick={vi.fn()}
            />,
        );
        const icon = container.querySelector(`.${rowStyles.actionIcon}`);
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon?.querySelector('svg[data-xc-icon]')).not.toBeNull();
        expect(css).toMatch(/\.actionIcon\s*\{[^}]*--xc-icon-size:\s*var\(--xc-icon-sm\)/s);
        expect(css).toMatch(/\.labelLine\s*\{[^}]*gap:\s*var\(--xc-space-1\)/s);
    });

    it('uses an incoming arrow for received activity and a QR code for the Receive action', () => {
        const { container } = render(
            <>
                <ActivityRow
                    chainId="bitcoin-regtest"
                    tick="BTC"
                    isNative
                    label="Received"
                    actionIcon={actionIconForAction('receive')}
                    amount="+0.01 BTC"
                    status="confirmed"
                    onClick={vi.fn()}
                />
                <span data-testid="receive-action"><ReceiveIcon /></span>
            </>,
        );

        const activityIcon = container.querySelector(`.${rowStyles.actionIcon}`);
        expect(activityIcon?.querySelector('.lucide-arrow-down-left')).not.toBeNull();
        expect(activityIcon?.querySelector('.lucide-qr-code')).toBeNull();
        expect(screen.getByTestId('receive-action').querySelector('.lucide-qr-code')).not.toBeNull();
    });

    it('formats one translated block for a confirmed History row and none for a pending row', () => {
        const common = {
            action: 'SEND',
            chainId: 'bitcoin-regtest',
            address: 'bcrt1qwallet',
            source: 'bcrt1qwallet',
            timestamp: 1_700_000_000,
            raw: { amount: '1', tick: 'BTC', destination: 'bcrt1qpeer' },
        };
        const { container } = render(
            <MessagingProvider shell="web" messaging={{}}>
                <ul>
                    <EntryRow
                        entry={{ ...common, key: 'confirmed', actionIndex: '1', blockIndex: 123456 }}
                        selected={false}
                        showConnector={false}
                        onClick={vi.fn()}
                        peerCache={{}}
                        walletId="wallet"
                    />
                    <EntryRow
                        entry={{ ...common, key: 'pending', actionIndex: '2', blockIndex: 0 }}
                        selected={false}
                        showConnector={false}
                        onClick={vi.fn()}
                        peerCache={{}}
                        walletId="wallet"
                    />
                </ul>
            </MessagingProvider>,
        );

        const confirmed = container.querySelector('[data-history-key="confirmed"]');
        const pending = container.querySelector('[data-history-key="pending"]');
        expect(confirmed).toHaveTextContent('Block 123,456');
        expect(confirmed.querySelector(`.${rowStyles.block}`)).not.toBeNull();
        expect(pending).not.toHaveTextContent(/Block/);
        expect(pending.querySelector(`.${rowStyles.block}`)).toBeNull();
        expect(pending.querySelector('time')).not.toBeNull();
    });
});
