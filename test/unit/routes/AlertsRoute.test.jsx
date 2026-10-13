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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';

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
        severity: 'severity-style',
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
            const label = alert.severity === 'critical' ? 'Critical'
                : alert.severity === 'warning' ? 'Warning' : 'Info';
            expect(within(items[index]).getByText(label)).toBeTruthy();
            expect(within(items[index]).getByText(alert.title)).toBeTruthy();
            expect(within(items[index]).getByText(alert.message)).toBeTruthy();
        });
    });

    it('runs an alert action once and leaves actionless alerts without a button', () => {
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

    it('opens every alert, marks read, and clears with only the keyboard', async () => {
        const user = userEvent.setup();
        const firstAction = vi.fn();
        const secondAction = vi.fn();
        mount({
            walletId: 'wallet-1',
            alerts: [
                {
                    id: 'one',
                    severity: 'warning',
                    title: 'First alert',
                    message: 'First message',
                    action: { label: 'Open first', onSelect: firstAction },
                },
                {
                    id: 'two',
                    severity: 'info',
                    title: 'Second alert',
                    message: 'Second message',
                    action: { label: 'Open second', onSelect: secondAction },
                },
            ],
        });

        await user.tab();
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Clear alerts' })).toHaveFocus());
        expect(screen.getByText('0 unread')).toBeInTheDocument();
        expect(screen.getAllByText('Read')).toHaveLength(2);

        await user.tab();
        expect(screen.getByRole('button', { name: 'Open first' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(firstAction).toHaveBeenCalledOnce();

        await user.tab();
        expect(screen.getByRole('button', { name: 'Open second' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(secondAction).toHaveBeenCalledOnce();

        await user.tab({ shift: true });
        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Clear alerts' })).toHaveFocus();
        await user.keyboard('{Enter}');

        const clearedState = screen.getByLabelText("No alerts. You're all caught up.");
        await waitFor(() => expect(clearedState).toHaveFocus());
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('returns focus to the alert action when marking only that alert read', async () => {
        const user = userEvent.setup();
        mount({ alerts: [{
            id: 'message',
            severity: 'info',
            title: 'Unread message',
            message: 'Review the conversation.',
            action: { label: 'Open Messaging', onSelect: vi.fn() },
        }] });

        await user.tab();
        await user.tab();
        await user.tab();
        await user.tab();
        await user.tab();
        const markRead = screen.getByRole('button', { name: 'Mark Unread message read' });
        expect(markRead).toHaveFocus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(screen.getByRole('button', { name: 'Open Messaging' })).toHaveFocus());
        expect(markRead).not.toBeInTheDocument();
    });

    it('renders an unknown severity with the info style', () => {
        mount({ alerts: [
            { id: 'unknown', severity: 'unexpected', title: 'Unknown', message: 'Still visible' },
        ] });
        const item = screen.getByRole('listitem');

        expect(within(item).getByText('Unknown')).toBeTruthy();
        expect(within(item).getByText('Still visible')).toBeTruthy();
        expect(within(item).getByText('Info')).toBeTruthy();
        expect(item.className.split(' ')).toContain('info-style');
    });
});
