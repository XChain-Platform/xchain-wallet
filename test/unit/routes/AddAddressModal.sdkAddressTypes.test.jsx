// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later


// Add address lists only the address types the installed SDK can generate and
// never sends a type the SDK refuses.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: {
        'bitcoin-mainnet': { strategy: 'normal' },
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
        'dogecoin-regtest': { strategy: 'normal' },
    },
};

function renderModal(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddAddressModal walletId="w1" accountId="acct-1" chainIds={[]} onClose={() => {}} />
        </MessagingProvider>,
    );
}

describe('Add address and an SDK that cannot build p2tr', () => {
    it('does not offer P2TR when the host reports it unsupported', async () => {
        const getSupportedAddressTypes = vi.fn(async () => ({ supported: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'] }));
        renderModal({ getSettings: async () => SETTINGS, getSupportedAddressTypes, generateReceiveAddress: vi.fn() });

        await waitFor(() => expect(getSupportedAddressTypes).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('option', { name: /P2TR/ })).toBeNull());
        expect(screen.getByRole('option', { name: /^P2WPKH/ })).toBeTruthy();
    });

    it('offers P2TR while the host reports it supported', async () => {
        const getSupportedAddressTypes = vi.fn(async () => ({
            supported: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'],
        }));
        renderModal({ getSettings: async () => SETTINGS, getSupportedAddressTypes, generateReceiveAddress: vi.fn() });

        await waitFor(() => expect(getSupportedAddressTypes).toHaveBeenCalled());
        expect(await screen.findByRole('option', { name: /P2TR/ })).toBeTruthy();
    });

    it('generates with the default type, and the refusal reads as an address type message', async () => {
        const generateReceiveAddress = vi.fn(async () => {
            throw Object.assign(new Error('Unknown address type: "p2tr". Supported: p2pkh, p2wpkh'), {
                name: 'SDKWalletError', code: 'INVALID_ADDRESS_TYPE',
            });
        });
        renderModal({
            getSettings: async () => SETTINGS,
            getSupportedAddressTypes: async () => ({ supported: ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh'] }),
            generateReceiveAddress,
        });

        await waitFor(() => expect(screen.queryByRole('option', { name: /P2TR/ })).toBeNull());
        fireEvent.click(await screen.findByRole('button', { name: /^Generate$/ }));

        await waitFor(() => expect(generateReceiveAddress).toHaveBeenCalledTimes(1));
        expect(generateReceiveAddress.mock.calls[0][0].addressType).toBe('p2wpkh');
        const text = await screen.findByText(/address type is not available/i);
        expect(text.textContent).not.toMatch(/unlocked/i);
    });
});
