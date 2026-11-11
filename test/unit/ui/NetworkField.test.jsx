// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';

const registry = defaultRegistry();
const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet'];

describe('<NetworkField>', () => {
    it('uses the standard label and exposes the current network in its name', () => {
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
    });

    it('uses a list affordance without combobox, listbox, select, or chevron semantics', () => {
        const { container } = render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );

        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(container.querySelector('select')).toBeNull();
        expect(container.querySelector('.lucide-layout-list')).toBeTruthy();
        expect(container.querySelector('.lucide-chevron-down')).toBeNull();
    });

    it('opens one icon row per offered network, picks a network, and closes', () => {
        const onChange = vi.fn();
        render(
            <NetworkField
                label="Destination network"
                value="bitcoin-mainnet"
                onChange={onChange}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Destination network: Bitcoin' }));
        const picker = screen.getByRole('dialog', { name: 'Destination network' });
        const rows = within(picker).getAllByRole('button', { name: /^Select / });
        expect(rows).toHaveLength(CHAINS.length);
        for (const row of rows) expect(row.querySelector('img')).toBeTruthy();

        fireEvent.click(within(picker).getByRole('button', { name: 'Select Litecoin' }));
        expect(onChange).toHaveBeenCalledWith('litecoin-mainnet');
        expect(screen.queryByRole('dialog', { name: 'Destination network' })).toBeNull();
    });

    it('offers All networks when opted in and reports the all sentinel', () => {
        const onChange = vi.fn();
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={onChange}
                chainIds={CHAINS}
                chainRegistry={registry}
                allOption
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Network: Bitcoin' }));
        fireEvent.click(screen.getByRole('button', { name: 'Select All networks' }));
        expect(onChange).toHaveBeenCalledWith('all');
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
    });

    it('shows All networks with the filter icon when the opted-in sentinel is selected', () => {
        render(
            <NetworkField
                value="all"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
                allOption
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Network: All networks' });
        expect(trigger).toHaveTextContent('All networks');
        expect(trigger.querySelectorAll('svg[data-xc-icon]')).toHaveLength(2);
        expect(trigger.querySelector('img')).toBeNull();
    });

    it('closes from Escape and Back without changing the value and restores focus', () => {
        const onChange = vi.fn();
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={onChange}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );
        const field = screen.getByRole('button', { name: 'Network: Bitcoin' });

        fireEvent.click(field);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(field).toHaveFocus();

        fireEvent.click(field);
        fireEvent.click(screen.getByRole('button', { name: /Back/ }));
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(field).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('delegates opening to a host-owned picker when requested', () => {
        const onOpenPicker = vi.fn();
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
                onOpenPicker={onOpenPicker}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Network: Bitcoin' }));
        expect(onOpenPicker).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('forwards the disabled state', () => {
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
                disabled
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Network: Bitcoin' });
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('draws the label help tip beside the label when help is given', () => {
        render(
            <NetworkField
                label="Coin network"
                help="The chain this private key belongs to."
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );
        const tip = screen.getByRole('button', { name: 'About Coin network' });
        expect(tip.closest('div').textContent).toContain('Coin network');
        expect(screen.getByRole('button', { name: 'Coin network: Bitcoin' })).toBeInTheDocument();
        fireEvent.click(tip);
        expect(screen.getByText('The chain this private key belongs to.')).toBeInTheDocument();
    });

    it('keeps the plain label and no tip when help is not given', () => {
        render(
            <NetworkField
                value="bitcoin-mainnet"
                onChange={() => {}}
                chainIds={CHAINS}
                chainRegistry={registry}
            />,
        );
        expect(screen.getByText('Network')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
    });
});
