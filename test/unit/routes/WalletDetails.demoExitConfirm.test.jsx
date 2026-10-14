// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const exitDemoWallet = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/demoGraduation.js', async (importOriginal) => ({
    ...(await importOriginal()),
    exitDemoWallet,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const wallet = {
    id: 'demo-1',
    name: 'Demo wallet',
    format: 'bip39',
    origin: 'created',
    passphraseEnabled: false,
};

async function mount(props = {}) {
    const messaging = {
        listWallets: vi.fn(async () => [wallet]),
        listAccounts: vi.fn(async () => []),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <WalletDetails walletId={wallet.id} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    await screen.findByRole('button', { name: 'Exit demo & wipe' });
    return messaging;
}

beforeEach(() => {
    clearDemoWalletId();
    markDemoWallet(wallet.id);
    exitDemoWallet.mockReset();
    exitDemoWallet.mockResolvedValue({ reloaded: false });
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
});

describe('WalletDetails demo exit confirmation', () => {
    it('does not exit until the user explicitly confirms', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));

        const dialog = screen.getByRole('dialog');
        expect(exitDemoWallet).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Exit demo & wipe' }));
        expect(exitDemoWallet).toHaveBeenCalledWith(expect.objectContaining({ walletId: wallet.id }));
    });

    it('cancels without exiting', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

        expect(exitDemoWallet).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the confirmation open and retryable after a failed exit', async () => {
        exitDemoWallet.mockRejectedValueOnce(new Error('vault is busy'));
        await mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Exit demo & wipe' }));

        expect(await within(dialog).findByRole('alert')).toHaveTextContent('vault is busy');
        expect(within(dialog).getByRole('button', { name: 'Exit demo & wipe' })).toBeEnabled();
        expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    });
});
