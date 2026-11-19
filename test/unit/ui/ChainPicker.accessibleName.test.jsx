// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ChainPicker } from '../../../packages/core/src/ui/ChainPicker.jsx';
import { IconSelect } from '../../../packages/core/src/ui/IconSelect.jsx';
import { NetworkField } from '../../../packages/core/src/ui/NetworkField.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const reg = defaultRegistry();
const CHAINS = ['bitcoin-regtest', 'litecoin-regtest'];

describe('<ChainPicker> accessible name', () => {
    it('names the field and the current selection', () => {
        render(
            <ChainPicker
                label="Network"
                value="bitcoin-regtest"
                chainIds={CHAINS}
                chainRegistry={reg}
                onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' }))
            .toBeInTheDocument();
    });

    it('distinguishes two pickers on one screen, which is the cross-chain case', () => {
        render(
            <>
                <ChainPicker
                    label="Give chain" value="bitcoin-regtest"
                    chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
                />
                <ChainPicker
                    label="Get chain" value="litecoin-regtest"
                    chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
                />
            </>,
        );
        expect(screen.getByRole('button', { name: /^Give chain:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Get chain:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Give chain: Bitcoin' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get chain: Litecoin' }))
            .toBeInTheDocument();
    });

    it('names the placeholder when nothing is selected yet', () => {
        render(
            <ChainPicker
                label="Coin" value="" placeholder="Select a network"
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Coin: Select a network' }))
            .toBeInTheDocument();
    });

    it('never includes the network kind in the field name', () => {
        render(
            <ChainPicker
                label="Network" value="bitcoin-regtest"
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /regtest/ })).toBeNull();
    });

    it('leaves an unlabelled picker naming itself by its selection', () => {
        render(
            <ChainPicker
                value="bitcoin-regtest"
                chainIds={CHAINS} chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.queryByRole('button', { name: /undefined/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Bitcoin/ })).toBeInTheDocument();
    });

    it('uses the same display name for every network kind', () => {
        const { rerender } = render(
            <ChainPicker
                label="Network" value="bitcoin-mainnet"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest']}
                chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' })).toBeInTheDocument();

        rerender(
            <ChainPicker
                label="Network" value="bitcoin-testnet"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest']}
                chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' }))
            .toBeInTheDocument();

        rerender(
            <ChainPicker
                label="Network" value="bitcoin-regtest"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest']}
                chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' }))
            .toBeInTheDocument();
    });
});

describe('<IconSelect> accessible name', () => {
    const OPTIONS = [
        { value: 'ecdh', label: 'Encrypted' },
        { value: 'none', label: 'Plain text' },
    ];

    it('names the field and the current selection', () => {
        render(
            <IconSelect label="Encryption" value="ecdh" options={OPTIONS} onChange={() => {}} />,
        );
        expect(screen.getByRole('button', { name: 'Encryption: Encrypted' })).toBeInTheDocument();
    });

    it('distinguishes the two selects ComposeMessage renders together', () => {
        render(
            <>
                <IconSelect label="Encryption" value="ecdh" options={OPTIONS} onChange={() => {}} />
                <IconSelect
                    label="Delivery network" value="ecdh" options={OPTIONS} onChange={() => {}}
                />
            </>,
        );
        expect(screen.getByRole('button', { name: /^Encryption:/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Delivery network:/ })).toBeInTheDocument();
    });

    it('names the placeholder when nothing is selected, and never "undefined"', () => {
        render(
            <>
                <IconSelect label="Encryption" value="" placeholder="Select…" options={OPTIONS} onChange={() => {}} />
                <IconSelect value="ecdh" options={OPTIONS} onChange={() => {}} />
            </>,
        );
        expect(screen.getByRole('button', { name: 'Encryption: Select…' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /undefined/ })).toBeNull();
    });
});

describe('picker keyboard operation', () => {
    // ChainPicker is the Network field now: pressing it opens the full-screen
    // network list (operator ruling 2026-11-13), never a listbox popover.
    it('opens the network list from the field, moves with the arrows, selects, and restores focus', () => {
        const onChange = vi.fn();
        render(
            <ChainPicker
                label="Network" value="bitcoin-regtest"
                chainIds={CHAINS} chainRegistry={reg} onChange={onChange}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Network: Bitcoin' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

        fireEvent.click(trigger);
        expect(screen.queryByRole('listbox')).toBeNull();
        const list = screen.getByRole('dialog', { name: 'Network' });
        const rows = within(list).getAllByRole('button', { name: /^Select / });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveAttribute('aria-current', 'true');

        rows[0].focus();
        fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
        expect(rows[1]).toHaveFocus();
        fireEvent.click(rows[1]);

        expect(onChange).toHaveBeenCalledWith('litecoin-regtest');
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('lists every network with its ticker and kind and closes on Escape without a change', () => {
        const onChange = vi.fn();
        const chainIds = reg.supportedChains().map((chain) => chain.id);
        render(
            <ChainPicker
                label="Network" value="bitcoin-mainnet"
                chainIds={chainIds} chainRegistry={reg} onChange={onChange}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Network: Bitcoin' });

        fireEvent.click(trigger);
        const list = screen.getByRole('dialog', { name: 'Network' });
        expect(within(list).getAllByRole('button', { name: /^Select / })).toHaveLength(chainIds.length);
        expect(within(list).getAllByText(/ · Testnet$/)).toHaveLength(3);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('supports IconSelect arrow, End, and Space keys', () => {
        const onChange = vi.fn();
        const options = [
            { value: 'ecdh', label: 'Encrypted' },
            { value: 'none', label: 'Plain text' },
            { value: 'signed', label: 'Signed only' },
        ];
        render(
            <IconSelect label="Encryption" value="ecdh" options={options} onChange={onChange} />,
        );
        const trigger = screen.getByRole('button', { name: 'Encryption: Encrypted' });

        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const renderedOptions = screen.getAllByRole('option');
        expect(renderedOptions[0]).toHaveFocus();
        fireEvent.keyDown(renderedOptions[0], { key: 'End' });
        expect(renderedOptions[2]).toHaveFocus();
        fireEvent.keyDown(renderedOptions[2], { key: ' ' });

        expect(onChange).toHaveBeenCalledWith('signed');
        expect(trigger).toHaveFocus();
    });
});

describe('<NetworkField>', () => {
    it('uses the default label without exposing the selected network kind', () => {
        render(
            <NetworkField
                value="bitcoin-testnet"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet']}
                chainRegistry={reg}
                onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin' }))
            .toBeInTheDocument();
    });
});
