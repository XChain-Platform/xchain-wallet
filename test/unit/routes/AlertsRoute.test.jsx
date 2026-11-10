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

const now = Date.now();
const yesterday = now - 86_400_000;
const rows = [
    { id: 'price', type: 'price', title: 'BTC rose above $120,000', message: 'Your BTC price alert fired.', at: now, read: false },
    { id: 'activity', type: 'activity', title: 'Send still pending', message: 'A transfer has waited 2 hours.', at: now - 1000, read: true },
    { id: 'payment', type: 'payments', title: 'Payment due tomorrow', message: 'Review this payment.', at: yesterday, read: false },
];

const mount = (props = {}) => render(<AlertsRoute onBack={vi.fn()} alerts={rows} {...props} />);

afterEach(() => {
    cleanup();
    messaging = {};
    vi.clearAllMocks();
});

describe('AlertsRoute', () => {
    it('renders the one header action, inline filters, day groups, and unread dots', () => {
        mount();
        const header = screen.getByRole('banner');
        expect(within(header).getByRole('button', { name: 'Mark all read' })).toBeTruthy();
        expect(within(header).getAllByRole('button')).toHaveLength(2);
        expect(screen.getByRole('searchbox', { name: 'Search alerts' })).toBeTruthy();
        expect(screen.getByRole('combobox', { name: 'Filter alert type' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
        expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeTruthy();
        expect(screen.getAllByLabelText('Unread')).toHaveLength(2);
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
        expect(within(select).getByRole('option', { name: 'All types (3)' })).toBeTruthy();
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

        fireEvent.click(button);

        expect(button).toBeDisabled();
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
