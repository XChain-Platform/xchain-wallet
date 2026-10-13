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
import { fireEvent, render, screen } from '@testing-library/react';
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
        expect(screen.getByRole('button', { name: 'Network: Bitcoin · regtest' }))
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
        expect(screen.getByRole('button', { name: 'Give chain: Bitcoin · regtest' }))
            .toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get chain: Litecoin · regtest' }))
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

    it('honours hideNetworkKind, so the name matches what is on screen', () => {
        render(
            <ChainPicker
                label="Network" value="bitcoin-regtest" hideNetworkKind
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

    it('announces testnet and regtest while leaving mainnet implicit', () => {
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
        expect(screen.getByRole('button', { name: 'Network: Bitcoin · testnet' }))
            .toBeInTheDocument();

        rerender(
            <ChainPicker
                label="Network" value="bitcoin-regtest"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest']}
                chainRegistry={reg} onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin · regtest' }))
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
    it('opens ChainPicker from the keyboard, navigates, selects, and restores focus', () => {
        const onChange = vi.fn();
        render(
            <ChainPicker
                label="Network" value="bitcoin-regtest"
                chainIds={CHAINS} chainRegistry={reg} onChange={onChange}
            />,
        );
        const trigger = screen.getByRole('button', { name: 'Network: Bitcoin · regtest' });

        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const options = screen.getAllByRole('option');
        expect(options[0]).toHaveFocus();
        expect(options[0]).toHaveAttribute('aria-selected', 'true');

        fireEvent.keyDown(options[0], { key: 'ArrowDown' });
        expect(options[1]).toHaveFocus();
        fireEvent.keyDown(options[1], { key: 'Enter' });

        expect(onChange).toHaveBeenCalledWith('litecoin-regtest');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger).toHaveFocus();
    });

    it('focuses searchable input, moves into results, and clears searches on Escape', () => {
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
        const search = screen.getByRole('textbox', { name: 'Search networks' });
        expect(search).toHaveFocus();
        fireEvent.change(search, { target: { value: 'testnet' } });
        expect(screen.getAllByRole('option')).toHaveLength(3);
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(screen.getAllByRole('option')[0]).toHaveFocus();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(trigger).toHaveFocus();
        fireEvent.click(trigger);
        expect(screen.getAllByRole('option')).toHaveLength(chainIds.length);
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
    it('uses the default label and exposes the selected network kind', () => {
        render(
            <NetworkField
                value="bitcoin-testnet"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet']}
                chainRegistry={reg}
                onChange={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Network: Bitcoin · testnet' }))
            .toBeInTheDocument();
    });
});
