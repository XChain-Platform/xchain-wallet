// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tabs } from '../../../packages/core/src/ui/Tabs.jsx';

const items = [
    { id: 'coins', label: 'Coins' },
    { id: 'tokens', label: 'Tokens', count: 3 },
    { id: 'activity', label: 'Activity' },
];

function ControlledTabs() {
    const [value, setValue] = useState('coins');
    return (
        <Tabs
            id="wallet-tabs"
            items={items}
            value={value}
            onChange={setValue}
            panelId="wallet-panel"
            aria-label="Wallet view"
        />
    );
}

describe('<Tabs>', () => {
    it('connects tabs to their panel and keeps only the selected tab reachable', () => {
        render(<ControlledTabs />);
        const [coins, tokens, activity] = screen.getAllByRole('tab');

        expect(screen.getByRole('tablist', { name: 'Wallet view' })).toHaveAttribute('id', 'wallet-tabs');
        expect(coins).toHaveAttribute('id', 'wallet-tabs-tab-coins');
        expect(coins).toHaveAttribute('aria-selected', 'true');
        expect(coins).toHaveAttribute('aria-controls', 'wallet-panel');
        expect(coins).toHaveAttribute('tabindex', '0');
        expect(tokens).toHaveAttribute('aria-selected', 'false');
        expect(tokens).toHaveAttribute('tabindex', '-1');
        expect(activity).toHaveAttribute('tabindex', '-1');
    });

    it('names no controlled panel when the caller renders none', () => {
        render(<Tabs items={items} value="coins" onChange={() => {}} aria-label="Kind" />);
        for (const tab of screen.getAllByRole('tab')) {
            expect(tab).not.toHaveAttribute('aria-controls');
        }
    });

    it('selects and focuses tabs with arrows, Home, and End', () => {
        render(<ControlledTabs />);
        const coins = screen.getByRole('tab', { name: 'Coins' });

        coins.focus();
        fireEvent.keyDown(coins, { key: 'ArrowRight' });
        const tokens = screen.getByRole('tab', { name: 'Tokens 3' });
        expect(tokens).toHaveFocus();
        expect(tokens).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(tokens, { key: 'End' });
        const activity = screen.getByRole('tab', { name: 'Activity' });
        expect(activity).toHaveFocus();
        expect(activity).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(activity, { key: 'ArrowRight' });
        expect(coins).toHaveFocus();
        fireEvent.keyDown(coins, { key: 'End' });
        fireEvent.keyDown(activity, { key: 'Home' });
        expect(coins).toHaveFocus();
    });

    it('uses the shared medium control height and hides overflow scrollbars', () => {
        const css = readFileSync('packages/core/src/ui/Tabs.module.css', 'utf8');

        expect(css).toMatch(/\.tabs\s*\{[^}]*height:\s*var\(--xc-control-h-md\)/s);
        expect(css).toMatch(/\.tabs\s*\{[^}]*overflow-x:\s*auto/s);
        expect(css).toMatch(/\.tabs::-webkit-scrollbar\s*\{[^}]*display:\s*none/s);
        // A short tab row shrinks and wraps its labels before it ever scrolls.
        expect(css).toMatch(/\.tab\s*\{[^}]*flex:\s*0 1 auto;[^}]*white-space:\s*normal;/s);
        expect(css).not.toMatch(/\.tab\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });

    it('can disable every tab while an owning flow is busy', () => {
        render(
            <Tabs
                items={items}
                value="coins"
                onChange={() => {}}
                disabled
                aria-label="Busy tabs"
            />,
        );

        expect(screen.getAllByRole('tab').every((tab) => tab.disabled)).toBe(true);
    });
});
