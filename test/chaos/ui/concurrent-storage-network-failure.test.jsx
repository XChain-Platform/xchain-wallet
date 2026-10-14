// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AppearanceSection } from '../../../packages/core/src/shared/components/settings/AppearanceSection.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

function concurrentFailure(operation) {
    const storage = vi.fn(async () => {
        throw new Error('vault.settings.put: E_STORAGE_WRITE');
    });
    const network = vi.fn(async () => {
        throw new Error('request failed with status code 503 at https://service.invalid/api');
    });
    const promise = Promise.allSettled([storage(), network()]).then((results) => {
        throw new AggregateError(
            results.map((result) => result.reason),
            `${operation}: AggregateError E_STORAGE_WRITE at https://service.invalid/api`,
        );
    });
    return { promise, storage, network };
}

function messagingView(messaging, child) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('chaos/ui/concurrent-storage-network-failure', () => {
    it('keeps the current wallet selected and makes switching retryable', async () => {
        const onBack = vi.fn();
        let failure;
        const onSwitch = vi.fn(() => {
            failure = concurrentFailure('switchWallet');
            return failure.promise;
        });
        messagingView(
            { listWallets: async () => [
                { id: 'wallet-1', name: 'Primary', format: 'bip39' },
                { id: 'wallet-2', name: 'Savings', format: 'bip39' },
            ] },
            <WalletPicker
                activeWalletId="wallet-1"
                onSwitch={onSwitch}
                onAddWallet={() => {}}
                onBack={onBack}
            />,
        );

        const savings = await screen.findByRole('button', { name: /Savings/ });
        fireEvent.click(savings);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not switch wallets. Try again.');
        expect(failure.storage).toHaveBeenCalledOnce();
        expect(failure.network).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: /Primary/ })).toHaveAttribute('aria-current', 'true');
        expect(savings).not.toHaveAttribute('aria-current');
        await waitFor(() => expect(savings).toBeEnabled());
        expect(onBack).not.toHaveBeenCalled();
    });

    it('keeps address generation open with no false completion', async () => {
        let failure;
        const generateReceiveAddress = vi.fn(() => {
            failure = concurrentFailure('generateReceiveAddress');
            return failure.promise;
        });
        const onClose = vi.fn();
        const onGenerated = vi.fn();
        messagingView(
            {
                getSettings: async () => createDefaultSettings(),
                generateReceiveAddress,
            },
            <AddAddressModal
                walletId="wallet-1"
                accountId="account-1"
                chainIds={['bitcoin-mainnet']}
                onClose={onClose}
                onGenerated={onGenerated}
            />,
        );

        const generate = await screen.findByRole('button', { name: 'Generate' });
        fireEvent.click(generate);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not generate addresses. Make sure the wallet is unlocked or your hardware device is connected.',
        );
        expect(failure.storage).toHaveBeenCalledOnce();
        expect(failure.network).toHaveBeenCalledOnce();
        expect(onGenerated).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        await waitFor(() => expect(generate).toBeEnabled());
    });

    it('restores the saved setting and reports a plain save failure', async () => {
        const settings = createDefaultSettings();
        let failure;
        const updateSettings = vi.fn(() => {
            failure = concurrentFailure('saveSettings');
            return failure.promise;
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        messagingView(
            { getSettings: async () => settings, updateSettings },
            <AppearanceSection />,
        );

        const theme = await screen.findByRole('combobox', { name: 'Theme' });
        expect(theme).toHaveValue('system');
        fireEvent.change(theme, { target: { value: 'dark' } });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Could not save appearance settings. Try again.',
        );
        expect(failure.storage).toHaveBeenCalledOnce();
        expect(failure.network).toHaveBeenCalledOnce();
        expect(theme).toHaveValue('system');
        expect(updateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });
});
