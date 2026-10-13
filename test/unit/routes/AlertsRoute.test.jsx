// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let messaging = {};

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/components/AlertsOverlay.module.css', () => ({
    default: {
        alert: 'alert-style',
        critical: 'critical-style',
        warning: 'warning-style',
        info: 'info-style',
        unread: 'unread-style',
        read: 'read-style',
    },
}));

const { AlertsRoute } = await import(
    '../../../packages/core/src/shared/routes/AlertsRoute.jsx');

function mount(overrides = {}) {
    return render(<AlertsRoute onBack={vi.fn()} {...overrides} />);
}

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear();
    messaging = {};
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('AlertsRoute empty state', () => {
    it.each([
        ['an omitted alerts prop', {}],
        ['an empty alerts array', { alerts: [] }],
        ['an unavailable alerts value', { alerts: null }],
    ])('%s shows the empty state without a list', (_label, props) => {
        mount(props);

        expect(screen.getByRole('heading', { name: 'No alerts' })).toBeTruthy();
        expect(screen.getByText("You're all caught up.")).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('carries the Alerts title in its header', () => {
        mount();

        const header = screen.getByRole('banner');

        expect(within(header).getByText('Alerts')).toBeTruthy();
    });
});

describe('AlertsRoute alert list', () => {
    it('renders one list item with the title and message for each alert', () => {
        const alerts = [
            { id: 'one', severity: 'critical', title: 'Critical title', message: 'Critical message' },
            { id: 'two', severity: 'warning', title: 'Warning title', message: 'Warning message' },
            { id: 'three', severity: 'info', title: 'Info title', message: 'Info message' },
        ];
        mount({ alerts });
        const items = screen.getAllByRole('listitem');

        expect(items).toHaveLength(3);
        alerts.forEach((alert, index) => {
            expect(within(items[index]).getByText(alert.title)).toBeTruthy();
            expect(within(items[index]).getByText(alert.message)).toBeTruthy();
        });
    });

    it('runs an alert action once and leaves actionless alerts without an open button', () => {
        const onSelect = vi.fn();
        mount({ alerts: [
            {
                id: 'action',
                severity: 'warning',
                title: 'Action',
                message: 'Act now',
                action: { label: 'Review', onSelect },
            },
            { id: 'plain', severity: 'info', title: 'Plain', message: 'No action' },
        ] });
        const [actionItem, plainItem] = screen.getAllByRole('listitem');

        fireEvent.click(within(actionItem).getByRole('button', { name: 'Review' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(within(plainItem).queryByRole('button', { name: 'Review' })).toBeNull();
    });

    it('counts only unread list rows and can mark one or every alert read', () => {
        mount({ alerts: [
            { id: 'one', severity: 'info', title: 'One', message: 'First' },
            { id: 'two', severity: 'info', title: 'Two', message: 'Second', read: true },
            { id: 'three', severity: 'info', title: 'Three', message: 'Third' },
        ] });

        expect(screen.getByText('2 unread')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Mark One read' }));
        expect(screen.getByText('1 unread')).toBeTruthy();
        expect(within(screen.getAllByRole('listitem')[0]).getByText('Read')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
        expect(screen.getByText('0 unread')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /^Mark (One|Two|Three) read$/ })).toBeNull();
    });

    it('clears the list into the shared empty state', () => {
        const alerts = [
            { id: 'one', severity: 'info', title: 'One', message: 'First' },
            { id: 'two', severity: 'warning', title: 'Two', message: 'Second' },
        ];
        const first = mount({ walletId: 'wallet-1', alerts });

        fireEvent.click(screen.getByRole('button', { name: 'Clear alerts' }));

        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByRole('heading', { name: 'No alerts' })).toBeTruthy();
        expect(screen.getByText("You're all caught up.")).toBeTruthy();
        expect(screen.queryByText(/unread$/)).toBeNull();

        first.unmount();
        mount({ walletId: 'wallet-1', alerts });
        expect(screen.queryByRole('list')).toBeNull();
        expect(screen.getByRole('heading', { name: 'No alerts' })).toBeTruthy();
    });

    it('marks an alert read and opens its related screen when the row is tapped', () => {
        const onSelect = vi.fn();
        mount({ alerts: [{
            id: 'message',
            severity: 'info',
            title: 'Unread messages',
            message: 'You have a message.',
            action: { label: 'Open Messaging', onSelect },
        }] });

        fireEvent.click(screen.getByRole('button', { name: 'Open Messaging' }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.getByText('0 unread')).toBeTruthy();
        expect(screen.getByText('Read')).toBeTruthy();
    });

    it('keeps read state per wallet across navigation and treats changed content as new', () => {
        const alert = { id: 'one', severity: 'info', title: 'One', message: 'First' };
        const first = mount({ walletId: 'wallet-1', alerts: [alert] });
        fireEvent.click(screen.getByRole('button', { name: 'Mark One read' }));
        first.unmount();

        mount({ walletId: 'wallet-1', alerts: [alert] });
        expect(screen.getByText('0 unread')).toBeTruthy();

        cleanup();
        mount({ walletId: 'wallet-1', alerts: [{ ...alert, message: 'Updated' }] });
        expect(screen.getByText('1 unread')).toBeTruthy();
    });

    it('renders an unknown severity with the info style', () => {
        mount({ alerts: [
            { id: 'unknown', severity: 'unexpected', title: 'Unknown', message: 'Still visible' },
        ] });
        const item = screen.getByRole('listitem');

        expect(within(item).getByText('Unknown')).toBeTruthy();
        expect(within(item).getByText('Still visible')).toBeTruthy();
        expect(item.className.split(' ')).toContain('info-style');
    });
});
