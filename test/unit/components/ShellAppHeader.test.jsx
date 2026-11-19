// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Unit: the Notifications bell sits in the app header at every width and in
// every shell (the sidebar layout included), carries the unread badge, and
// counts the Home payment-due notice in the same list the bell opens.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { NavSurfaceContext } from '../../../packages/core/src/shared/components/navSurface.js';
import { ShellAppHeader } from '../../../packages/core/src/shared/components/ShellAppHeader.jsx';
import { buildPendingNoticeAlerts } from '../../../packages/core/src/shared/walletAlerts.js';

let obligations = [];
vi.mock('../../../packages/core/src/shared/hooks/useCoinpayObligations.js', () => ({
    useSharedCoinpayObligations: () => ({ obligations }),
}));

const due = { chainId: 'bitcoin-mainnet', address: 'bc1qpayer', orderMatchActionIndex: '42', coinAmount: '0.5' };

function renderHeader(surface, props = {}) {
    const messaging = { listAlertInbox: vi.fn().mockResolvedValue([]), listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]) };
    return render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <NavSurfaceContext.Provider value={surface}>
                <ShellAppHeader walletId="w1" accountId="a1" onOpenNotifications={() => {}} onLock={() => {}} {...props} />
            </NavSurfaceContext.Provider>
        </MessagingContext.Provider>,
    );
}

afterEach(() => { cleanup(); obligations = []; });

describe('ShellAppHeader', () => {
    it.each(['sidebar', 'tabBar', null])('shows the notification bell left of the menu button on the %s layout', (surface) => {
        renderHeader(surface);
        const header = screen.getByRole('region', { name: 'App header' });
        const bell = within(header).getByRole('button', { name: 'Notifications' });
        const menu = within(header).getByRole('button', { name: 'Open menu' });
        expect(bell.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('opens the notifications page from the bell', () => {
        const onOpenNotifications = vi.fn();
        renderHeader('sidebar', { onOpenNotifications });
        fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
        expect(onOpenNotifications).toHaveBeenCalledOnce();
    });

    it('shows the unread badge for a payment due on the wide layout', async () => {
        obligations = [due];
        renderHeader('sidebar', { onResumeCoinpay: () => {} });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 1 unread, 1 needs your action' })).toBeTruthy());
    });
});

describe('buildPendingNoticeAlerts', () => {
    it('lists a payment due that opens the same place the Home notice does', () => {
        const onResumeCoinpay = vi.fn();
        const [alert] = buildPendingNoticeAlerts({ pendingCoinpays: [due] }, { onResumeCoinpay });
        expect(alert).toMatchObject({ id: 'payment-due:bitcoin-mainnet:42', type: 'payments', read: false });
        // The Notifications row's three short lines (alertCopy.js; operator
        // 2026-11-15 alerts screen: every row fits three lines), the coin's
        // ticker beside the amount.
        expect(alert).toMatchObject({ label: 'Payment due', title: 'Pay 0.5 BTC', message: 'Order #42: sign to pay' });
        alert.action.onSelect();
        expect(onResumeCoinpay).toHaveBeenCalledWith({ chainId: 'bitcoin-mainnet', address: 'bc1qpayer', orderMatchActionIndex: '42' });
    });

    it('lists a pending airdrop and hides it for a watcher, as Home does', () => {
        const onResumeAirdrop = vi.fn();
        const rec = { id: 'a1', amountPer: '1', token: 'XCP', recipients: [1, 2], stage: 'ready-to-airdrop' };
        const [alert] = buildPendingNoticeAlerts({ pendingAirdrops: [rec] }, { onResumeAirdrop });
        expect(alert.id).toBe('airdrop-pending:a1');
        alert.action.onSelect();
        expect(onResumeAirdrop).toHaveBeenCalledWith('a1');
        expect(buildPendingNoticeAlerts({ pendingAirdrops: [rec], isWatcherMode: true }, { onResumeAirdrop })).toEqual([]);
    });
});
