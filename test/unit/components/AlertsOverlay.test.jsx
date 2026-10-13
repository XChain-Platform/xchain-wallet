// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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
});
