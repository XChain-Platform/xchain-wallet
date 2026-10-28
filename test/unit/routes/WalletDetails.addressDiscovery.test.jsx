// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wallet details offers the used-address check again, and the status line
// reads each state of the scan: checking, found, and could not finish.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { addressDiscoveryLine } from '../../../packages/core/src/shared/components/AddressDiscoveryNotice.jsx';

const wallet = { id: 'w-1', name: 'Restored', format: 'bip39', origin: 'imported-mnemonic', passphraseEnabled: false };

function job(overrides) {
    return { id: 1, walletIds: ['w-1'], status: 'done', chainsTotal: 1, chainsDone: 1, found: 0, failedChains: [], dismissed: false, ...overrides };
}

afterEach(() => cleanup());

describe('address discovery status line', () => {
    it('reads progress, the count found, and the networks that did not finish', () => {
        expect(addressDiscoveryLine(job({ status: 'running', chainsTotal: 3, chainsDone: 1 })).text)
            .toBe('Checking for used addresses (1 of 3 networks checked)');
        expect(addressDiscoveryLine(job({ found: 2 })).text).toBe('Found 2 used addresses');
        expect(addressDiscoveryLine(job({ found: 1 })).text).toBe('Found 1 used address');
        const failed = addressDiscoveryLine(job({ failedChains: ['Bitcoin'] }));
        expect(failed).toMatchObject({ failed: true, variant: 'warning' });
        expect(failed.text).toBe("Couldn't finish checking for used addresses on Bitcoin. Try again");
        expect(addressDiscoveryLine(job({ failedChains: ['Bitcoin', 'Litecoin'] })).text)
            .toBe("Couldn't finish checking for used addresses on Bitcoin and Litecoin. Try again");
        expect(addressDiscoveryLine(null)).toBeNull();
    });

    it('reads a reply that is not a scan snapshot as no scan', () => {
        expect(addressDiscoveryLine({})).toBeNull();
        expect(addressDiscoveryLine({ id: 1, status: 'done' })).toBeNull();
        expect(addressDiscoveryLine('done')).toBeNull();
    });
});

describe('Wallet details used-address check', () => {
    it('starts a check for this wallet and shows its result, with Try again on a failure', async () => {
        let current = job({ status: 'running', chainsTotal: 1, chainsDone: 0 });
        const messaging = {
            listWallets: vi.fn(async () => [wallet]),
            listAccounts: vi.fn(async () => []),
            discoverAddresses: vi.fn(async () => current),
            addressDiscoveryStatus: vi.fn(async () => current),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <WalletDetails walletId={wallet.id} onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: 'Check for used addresses' }));
        await waitFor(() => expect(messaging.discoverAddresses).toHaveBeenCalledWith({ walletId: 'w-1' }));
        expect(await screen.findByText('Checking for used addresses (0 of 1 network checked)')).toBeInTheDocument();

        current = job({ failedChains: ['Bitcoin'] });
        expect(await screen.findByText("Couldn't finish checking for used addresses on Bitcoin. Try again", {}, { timeout: 3000 }))
            .toBeInTheDocument();
        current = job({ id: 2, found: 2 });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText('Found 2 used addresses')).toBeInTheDocument();
        expect(messaging.discoverAddresses).toHaveBeenCalledTimes(2);
    });

    it('is not offered on an imported-key wallet', async () => {
        const messaging = {
            listWallets: vi.fn(async () => [{ ...wallet, format: 'wif-only' }]),
            listAccounts: vi.fn(async () => []),
            discoverAddresses: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <WalletDetails walletId={wallet.id} onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByText('Restored');
        expect(screen.queryByRole('button', { name: 'Check for used addresses' })).toBeNull();
    });
});
