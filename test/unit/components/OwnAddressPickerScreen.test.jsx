// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({
        walletId, accountId, title, pickerMode, networkFilter, pickerActions, onPick, onBack,
    }) => (
        <section
            data-testid="address-list"
            data-wallet-id={walletId}
            data-account-id={accountId}
            data-title={title}
            data-picker-mode={String(pickerMode)}
            data-network-filter={networkFilter}
            data-picker-action-count={pickerActions.length}
        >
            <button type="button" onClick={() => onPick({ id: 'address-2', address: 'bc1-picked' })}>
                Pick address
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
        const onBack = vi.fn();
        render(
            <OwnAddressPickerScreen
                walletId="wallet-1"
                accountId="account-2"
                chainId="bitcoin-mainnet"
                title="From address"
                onPick={onPick}
                onBack={onBack}
                pickerActions={[{ key: 'new', label: 'New address', onSelect: vi.fn() }]}
            />,
        );
        return { onPick, onBack };
    }

    it('uses AddressList in picker mode with the calling form context', () => {
        mount();

        expect(screen.getByTestId('address-list')).toHaveAttribute('data-wallet-id', 'wallet-1');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-account-id', 'account-2');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-title', 'From address');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-picker-mode', 'true');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-network-filter', 'bitcoin');
        expect(screen.getByTestId('address-list')).toHaveAttribute('data-picker-action-count', '1');
    });

    it('returns the selected record and cancels without a selection on Back', () => {
        const { onPick, onBack } = mount();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledOnce();
        expect(onPick).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Pick address' }));
        expect(onPick).toHaveBeenCalledWith({ id: 'address-2', address: 'bc1-picked' });
    });
});
