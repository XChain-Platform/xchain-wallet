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
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

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

afterEach(() => {
    cleanup();
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
        expect(within(plainItem).queryByRole('button')).toBeNull();
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
