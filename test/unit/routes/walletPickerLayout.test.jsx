// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

afterEach(() => cleanup());

describe('WalletPicker row layout', () => {
    it('groups a long wallet name and its format in a wrapping text column', async () => {
        const wallet = {
            id: 'wallet-1',
            name: 'A wallet name long enough to wrap on a narrow screen',
            format: 'bip39',
        };
        let view;
        await act(async () => {
            view = render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: () => Promise.resolve([wallet]) }}
                >
                    <WalletPicker
                        activeWalletId={null}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });

        const row = Array.from(view.container.querySelectorAll('button'))
            .find((button) => button.textContent.includes(wallet.name));
        expect(row).toBeTruthy();
        expect(row.children).toHaveLength(1);
        expect(row.firstElementChild.children).toHaveLength(2);
        expect(row.firstElementChild.textContent).toContain('BIP39');
    });
});

describe('WalletPicker switching', () => {
    const wallets = [
        { id: 'wallet-1', name: 'Primary', format: 'bip39' },
        { id: 'wallet-2', name: 'Savings', format: 'bip39' },
    ];

    function mountPicker(onSwitch, onBack = vi.fn()) {
        render(
            <MessagingProvider
                shell="popup"
                messaging={{ listWallets: () => Promise.resolve(wallets) }}
            >
                <WalletPicker
                    activeWalletId="wallet-1"
                    onSwitch={onSwitch}
                    onAddWallet={() => {}}
                    onBack={onBack}
                />
            </MessagingProvider>,
        );
        return { onBack };
    }

    it('waits for a switch to finish and locks every escape path', async () => {
        let finishSwitch;
        const onSwitch = vi.fn(() => new Promise((resolve) => {
            finishSwitch = resolve;
        }));
        const { onBack } = mountPicker(onSwitch);
        const savings = await screen.findByRole('button', { name: /Savings/ });

        fireEvent.click(savings);

        expect(onSwitch).toHaveBeenCalledWith('wallet-2');
        expect(onBack).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Add Wallet' }).disabled).toBe(true);
        expect(savings.disabled).toBe(true);
        expect(savings.getAttribute('aria-busy')).toBe('true');

        finishSwitch();
        await waitFor(() => expect(onBack).toHaveBeenCalledOnce());
    });

    it('stays on the picker and permits retry when switching fails', async () => {
        const onSwitch = vi.fn().mockRejectedValue(new Error('Switch refused'));
        const { onBack } = mountPicker(onSwitch);
        const savings = await screen.findByRole('button', { name: /Savings/ });

        fireEvent.click(savings);

        expect(await screen.findByText('Switch refused')).toBeTruthy();
        expect(onBack).not.toHaveBeenCalled();
        await waitFor(() => expect(savings.disabled).toBe(false));
        expect(screen.getByRole('button', { name: 'Back' }).disabled).toBe(false);
    });
});
