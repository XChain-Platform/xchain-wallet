// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The header bell's colour shows urgency: neutral with nothing unread, blue
// while the unread items are ordinary, red once one needs the user to act
// (a payment due). A cleared payment-due no longer counts.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

let messaging = {};
let noticeAlerts = [];
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/hooks/usePendingNoticeAlerts.js', () => ({
    usePendingNoticeAlerts: () => noticeAlerts,
}));

const { ShellAppHeader } = await import('../../../packages/core/src/shared/components/ShellAppHeader.jsx');

const ordinary = { id: 'price-1', type: 'price', title: 'BTC moved', message: 'm', at: 1, read: false };
const paymentDue = { id: 'payment-due:bitcoin:7', type: 'payments', title: 'Payment due', message: 'm', at: 2, read: false };

const mount = (props = {}) => render(<ShellAppHeader onOpenNotifications={vi.fn()} walletId="w" alerts={[]} {...props} />);
const bell = () => screen.getByRole('button', { name: /^Notifications/ });

afterEach(() => {
    cleanup();
    messaging = {};
    noticeAlerts = [];
});

describe('the Notifications bell tone', () => {
    it('is neutral with nothing unread', () => {
        mount();
        expect(bell().getAttribute('data-bell-tone')).toBe('none');
        expect(bell().getAttribute('aria-label')).toBe('Notifications');
    });

    // Only the count bubble takes the colour; the button stays the normal button.
    const badge = () => bell().parentElement.lastElementChild;

    it('is blue with only ordinary unread items', () => {
        mount({ alerts: [ordinary] });
        expect(bell().getAttribute('data-bell-tone')).toBe('info');
        expect(bell().className).not.toMatch(/bellUnread|bellAction/);
        expect(badge().className).not.toMatch(/bellBadgeAction/);
        expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread');
    });

    it('is red with a payment due unread, and says so in its label', () => {
        noticeAlerts = [paymentDue];
        mount({ alerts: [ordinary] });
        expect(bell().getAttribute('data-bell-tone')).toBe('action');
        expect(bell().className).not.toMatch(/bellUnread|bellAction/);
        expect(badge().className).toMatch(/bellBadgeAction/);
        expect(bell().getAttribute('aria-label')).toBe('Notifications, 2 unread, 1 needs your action');
    });

    it('stays blue when the payment due is already read', () => {
        noticeAlerts = [{ ...paymentDue, read: true }];
        mount({ alerts: [ordinary] });
        expect(bell().getAttribute('data-bell-tone')).toBe('info');
    });

    it('does not count a stored payment-due row whose notice has cleared', async () => {
        messaging = { listAlertInbox: vi.fn().mockResolvedValue([{ ...paymentDue }]) };
        noticeAlerts = [];
        mount();
        await waitFor(() => expect(messaging.listAlertInbox).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(bell().getAttribute('data-bell-tone')).toBe('none');
        expect(bell().getAttribute('aria-label')).toBe('Notifications');
    });

    it('counts a stored payment-due row while its notice is still pending', async () => {
        messaging = { listAlertInbox: vi.fn().mockResolvedValue([{ ...paymentDue }]) };
        noticeAlerts = [paymentDue];
        mount();
        await waitFor(() => expect(bell().getAttribute('data-bell-tone')).toBe('action'));
        expect(bell().getAttribute('aria-label')).toBe('Notifications, 1 unread, 1 needs your action');
    });
});
