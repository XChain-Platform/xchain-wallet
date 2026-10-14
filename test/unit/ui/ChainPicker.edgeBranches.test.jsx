// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

describe('<ChainPicker> edge branches', () => {
    it('searches display names, tickers, and network kinds and reports no matches', () => {
        renderPicker();
        fireEvent.click(screen.getByRole('button', { name: 'Network: Select a network' }));
        const search = screen.getByRole('textbox', { name: 'Search networks' });

        fireEvent.change(search, { target: { value: 'special' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('Special Network');

        fireEvent.change(search, { target: { value: 'testnet' } });
        expect(screen.getAllByRole('option')).toHaveLength(1);
        expect(screen.getByRole('option')).toHaveTextContent('Network 4');

        fireEvent.change(search, { target: { value: 'missing' } });
        expect(screen.queryByRole('option')).toBeNull();
        expect(screen.getByText('No matching networks.')).toBeInTheDocument();
    });

    it('opens at the last option on ArrowUp when nothing is selected', () => {
        renderPicker({ chainIds: IDS.slice(0, 3) });
        const trigger = screen.getByRole('button', { name: 'Network: Select a network' });

        fireEvent.keyDown(trigger, { key: 'ArrowUp' });

        const options = screen.getAllByRole('option');
        expect(options.at(-1)).toHaveFocus();
    });

    it('closes on an outside pointer, Tab, and a second trigger click', () => {
        renderPicker({ chainIds: IDS.slice(0, 3) });
        const trigger = screen.getByRole('button', { name: 'Network: Select a network' });

        fireEvent.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();

        fireEvent.click(trigger);
        fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'Tab' });
        expect(screen.queryByRole('listbox')).toBeNull();

        fireEvent.click(trigger);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).toBeNull();
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
        fireEvent.click(screen.getByRole('option'));
        expect(onChange).toHaveBeenCalledWith('unknown-chain');
        expect(trigger).toHaveFocus();
    });
});
