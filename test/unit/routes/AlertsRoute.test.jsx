// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

let messaging = {};
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

const { AlertsRoute } = await import('../../../packages/core/src/shared/routes/AlertsRoute.jsx');
const { default: routeStyles } = await import('../../../packages/core/src/shared/routes/AlertsRoute.module.css');

const nowDate = new Date();
const now = nowDate.getTime();
const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1, 12).getTime();
const earlier = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 3, 12).getTime();
const earlierLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(earlier);
const rows = [
    { id: 'price', type: 'price', title: 'BTC rose above $120,000', message: 'Your BTC price alert fired.', at: now, read: false },
    { id: 'activity', type: 'activity', title: 'Send still pending', message: 'A transfer has waited 2 hours.', at: now - 1000, read: true },
    { id: 'payment', type: 'payments', title: 'Payment due tomorrow', message: 'Review this payment.', at: yesterday, read: false },
    { id: 'security', type: 'security', title: 'Security check complete', message: 'Your wallet passed its security check.', at: earlier, read: false },
];

const mount = (props = {}) => render(<AlertsRoute onBack={vi.fn()} alerts={rows} {...props} />);

afterEach(() => {
    cleanup();
    messaging = {};
    vi.clearAllMocks();
});

describe('AlertsRoute', () => {
    it('renders the header action, counted filters, and day-grouped alert row hierarchy', () => {
        mount();
        const header = screen.getByRole('banner');
        const markAllButton = within(header).getByRole('button', { name: 'Mark all read' });
        expect(markAllButton).toBeTruthy();
        expect(markAllButton.querySelector('svg')).toHaveAttribute('width', '18');
        expect(within(header).getByText('3')).toBeTruthy();
        expect(within(header).getAllByRole('button')).toHaveLength(2);
        expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toBeTruthy();
        const select = screen.getByRole('combobox', { name: 'Filter alert type' });
        expect(within(select).getByRole('option', { name: 'All types (4)' })).toBeTruthy();
        expect(within(select).getByRole('option', { name: 'Price (1)' })).toBeTruthy();
        expect(within(select).getByRole('option', { name: 'Activity (1)' })).toBeTruthy();
        expect(within(select).getByRole('option', { name: 'Payments (1)' })).toBeTruthy();
        expect(within(select).getByRole('option', { name: 'Security (1)' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: earlierLabel })).toBeTruthy();

        const unreadTitle = screen.getByText('BTC rose above $120,000');
        const unreadRow = unreadTitle.closest('li');
        expect(within(unreadRow).getByText('Price').compareDocumentPosition(unreadTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(unreadRow.querySelector('time')).toBeTruthy();
        expect(within(unreadRow).getByLabelText('Unread')).toBeTruthy();
        expect(unreadRow).toHaveClass(routeStyles.unread);

        const readTitle = screen.getByText('Send still pending');
        const readRow = readTitle.closest('li');
        expect(within(readRow).getByText('Activity').compareDocumentPosition(readTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(readRow.querySelector('time')).toBeTruthy();
        expect(within(readRow).queryByLabelText('Unread')).toBeNull();
        expect(readRow).toHaveClass(routeStyles.read);
        expect(readRow).not.toHaveClass(routeStyles.unread);
        expect(screen.getAllByLabelText('Unread')).toHaveLength(3);
    });

    it('filters every alert text, reports matches, highlights matches, and clears search', () => {
        mount();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search alerts' }), { target: { value: 'BTC' } });

        expect(screen.getByText('1 alerts match')).toBeTruthy();
        expect(screen.getAllByText('BTC')).toHaveLength(2);
        expect(screen.getAllByText('BTC').every((node) => node.tagName === 'MARK')).toBe(true);
        expect(screen.queryByText('Send still pending')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(screen.getByText('Send still pending')).toBeTruthy();
    });

    it('shows type counts and filters to the selected type', () => {
        mount();
        const select = screen.getByRole('combobox', { name: 'Filter alert type' });
        expect(within(select).getByRole('option', { name: 'All types (4)' })).toBeTruthy();
        expect(within(select).getByRole('option', { name: 'Payments (1)' })).toBeTruthy();

        fireEvent.change(select, { target: { value: 'payments' } });
        expect(screen.getByText('Payment due tomorrow')).toBeTruthy();
        expect(screen.queryByText('BTC rose above $120,000')).toBeNull();
    });

    it('marks every row read, clears the badge state, and persists through messaging', async () => {
        messaging = { markAllAlertsRead: vi.fn(async () => {}) };
        mount({ walletId: 'wallet-1' });
        const button = screen.getByRole('button', { name: 'Mark all read' });
        expect(button).not.toBeDisabled();
        expect(screen.getByRole('banner')).toHaveTextContent('3');

        fireEvent.click(button);

        expect(button).toBeDisabled();
        expect(screen.getByRole('banner')).not.toHaveTextContent('3');
        expect(screen.queryByLabelText('Unread')).toBeNull();
        await waitFor(() => expect(messaging.markAllAlertsRead).toHaveBeenCalledWith({ walletId: 'wallet-1' }));
    });

    it('marks a tapped row read, persists it, and runs its action', async () => {
        const onSelect = vi.fn();
        messaging = { markAlertRead: vi.fn(async () => {}) };
        mount({ walletId: 'wallet-1', alerts: [{ ...rows[0], action: { label: 'Open price', onSelect } }] });

        fireEvent.click(screen.getByRole('button', { name: 'Open price' }));

        expect(onSelect).toHaveBeenCalledOnce();
        expect(screen.queryByLabelText('Unread')).toBeNull();
        await waitFor(() => expect(messaging.markAlertRead).toHaveBeenCalledWith({ id: 'price', walletId: 'wallet-1' }));
    });

    it('loads delivered inbox rows through the shell messaging path', async () => {
        messaging = { listAlertInbox: vi.fn(async () => [{ id: 'message', type: 'messages', title: 'New message', message: 'Open the conversation.', at: now + 1, read: false }]) };
        mount({ alerts: [] });

        expect(await screen.findByText('New message')).toBeTruthy();
        expect(screen.getByText('Messages')).toBeTruthy();
    });

    it('shows one plain empty state and has no serious accessibility violations', async () => {
        const { container } = mount({ alerts: [] });
        expect(screen.getByRole('heading', { name: 'No alerts' })).toBeTruthy();
        expect(screen.getByText('Wallet activity, security, and price changes appear here.')).toBeTruthy();
        await expectNoSeriousAxeViolations(container);
    });
});
