// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({
        walletId, accountId, title, pickerMode, networkFilter, networkLocked, pickerUnavailableReason,
        pickerActions, onPick, onBack,
    }) => (
        <section
            data-testid="address-list"
            data-wallet-id={walletId}
            data-account-id={accountId}
            data-title={title}
            data-picker-mode={String(pickerMode)}
            data-network-filter={networkFilter}
            data-picker-action-count={pickerActions.length}
            data-network-locked={String(networkLocked)}
            data-unavailable={pickerUnavailableReason ? pickerUnavailableReason({ id: 'address-2' }, 'bitcoin-mainnet') : ''}
        >
            <button type="button" onClick={() => onPick({ id: 'address-2', address: 'bc1-picked' }, 'bitcoin-mainnet')}>
                Pick Bitcoin address
            </button>
            <button type="button" onClick={() => onPick({ id: 'address-3', address: 'ltc1-picked' }, 'litecoin-mainnet')}>
                Pick Litecoin address
            </button>
            <button type="button" onClick={onBack}>Back</button>
        </section>
    ),
}));

vi.mock('../../../packages/core/src/shared/components/BalanceList.jsx', () => ({
    coinFromChainId: (chainId) => chainId.split('-')[0],
}));

import { OwnAddressPickerScreen } from '../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('OwnAddressPickerScreen', () => {
    function mount() {
        const onPick = vi.fn();
        const onChainChange = vi.fn();
        const onBack = vi.fn();
        render(
            <OwnAddressPickerScreen
                walletId="wallet-1"
                accountId="account-2"
                chainId="bitcoin-mainnet"
                title="From address"
                onPick={onPick}
                onChainChange={onChainChange}
                onBack={onBack}
                pickerActions={[{ key: 'new', label: 'New address', onSelect: vi.fn() }]}
            />,
        );
        return { onPick, onChainChange, onBack };
    }

    it('uses AddressList in picker mode with the calling form context', () => {
        mount();

        expect(screen.getByTestId('address-list')).toHaveAttribute('data-wallet-id', 'wallet-1');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-account-id', 'account-2');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-title', 'From address');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-picker-mode', 'true');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-filter', 'bitcoin');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-picker-action-count', '1');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-locked', 'false');
    });

    it('keeps a fixed-chain form on its chain and passes the unavailable reason through', () => {
        render(
            <OwnAddressPickerScreen
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                lockNetwork
                unavailableReason={() => 'Watch-only'}
                onPick={vi.fn()}
                onBack={vi.fn()}
                pickerActions={[]}
            />,
        );

        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-locked', 'true');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-filter', 'bitcoin');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-unavailable', 'Watch-only');
    });

    it('never locks a picker that has no chain to lock to', () => {
        render(
            <OwnAddressPickerScreen walletId="wallet-1" chainId={null} lockNetwork onPick={vi.fn()} onBack={vi.fn()} pickerActions={[]} />,
        );

        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-locked', 'false');
    });

    it('returns a same-chain record without changing the form network', () => {
        const { onPick, onChainChange, onBack } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledOnce();
        expect(onPick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Pick Bitcoin address' }));
        expect(onPick).toHaveBeenCalledWith({ id: 'address-2', address: 'bc1-picked' });
        expect(onChainChange).not.toHaveBeenCalled();
    });

    it('changes the form network before returning a cross-chain record', () => {
        const order = [];
        const onChainChange = vi.fn(() => order.push('chain'));
        const onPick = vi.fn(() => order.push('pick'));
        render(
            <OwnAddressPickerScreen
                walletId="wallet-1"
                chainId="bitcoin-mainnet"
                onChainChange={onChainChange}
                onPick={onPick}
                onBack={vi.fn()}
                pickerActions={[]}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Pick Litecoin address' }));

        expect(onChainChange).toHaveBeenCalledWith('litecoin-mainnet');
        expect(onPick).toHaveBeenCalledWith({ id: 'address-3', address: 'ltc1-picked' });
        expect(order).toEqual(['chain', 'pick']);
    });
});
