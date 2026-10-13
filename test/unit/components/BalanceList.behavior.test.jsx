// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    BalanceList,
    buildBalanceRows,
    isSmallBalanceRow,
} from '../../../packages/core/src/shared/components/BalanceList.jsx';

afterEach(() => cleanup());

const row = (tick, overrides = {}) => ({
    chainId: 'bitcoin-mainnet',
    coin: 'bitcoin',
    tick,
    kind: 'token',
    displayName: `${tick} token`,
    quantity: '100000000',
    divisibility: 8,
    fiatRate: null,
    ...overrides,
});

describe('BalanceList ordering and visibility', () => {
    it('moves pinned rows first without disturbing either group order', () => {
        render(
            <BalanceList
                rows={[row('A'), row('B'), row('C'), row('D')]}
                pinnedKeys={new Set(['bitcoin-mainnet:B', 'bitcoin-mainnet:D'])}
            />,
        );

        expect(screen.getAllByRole('listitem').map((el) => el.dataset.balanceKey))
            .toEqual(['bitcoin-mainnet:B', 'bitcoin-mainnet:D', 'bitcoin-mainnet:A', 'bitcoin-mainnet:C']);
    });

    it('keeps a hidden row pinned and lets its action unpin it', () => {
        const onSelectToken = vi.fn();
        const onTogglePin = vi.fn();
        render(
            <BalanceList
                rows={[row('HIDDEN'), row('VISIBLE')]}
                hiddenKeys={new Set(['bitcoin-mainnet:HIDDEN'])}
                pinnedKeys={new Set(['bitcoin-mainnet:HIDDEN'])}
                onSelectToken={onSelectToken}
                onTogglePin={onTogglePin}
                onToggleHide={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden token' }));
        const unpin = screen.getByRole('button', { name: 'Unpin HIDDEN' });
        expect(unpin).toHaveAttribute('aria-pressed', 'true');
        expect(unpin.tagName).toBe('BUTTON');
        fireEvent.click(unpin);

        expect(onTogglePin).toHaveBeenCalledWith('bitcoin-mainnet:HIDDEN', false);
        expect(onSelectToken).not.toHaveBeenCalled();
    });

    it('hides and unhides rows without opening token details', () => {
        const onSelectToken = vi.fn();
        const onToggleHide = vi.fn();
        render(
            <BalanceList
                rows={[row('HIDDEN'), row('VISIBLE')]}
                hiddenKeys={new Set(['bitcoin-mainnet:HIDDEN'])}
                onSelectToken={onSelectToken}
                onToggleHide={onToggleHide}
            />,
        );

        const hide = screen.getByRole('button', { name: 'Hide VISIBLE' });
        expect(hide.tagName).toBe('BUTTON');
        fireEvent.click(hide);
        expect(onToggleHide).toHaveBeenCalledWith('bitcoin-mainnet:VISIBLE', true);

        fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unhide HIDDEN' }));
        expect(onToggleHide).toHaveBeenCalledWith('bitcoin-mainnet:HIDDEN', false);
        expect(onSelectToken).not.toHaveBeenCalled();
    });

    it('does not collapse an unavailable balance as a small known balance', () => {
        const unavailable = row('BTC', {
            kind: 'native',
            displayName: 'Bitcoin',
            quantity: '0',
            unavailable: 'all',
            unavailableReason: 'explorer unavailable',
        });
        expect(isSmallBalanceRow(unavailable)).toBe(false);

        render(<BalanceList rows={[unavailable]} hideSmallBalances />);
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.queryByTestId('small-balances-toggle')).toBeNull();
    });

    it('preserves a long token name for hover and accessible row labelling', () => {
        const displayName = 'A token name long enough to overflow a narrow wallet balance row';
        render(<BalanceList rows={[row('LONG', { displayName })]} onSelectToken={() => {}} />);

        expect(screen.getByTitle(displayName)).toHaveTextContent(displayName);
        expect(screen.getByRole('button', { name: `Open ${displayName} details` })).toBeInTheDocument();
    });

    it('labels confirmed and pending amounts separately', () => {
        const [pending] = buildBalanceRows({
            'bitcoin-mainnet': [{
                address: 'bc1qpending',
                balances: {
                    native: {
                        tick: 'BTC', quantity: '0', pendingQuantity: '25000000', divisibility: 8,
                    },
                    tokens: [],
                },
            }],
        }, {
            get: () => ({ coin: 'bitcoin', displayName: 'Bitcoin', networkKind: 'mainnet' }),
        });
        expect(isSmallBalanceRow(pending)).toBe(false);
        render(<BalanceList rows={[pending]} hideSmallBalances />);

        expect(screen.getByRole('listitem')).toHaveTextContent('0.00000000 confirmed');
        expect(screen.getByTestId('balance-pending')).toHaveTextContent('0.25000000 pending');
        expect(screen.queryByTestId('small-balances-toggle')).toBeNull();
    });
});
