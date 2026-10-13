// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

let messaging = {};
const alertsCss = readFileSync(
    'packages/core/src/shared/components/AlertsOverlay.module.css',
    'utf8',
);
const ruleBody = (selector) => alertsCss.match(
    new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`),
)?.[1] ?? '';

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
        severity: 'severity-style',
        list: 'list-style',
        alertHead: 'alert-head-style',
        alertTitle: 'alert-title-style',
        alertMessage: 'alert-message-style',
    },
}));

const { AlertsRoute } = await import(
    '../../../packages/core/src/shared/routes/AlertsRoute.jsx');

function mount(overrides = {}) {
    return render(<AlertsRoute onBack={vi.fn()} {...overrides} />);
}

const AXE_STATES = [
    ['unread', [{
        id: 'unread-message',
        severity: 'info',
        title: 'Unread message',
        message: 'A new message is ready to review.',
        action: { label: 'Open message', onSelect: () => {} },
    }]],
    ['read', [{
        id: 'read-message',
        severity: 'info',
        title: 'Read message',
        message: 'This message has already been reviewed.',
    }]],
    ['empty', []],
];

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

describe('AlertsRoute accessibility', () => {
    it.each(AXE_STATES)('has no serious axe violations in the %s state', async (
        _state,
        alerts,
    ) => {
        const { container } = mount({ alerts });

        await expectNoSeriousAxeViolations(container);
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

    it('keeps a dismissed alert hidden when its content changes', () => {
        const alert = { id: 'one', severity: 'info', title: 'One', message: 'First' };
        const first = mount({ walletId: 'wallet-1', alerts: [alert] });
        fireEvent.click(screen.getByRole('button', { name: 'Clear alerts' }));
        first.unmount();

        mount({ walletId: 'wallet-1', alerts: [{ ...alert, message: 'Updated' }] });

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

    it('consumes rejected async alert actions', async () => {
        const then = vi.fn((_resolve, reject) => reject(new Error('navigation failed')));
        const onSelect = vi.fn(() => ({ then }));
        mount({ alerts: [{
            id: 'message',
            severity: 'info',
            title: 'Unread messages',
            message: 'You have a message.',
            action: { label: 'Open Messaging', onSelect },
        }] });

        fireEvent.click(screen.getByRole('button', { name: 'Open Messaging' }));

        await waitFor(() => expect(then).toHaveBeenCalledTimes(1));
        expect(onSelect).toHaveBeenCalledTimes(1);
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
        expect(within(item).getByText('Info')).toBeTruthy();
        expect(item.className.split(' ')).toContain('info-style');
    });

    it('keeps long rows and every action reachable in a 320px route', () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        const actions = [
            { label: 'Mark read', onSelect: vi.fn() },
            { label: 'Clear', onSelect: vi.fn() },
            { label: 'Open', onSelect: vi.fn() },
        ];
        const longText = 'alert-content-without-break-opportunities-'.repeat(12);
        const alerts = actions.map((action, index) => ({
            id: `narrow-${index}`,
            severity: index === 0 ? 'critical' : index === 1 ? 'warning' : 'info',
            title: `${longText}${index}`,
            message: `${longText}${index}`,
            action,
        }));

        try {
            mount({ alerts });

            expect(window.innerWidth).toBe(320);
            expect(screen.getAllByRole('listitem')).toHaveLength(3);
            for (const action of actions) {
                fireEvent.click(screen.getByRole('button', { name: action.label }));
                expect(action.onSelect).toHaveBeenCalledTimes(1);
            }
            expect(ruleBody('list')).toMatch(/width:\s*100%[\s\S]*max-width:\s*100%/);
            expect(ruleBody('alert')).toMatch(/max-width:\s*100%[\s\S]*min-width:\s*0/);
            expect(ruleBody('alertHead')).toMatch(/flex-wrap:\s*wrap/);
            expect(ruleBody('alertTitle')).toMatch(/overflow-wrap:\s*anywhere/);
            expect(ruleBody('alertMessage')).toMatch(/overflow-wrap:\s*anywhere/);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });
});
