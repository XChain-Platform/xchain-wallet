// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

vi.mock('../../../packages/core/src/ui/backStack.js', () => ({
    useBackHandler: () => {},
}));

vi.mock('../../../packages/core/src/shared/utils/focusTrap.js', () => ({
    useFocusTrap: () => {},
}));

const { AlertsOverlay } = await import(
    '../../../packages/core/src/shared/components/AlertsOverlay.jsx'
);
const overlayCss = readFileSync(
    'packages/core/src/shared/components/AlertsOverlay.module.css',
    'utf8',
);
const ruleBody = (selector) => overlayCss.match(
    new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`),
)?.[1] ?? '';

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

afterEach(cleanup);

describe('AlertsOverlay', () => {
    it.each(AXE_STATES)('has no serious axe violations in the %s state', async (
        _state,
        alerts,
    ) => {
        const { container } = render(
            <AlertsOverlay alerts={alerts} onClose={() => {}} />,
        );

        await expectNoSeriousAxeViolations(container);
    });

    it('stacks every alert in one ordered, scrollable list', () => {
        const alerts = [
            { id: 'one', severity: 'critical', title: 'First', message: 'First message' },
            { id: 'two', severity: 'warning', title: 'Second', message: 'Second message' },
            { id: 'three', severity: 'info', title: 'Third', message: 'Third message' },
        ];

        render(<AlertsOverlay alerts={alerts} onClose={() => {}} />);

        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(3);
        alerts.forEach((alert, index) => {
            expect(within(items[index]).getByText(alert.title)).toBeTruthy();
        });
        expect(screen.getByText('3')).toBeTruthy();
        expect(overlayCss).toMatch(/\.body\s*\{[\s\S]*?overflow-y:\s*auto/);
        expect(overlayCss).toMatch(/\.list\s*\{[\s\S]*?flex-direction:\s*column/);
    });

    it('keeps mobile actions above the safe area and removes entrance motion on request', () => {
        expect(overlayCss).toMatch(
            /padding-bottom:\s*calc\(var\(--xc-space-3\) \+ env\(safe-area-inset-bottom, 0px\)\)/,
        );
        expect(overlayCss).toMatch(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.panel\s*\{\s*animation:\s*none/,
        );
    });

    it('keeps long rows and every action reachable in a 320px overlay', () => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
        const onClose = vi.fn();
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
            render(<AlertsOverlay alerts={alerts} onClose={onClose} />);

            expect(window.innerWidth).toBe(320);
            expect(screen.getAllByRole('listitem')).toHaveLength(3);
            for (const action of actions) {
                fireEvent.click(screen.getByRole('button', { name: action.label }));
                expect(action.onSelect).toHaveBeenCalledTimes(1);
            }
            expect(onClose).toHaveBeenCalledTimes(3);
            expect(ruleBody('panel')).toMatch(/max-width:\s*min\(380px, 100%\)/);
            expect(ruleBody('panel')).toMatch(/min-width:\s*0/);
            expect(ruleBody('list')).toMatch(/max-width:\s*100%[\s\S]*min-width:\s*0/);
            expect(ruleBody('alert')).toMatch(/max-width:\s*100%[\s\S]*min-width:\s*0/);
            expect(ruleBody('alertHead')).toMatch(/flex-wrap:\s*wrap[\s\S]*min-width:\s*0/);
            expect(ruleBody('alertTitle')).toMatch(/min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
            expect(ruleBody('alertMessage')).toMatch(/min-width:\s*0[\s\S]*overflow-wrap:\s*anywhere/);
            expect(ruleBody('body')).toMatch(/overflow-y:\s*auto/);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });
});
