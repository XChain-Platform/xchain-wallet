// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G112: in a filter popover the search glass and the dropdown option icons
// share one slot geometry, so they stack on one centre line and the text
// starts at the same x.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyLists } from '../../../packages/core/src/shared/routes/MyLists.jsx';

const css = (rel) => readFileSync(`${import.meta.dirname}/../../../packages/core/src/${rel}`, 'utf8');
const squish = (text) => text.replace(/\s+/g, ' ');

function rule(source, selector) {
    const start = source.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return squish(source.slice(start, source.indexOf('}', start)));
}

const searchSheets = ['shared/components/ListSearchField.module.css', 'shared/components/HomeFilterBar.module.css'];

describe('filter panel icon slot', () => {
    const select = css('ui/IconSelect.module.css');

    it.each(searchSheets)('%s puts the search glass in the select icon slot', (sheet) => {
        const source = css(sheet);
        const icon = rule(source, '.searchIcon');
        expect(icon).toContain('inset-inline-start: var(--xc-field-icon-inset-md)');
        expect(icon).toContain('width: var(--xc-control-icon-md)');
        expect(icon).toContain('height: var(--xc-control-icon-md)');
        expect(icon).not.toContain('glyph-inset');
        // The select's own leading icon uses the same inset and icon box.
        expect(select).toContain('--icon-select-icon-inset: var(--xc-field-icon-inset-md)');
        expect(select).toContain('width: var(--xc-control-icon-size)');
    });

    it.each(searchSheets)('%s starts the search text where the select label starts', (sheet) => {
        const text = rule(css(sheet), '.searchWrap input.search');
        expect(text).toContain(
            'padding-inline-start: calc(var(--xc-field-icon-inset-md) + var(--xc-control-icon-md) + var(--xc-field-icon-gap) - var(--xc-field-border))',
        );
        // Select: inset less border, then the icon box and the icon gap.
        const lead = rule(select, '.wrap .trigger.leadIcon');
        expect(lead).toContain('padding-inline-start: calc(var(--icon-select-icon-inset) - var(--xc-field-border))');
        expect(select).toContain('gap: var(--xc-field-icon-gap)');
    });

    it('gives every option of the My lists Show dropdown an icon, shown in its trigger', async () => {
        render(
            <MessagingProvider shell="web" messaging={{
                getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [{ address: 'bc1qowner' }] }),
                getListsForSource: vi.fn().mockResolvedValue({ data: [] }),
            }}>
                <MyLists walletId="w1" onOpenList={() => {}} onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Filter lists' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Filter lists' }));
        const trigger = screen.getByRole('combobox', { name: 'Show lists' });
        expect(trigger.querySelector('svg')).not.toBeNull();
        expect(trigger.className).toMatch(/leadIcon/);
    });
});
