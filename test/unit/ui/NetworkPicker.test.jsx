// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { NetworkPicker } from '../../../packages/core/src/ui/NetworkPicker.jsx';
import balanceStyles from '../../../packages/core/src/shared/components/BalanceList.module.css';
import listRowStyles from '../../../packages/core/src/ui/ListRow.module.css';

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

    it('draws each network row like a token row: big icon, name, description and right chevron', () => {
        render(
            <NetworkPicker
                value="bitcoin-mainnet"
                chainIds={['bitcoin-mainnet', 'bitcoin-testnet', 'dogecoin-mainnet']}
                chainRegistry={registry}
                onSelect={() => {}}
                onBack={() => {}}
            />,
        );

        const bitcoin = screen.getByRole('button', { name: 'Select Bitcoin' });
        // The token list's 40px mark, drawn from the chain icon.
        const mark = bitcoin.querySelector('[data-asset-mark]');
        expect(mark).not.toBeNull();
        expect(mark.querySelector('img')).not.toBeNull();
        expect(bitcoin.querySelector(`.${balanceStyles.name}`)).toHaveTextContent('Bitcoin');
        expect(bitcoin.querySelector('[data-network-description]')).toHaveTextContent('BTC · Mainnet');
        expect(bitcoin.querySelector(`.${listRowStyles.chevron} svg`)).not.toBeNull();
        // The row sits in the token list's row wrapper (inset and divider).
        expect(bitcoin.closest('li')).toHaveClass(balanceStyles.row);
        expect(bitcoin).toHaveClass(balanceStyles.rowContent);
        // No trailing check: the current row is marked as aria-current only, as TokenPicker marks none.
        expect(bitcoin).toHaveAttribute('aria-current', 'true');
        expect(bitcoin.querySelector(`.${listRowStyles.trailing}`)).toBeNull();

        const testnet = screen.getByRole('button', { name: /^Select Bitcoin testnet/ });
        expect(testnet.querySelector('[data-network-description]').textContent).toMatch(/· Testnet$/);
        expect(screen.getByRole('button', { name: 'Select Dogecoin' })
            .querySelector('[data-network-description]')).toHaveTextContent('DOGE · Mainnet');
    });

    it('never guesses a description: a custom kind reads as declared, an undescribed chain gets none', () => {
        const custom = {
            get: (id) => (id === 'pepe-signet'
                ? { displayName: 'Pepe', coin: 'pepe', nativeTicker: 'PEP', networkKind: 'signet' }
                : null),
        };
        render(
            <NetworkPicker
                value=""
                chainIds={['pepe-signet', 'ghost-chain']}
                chainRegistry={custom}
                onSelect={() => {}}
                onBack={() => {}}
            />,
        );

        expect(screen.getByRole('button', { name: /^Select Pepe/ })
            .querySelector('[data-network-description]')).toHaveTextContent('PEP · Signet');
        expect(screen.getByRole('button', { name: /^Select ghost-chain/ })
            .querySelector('[data-network-description]')).toBeNull();
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
