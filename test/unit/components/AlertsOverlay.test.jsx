// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';

vi.mock('../../../packages/core/src/ui/backStack.js', () => ({
    useBackHandler: () => {},
}));

vi.mock('@xchain-wallet/core/ui', () => ({
    Icon: { XIcon: () => <span aria-hidden="true">x</span> },
    Button: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}));

const { AlertsOverlay } = await import(
    '../../../packages/core/src/shared/components/AlertsOverlay.jsx'
);
const overlayCss = readFileSync(
    'packages/core/src/shared/components/AlertsOverlay.module.css',
    'utf8',
);

afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
});

function OverlayHarness({ alerts }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>Show alerts</button>
            {open ? <AlertsOverlay alerts={alerts} onClose={() => setOpen(false)} /> : null}
        </>
    );
}

describe('AlertsOverlay', () => {
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

    it('reaches every alert action with Tab and restores its opener after Enter', async () => {
        const user = userEvent.setup();
        const firstAction = vi.fn();
        const secondAction = vi.fn();
        render(<OverlayHarness alerts={[
            {
                id: 'one',
                severity: 'warning',
                title: 'First',
                message: 'First message',
                action: { label: 'Open first', onSelect: firstAction },
            },
            {
                id: 'two',
                severity: 'info',
                title: 'Second',
                message: 'Second message',
                action: { label: 'Open second', onSelect: secondAction },
            },
        ]} />);
        const opener = screen.getByRole('button', { name: 'Show alerts' });

        await user.tab();
        expect(opener).toHaveFocus();
        await user.keyboard('{Enter}');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        expect(screen.getByRole('button', { name: 'Close alerts' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Open first' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(firstAction).toHaveBeenCalledOnce();
        await waitFor(() => expect(opener).toHaveFocus());

        await user.keyboard('{Enter}');
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        await user.tab();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Open second' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(secondAction).toHaveBeenCalledOnce();
        await waitFor(() => expect(opener).toHaveFocus());
    });
});
