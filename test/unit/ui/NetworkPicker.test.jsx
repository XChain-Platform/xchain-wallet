// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { NetworkPicker } from '../../../packages/core/src/ui/NetworkPicker.jsx';

const registry = defaultRegistry();
const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];

describe('<NetworkPicker>', () => {
    it('renders one icon row per network and marks the current row', () => {
        render(
            <NetworkPicker
                label="Destination network"
                value="litecoin-mainnet"
                chainIds={CHAINS}
                chainRegistry={registry}
                onSelect={() => {}}
                onBack={() => {}}
            />,
        );

        const picker = screen.getByRole('dialog', { name: 'Destination network' });
        const rows = within(picker).getAllByRole('button', { name: /^Select / });
        expect(rows).toHaveLength(CHAINS.length);
        expect(within(picker).queryByRole('button', { name: 'Select All networks' })).toBeNull();
        expect(within(picker).getByRole('button', { name: 'Select Litecoin' }))
            .toHaveAttribute('aria-current', 'true');
        for (const row of rows) expect(row.querySelector('img')).toBeTruthy();
    });

    it('prepends an All networks row only when opted in and selects the all sentinel', () => {
        const onSelect = vi.fn();
        render(
            <NetworkPicker
                value="all"
                chainIds={CHAINS}
                chainRegistry={registry}
                onSelect={onSelect}
                onBack={() => {}}
                allOption
            />,
        );

        const picker = screen.getByRole('dialog', { name: 'Network' });
        const rows = within(picker).getAllByRole('button', { name: /^Select / });
        expect(rows).toHaveLength(CHAINS.length + 1);
        expect(rows[0]).toHaveAccessibleName('Select All networks');
        expect(rows[0]).toHaveAttribute('aria-current', 'true');
        expect(rows[0].querySelector('svg[data-xc-icon]')).toBeTruthy();
        expect(rows[0].querySelector('img')).toBeNull();

        fireEvent.click(rows[0]);
        expect(onSelect).toHaveBeenCalledWith('all');
    });

    it('reports a picked network and the Back action', () => {
        const onSelect = vi.fn();
        const onBack = vi.fn();
        render(
            <NetworkPicker
                value="bitcoin-mainnet"
                chainIds={CHAINS}
                chainRegistry={registry}
                onSelect={onSelect}
                onBack={onBack}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Select Dogecoin' }));
        expect(onSelect).toHaveBeenCalledWith('dogecoin-mainnet');
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
