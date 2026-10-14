// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

    it('forwards a custom label and emits a selected chain ID', () => {
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
        fireEvent.click(screen.getByRole('option', { name: /Litecoin/ }));
        expect(onChange).toHaveBeenCalledWith('litecoin-mainnet');
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
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
});
