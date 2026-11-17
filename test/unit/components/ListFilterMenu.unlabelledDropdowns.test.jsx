// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Walk ruling 2026-11-13 (G96): a list page's filter-panel dropdowns show no
// visible label. The label stays the dropdown's accessible name and the first
// option names the filter ("All networks"). ListFilterMenu applies this once
// for every list page; the same Select outside the panel keeps its label.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ListFilterMenu } from '../../../packages/core/src/shared/components/ListFilterMenu.jsx';
import { IconSelect, Select } from '../../../packages/core/src/ui/index.js';

afterEach(() => cleanup());

function openPanel() {
    fireEvent.click(screen.getByRole('button', { name: 'Filter things' }));
    return within(screen.getByRole('dialog', { name: 'Filter things' }));
}

describe('ListFilterMenu dropdowns', () => {
    it('hides a Select label in the panel but keeps it as the accessible name', () => {
        render(
            <ListFilterMenu query="" onQueryChange={() => {}} label="Filter things" searchPlaceholder="Search" searchLabel="Search things">
                <Select label="Network" value="all" onChange={() => {}}>
                    <option value="all">All networks</option>
                    <option value="bitcoin-mainnet">Bitcoin</option>
                </Select>
            </ListFilterMenu>,
        );
        const panel = openPanel();
        expect(panel.queryByText('Network')).toBeNull();
        expect(panel.getByRole('combobox', { name: 'Network' })).toHaveTextContent('All networks');
    });

    it('hides an IconSelect label in the panel and keeps its name', () => {
        render(
            <ListFilterMenu query="" onQueryChange={() => {}} label="Filter things" searchPlaceholder="Search" searchLabel="Search things">
                <IconSelect
                    label="Type"
                    value="all"
                    onChange={() => {}}
                    options={[{ value: 'all', label: 'All types' }, { value: 'coin', label: 'Coins' }]}
                />
            </ListFilterMenu>,
        );
        const panel = openPanel();
        expect(panel.queryByText('Type')).toBeNull();
        expect(panel.getByRole('button', { name: 'Type: All types' })).toBeInTheDocument();
    });

    it('keeps the visible label on the same Select outside a filter panel', () => {
        render(
            <Select label="Network" value="all" onChange={() => {}}>
                <option value="all">All networks</option>
            </Select>,
        );
        expect(screen.getByText('Network').tagName).toBe('LABEL');
    });
});
