// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Tabs and SegmentedControl render the one view-toggle look: both put the
// shared .segmented class on the group and .segment on every item, items sit
// as direct siblings (so the `.segment + .segment` divider falls between each
// pair), and the active state is carried by aria-selected or aria-checked plus
// data-tone for Buy and Sell, which the shared sheet fills blue, green or red.
// Vitest blanks CSS modules, so the class wiring is read from the source and
// the state from the rendered DOM. The file name is historical.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SegmentedControl } from '../../../packages/core/src/ui/SegmentedControl.jsx';
import { Tabs } from '../../../packages/core/src/ui/Tabs.jsx';

const uiRoot = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui');
const read = (name) => readFileSync(join(uiRoot, name), 'utf8');
const noop = () => {};

afterEach(cleanup);

describe('one view-toggle look for Tabs and SegmentedControl', () => {
    it('wires both primitives to the shared .segmented group and .segment items', () => {
        const tabs = read('Tabs.jsx');
        expect(tabs).toMatch(/import (\w+) from '\.\/SegmentedControl\.module\.css'/);
        const name = tabs.match(/import (\w+) from '\.\/SegmentedControl\.module\.css'/)[1];
        expect(tabs).toContain(`${name}.segmented`);
        expect(tabs).toContain(`${name}.segment}`);
        const segmented = read('SegmentedControl.jsx');
        expect(segmented).toMatch(/styles\.segmented\b/);
        expect(segmented).toMatch(/className=\{styles\.segment\}/);
    });

    it('renders tab items as direct siblings, one selected, so dividers fall only between items', () => {
        render(createElement(Tabs, {
            'aria-label': 'Wallet view',
            value: 'tokens',
            onChange: noop,
            items: [
                { id: 'coins', label: 'Coins', icon: createElement('svg') },
                { id: 'tokens', label: 'Tokens', icon: createElement('svg') },
                { id: 'nfts', label: 'NFTs', icon: createElement('svg') },
            ],
        }));
        const list = screen.getByRole('tablist', { name: 'Wallet view' });
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(3);
        for (const tab of tabs) expect(tab.parentElement).toBe(list);
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
        // Every item carries its icon, hidden from the accessible name.
        for (const tab of tabs) {
            expect(tab.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        }
        expect(screen.getByRole('tab', { name: 'Tokens' })).toBeInTheDocument();
    });

    it('marks the active Buy or Sell item with its tone, and every other toggle with the blue default', () => {
        const { rerender } = render(createElement(SegmentedControl, {
            'aria-label': 'Order side',
            value: 'sell',
            onChange: noop,
            items: [
                { id: 'buy', label: 'Buy', tone: 'success' },
                { id: 'sell', label: 'Sell', tone: 'danger' },
            ],
        }));
        const buy = screen.getByRole('radio', { name: 'Buy' });
        const sell = screen.getByRole('radio', { name: 'Sell' });
        expect(buy.parentElement).toBe(sell.parentElement);
        expect(buy).toHaveAttribute('data-tone', 'success');
        expect(buy).toHaveAttribute('aria-checked', 'false');
        expect(sell).toHaveAttribute('data-tone', 'danger');
        expect(sell).toHaveAttribute('aria-checked', 'true');

        rerender(createElement(SegmentedControl, {
            'aria-label': 'Form view',
            value: 'quick',
            onChange: noop,
            items: [{ id: 'quick', label: 'Quick' }, { id: 'full', label: 'Full' }],
        }));
        expect(screen.getByRole('radio', { name: 'Quick' })).toHaveAttribute('data-tone', 'accent');
        expect(screen.getByRole('radio', { name: 'Quick' })).toHaveAttribute('aria-checked', 'true');
    });

    it('fills only the active item: blue by default, green or red by tone, with no divider against the fill', () => {
        const css = read('SegmentedControl.module.css').replace(/\/\*[\s\S]*?\*\//g, '');
        const active = ":is([aria-checked='true'], [aria-selected='true'])";
        expect(css).toContain(`.segment${active} {\n    background: var(--xc-control-selected);`);
        expect(css).toContain(`.segment[data-tone='success']${active} {\n    background: var(--xc-success-fill);`);
        expect(css).toContain(`.segment[data-tone='danger']${active} {\n    background: var(--xc-danger);`);
        expect(css).toMatch(/\.segment \+ \.segment \{\s*border-inline-start: 1px solid var\(--xc-control-border\);/);
        expect(css).toContain(`.segment${active} + .segment {\n    border-inline-start-color: transparent;`);
    });
});
