// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChainPicker } from '../../../packages/core/src/ui/ChainPicker.jsx';

const IDS = Array.from({ length: 7 }, (_, index) => `chain-${index}`);
const registry = {
    get(id) {
        const index = Number(id.split('-')[1]);
        return {
            displayName: index === 3 ? 'Special Network' : `Network ${index}`,
            coin: index === 3 ? 'LTC' : 'BTC',
            networkKind: index === 4 ? 'testnet' : 'mainnet',
        };
    },
};

function renderPicker(props = {}) {
    return render(
        <ChainPicker
            label="Network"
            value=""
            chainIds={IDS}
            chainRegistry={registry}
            onChange={() => {}}
            {...props}
        />,
    );
}

// ChainPicker draws the Network field, which opens the full-screen network
// list (operator ruling 2026-11-13); these cover its edges.
describe('<ChainPicker> edge branches', () => {
    it('shows the placeholder muted until a network is chosen', () => {
        renderPicker();
        const trigger = screen.getByRole('button', { name: 'Network: Select a network' });
        expect(trigger).toHaveTextContent('Select a network');
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('lists every offered network with its ticker and network kind under the name', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Network: Select a network' }));
        const list = screen.getByRole('dialog', { name: 'Network' });

        expect(within(list).getAllByRole('button', { name: /^Select / })).toHaveLength(IDS.length);
        const special = within(list).getByRole('button', { name: 'Select Special Network' });
        expect(special.querySelector('[data-network-description]')).toHaveTextContent('LTC · Mainnet');
        const testnet = within(list).getByRole('button', { name: /^Select Network 4 testnet/ });
        expect(testnet.querySelector('[data-network-description]')).toHaveTextContent('BTC · Testnet');
        // Nothing chosen yet, so no row is current.
        expect(list.querySelector('[aria-current]')).toBeNull();
    });

    it('closes from Back without a change and reopens on the next press', () => {
        const onChange = vi.fn();
        renderPicker({ chainIds: IDS.slice(0, 3), onChange });
        const trigger = screen.getByRole('button', { name: 'Network: Select a network' });

        fireEvent.click(trigger);
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Network' })).getByRole('button', { name: /Back/ }));
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();

        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: 'Network' })).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not open while disabled', () => {
        renderPicker({ disabled: true });
        const trigger = screen.getByRole('button', { name: 'Network: Select a network' });
        expect(trigger).toBeDisabled();
        fireEvent.click(trigger);
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
    });

    it('uses ids as labels when registry data is unavailable', () => {
        const onChange = vi.fn();
        render(
            <ChainPicker
                label="Network"
                value="unknown-chain"
                chainIds={['unknown-chain']}
                chainRegistry={null}
                onChange={onChange}
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Network: unknown-chain' });
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('button', { name: 'Select unknown-chain' }));
        expect(onChange).toHaveBeenCalledWith('unknown-chain');
        expect(trigger).toHaveFocus();
    });
});
