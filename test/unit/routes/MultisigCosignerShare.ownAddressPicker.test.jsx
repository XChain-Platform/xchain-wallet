// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const CHAIN = 'bitcoin-mainnet';
const AVAILABLE = {
    id: 'address-hd',
    address: 'bc1qshare0000000000000000000000000000000',
    publicKey: `02${'a'.repeat(64)}`,
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const WATCH_ONLY = {
    id: 'address-watch',
    address: 'bc1qwatch000000000000000000000000000000',
    source: 'watch-only',
};

vi.mock('../../../packages/core/src/shared/components/KeyQR.jsx', () => ({
    KeyQR: () => null,
}));
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId, lockNetwork, onChainChange, unavailableReason, onPick }) => (
        <section data-testid="own-address-picker" data-chain-id={chainId} data-lock-network={String(Boolean(lockNetwork))}>
            {onChainChange ? <button type="button">Switch picker network</button> : null}
            {[AVAILABLE, WATCH_ONLY].map((address) => {
                const reason = unavailableReason?.(address, chainId);
                return (
                    <button
                        key={address.id}
                        type="button"
                        disabled={Boolean(reason)}
                        onClick={() => onPick(address)}
                    >
                        {address.address}{reason ? `: ${reason}` : ''}
                    </button>
                );
            })}
        </section>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MultisigCosignerShare } from '../../../packages/core/src/shared/routes/MultisigCosignerShare.jsx';

afterEach(() => cleanup());

describe('MultisigCosignerShare own-address picker', () => {
    it('allows Bitcoin network selection, disables unavailable rows, and shares the picked address', async () => {
        const getMultisigCosignerInfo = vi.fn().mockResolvedValue({
            addressId: AVAILABLE.id,
            address: AVAILABLE.address,
            xpub: 'xpub-example',
            pubkey: AVAILABLE.publicKey,
            fingerprint: '73c5da0a',
            derivationPath: AVAILABLE.derivationPath,
        });
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [AVAILABLE, WATCH_ONLY] }),
            getMultisigCosignerInfo,
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <MultisigCosignerShare walletId="wallet-1" onBack={() => {}} />
            </MessagingProvider>,
        );

        const field = await screen.findByLabelText('Address to share');
        expect(field).toHaveAttribute('readonly');
        expect(field).toHaveAttribute('placeholder', 'Select address');
        expect(screen.queryByRole('combobox', { name: 'Address to share' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Choose address to share' }));

        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-chain-id', CHAIN);
        expect(screen.getByTestId('own-address-picker')).toHaveAttribute('data-lock-network', 'false');
        expect(screen.getByRole('button', { name: 'Switch picker network' })).toBeTruthy();
        expect(screen.getByRole('button', {
            name: `${WATCH_ONLY.address}: No key, unavailable`,
        })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: AVAILABLE.address }));

        expect(await screen.findByLabelText('Address to share')).toHaveValue(AVAILABLE.address);
        expect(getMultisigCosignerInfo).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Share' }));
        await waitFor(() => expect(getMultisigCosignerInfo).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            addressId: AVAILABLE.id,
        }));
    });
});
