// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { useTablistKeys } from '../../../packages/core/src/shared/keyboard/useTablistKeys.js';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';
import { VerifySignatureForm } from '../../../packages/core/src/shared/routes/VerifySignatureForm.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

const TAB_STOP_SELECTOR = [
    'button:not([disabled]):not([tabindex="-1"])',
    'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
    'textarea:not([disabled]):not([tabindex="-1"])',
    'select:not([disabled]):not([tabindex="-1"])',
    'a[href]:not([tabindex="-1"])',
].join(',');

function KeyboardHost() {
    useTablistKeys();
    return null;
}

function renderRoute(route, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <KeyboardHost />
            {route}
        </MessagingProvider>,
    );
}

function tabStops(container) {
    return Array.from(container.querySelectorAll(TAB_STOP_SELECTOR))
        .filter((element) => !element.closest('[hidden], [inert]'));
}

function pressEnter(element) {
    element.focus();
    fireEvent.keyDown(element, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.click(element, { detail: 0 });
    fireEvent.keyUp(element, { key: 'Enter', code: 'Enter', charCode: 13 });
}

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('T through Z route keyboard flows', () => {
    it('operates TokenPicker filters, tabs, overlays, and selection from the keyboard', async () => {
        const onBack = vi.fn();
        const onSelect = vi.fn();
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({}),
            getWalletBalances: vi.fn().mockResolvedValue({
                'bitcoin-mainnet': [{
                    address: 'bc1qkeyboard',
                    balances: {
                        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                        tokens: [{ tick: 'KEYS', displayName: 'Keyboard Token', quantity: '2', divisibility: 0 }],
                    },
                }],
            }),
        };
        const view = renderRoute(
            <TokenPicker
                purpose="send"
                walletId="wallet-1"
                onBack={onBack}
                onSelect={onSelect}
            />,
            messaging,
        );

        const back = screen.getByRole('button', { name: 'Back to home' });
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
        const network = screen.getByRole('button', { name: /All networks/ });
        const allTab = screen.getByRole('tab', { name: 'All' });
        const bitcoin = await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        const token = screen.getByRole('button', { name: /^Select Keyboard Token\b/ });

        expect(tabStops(view.container)).toEqual([back, search, network, allTab, bitcoin, token]);
        expect(screen.getByRole('tab', { name: 'Coins' })).toHaveAttribute('tabindex', '-1');
        expect(screen.getByRole('tab', { name: 'Tokens' })).toHaveAttribute('tabindex', '-1');

        pressEnter(back);
        expect(onBack).toHaveBeenCalledOnce();

        network.focus();
        fireEvent.keyDown(network, { key: 'ArrowDown' });
        const allNetworks = await screen.findByRole('option', { name: /All networks/ });
        await waitFor(() => expect(document.activeElement).toBe(allNetworks));
        fireEvent.keyDown(allNetworks, { key: 'Escape' });
        expect(screen.queryByRole('listbox', { name: 'Networks' })).not.toBeInTheDocument();
        expect(document.activeElement).toBe(network);

        fireEvent.keyDown(network, { key: 'ArrowDown' });
        await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'option'));
        fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
        expect(document.activeElement).toHaveAccessibleName(/Bitcoin/);
        fireEvent.keyDown(document.activeElement, { key: 'Enter' });
        expect(screen.queryByRole('listbox', { name: 'Networks' })).not.toBeInTheDocument();
        expect(document.activeElement).toBe(network);

        allTab.focus();
        fireEvent.keyDown(allTab, { key: 'ArrowRight' });
        const coinsTab = screen.getByRole('tab', { name: 'Coins' });
        expect(document.activeElement).toBe(coinsTab);
        expect(coinsTab).toHaveAttribute('aria-selected', 'true');
        fireEvent.keyDown(coinsTab, { key: 'ArrowRight' });
        const tokensTab = screen.getByRole('tab', { name: 'Tokens' });
        expect(document.activeElement).toBe(tokensTab);
        expect(tokensTab).toHaveAttribute('aria-selected', 'true');
        expect(tokensTab).toHaveAttribute('tabindex', '0');

        pressEnter(screen.getByRole('button', { name: /^Select Keyboard Token\b/ }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'KEYS',
        }));
    });

    it('operates VerifySignatureForm in field order and dismisses its chain overlay with Escape', async () => {
        const onBack = vi.fn();
        const verifyMessageRequest = vi.fn().mockResolvedValue({ valid: true });
        const view = renderRoute(
            <VerifySignatureForm onBack={onBack} />,
            {
                getSettings: vi.fn().mockResolvedValue({}),
                verifyMessageRequest,
            },
        );

        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        const chain = screen.getByRole('button', { name: /Chain: Bitcoin/ });
        const address = screen.getByLabelText('Address');
        const message = screen.getByLabelText('Message');
        const signature = screen.getByLabelText('Signature');
        const verify = screen.getByRole('button', { name: 'Verify signature' });

        expect(tabStops(view.container)).toEqual([back, chain, address, message, signature]);
        pressEnter(back);
        expect(onBack).toHaveBeenCalledOnce();

        chain.focus();
        fireEvent.keyDown(chain, { key: 'ArrowDown' });
        const chainList = await screen.findByRole('listbox', { name: 'Chain' });
        await waitFor(() => expect(chainList.contains(document.activeElement)).toBe(true));
        fireEvent.keyDown(document.activeElement, { key: 'Escape' });
        expect(screen.queryByRole('listbox', { name: 'Chain' })).not.toBeInTheDocument();
        expect(document.activeElement).toBe(chain);

        fireEvent.change(address, { target: { value: 'bc1qcounterparty' } });
        fireEvent.change(message, { target: { value: 'signed with a keyboard' } });
        fireEvent.change(signature, { target: { value: 'c2lnbmF0dXJl' } });
        expect(tabStops(view.container)).toEqual([back, chain, address, message, signature, verify]);

        pressEnter(verify);
        await waitFor(() => expect(verifyMessageRequest).toHaveBeenCalledWith(expect.objectContaining({
            address: 'bc1qcounterparty',
            message: 'signed with a keyboard',
            signature: 'c2lnbmF0dXJl',
        })));
        expect(screen.getByRole('status')).toHaveTextContent('Valid signature.');
    });

    it('keeps every WalletPicker action in logical keyboard order', async () => {
        const wallets = [
            { id: 'wallet-1', name: 'Primary', format: 'bip39' },
            { id: 'wallet-2', name: 'Savings', format: 'bip39' },
        ];
        const onBack = vi.fn();
        const onSwitch = vi.fn().mockResolvedValue(undefined);
        const onAddWallet = vi.fn();
        const onShowDetails = vi.fn();
        const view = renderRoute(
            <WalletPicker
                activeWalletId="wallet-1"
                onSwitch={onSwitch}
                onAddWallet={onAddWallet}
                onShowDetails={onShowDetails}
                onBack={onBack}
            />,
            {
                getSettings: vi.fn().mockResolvedValue({}),
                listWallets: vi.fn().mockResolvedValue(wallets),
            },
        );

        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        const primary = await screen.findByRole('button', { name: /^Primary/ });
        const primaryDetails = screen.getByRole('button', { name: 'Wallet details for Primary' });
        const savings = screen.getByRole('button', { name: /^Savings/ });
        const savingsDetails = screen.getByRole('button', { name: 'Wallet details for Savings' });
        const add = screen.getByRole('button', { name: 'Add wallet' });
        const manage = screen.getByRole('button', { name: 'Manage wallet' });

        expect(tabStops(view.container)).toEqual([
            back,
            primary,
            primaryDetails,
            savings,
            savingsDetails,
            add,
            manage,
        ]);

        pressEnter(back);
        pressEnter(primary);
        pressEnter(primaryDetails);
        pressEnter(savingsDetails);
        pressEnter(add);
        pressEnter(manage);
        pressEnter(savings);

        expect(onAddWallet).toHaveBeenCalledOnce();
        expect(onShowDetails.mock.calls).toEqual([['wallet-1'], ['wallet-2'], ['wallet-1']]);
        expect(onSwitch).toHaveBeenCalledWith('wallet-2');
        await waitFor(() => expect(onBack).toHaveBeenCalledTimes(3));
    });

    it('reaches every WalletDetails action and closes its confirmation overlay with Escape', async () => {
        const wallet = {
            id: 'demo-wallet',
            name: 'Keyboard demo',
            format: 'counterwallet-legacy',
            origin: 'imported-freewallet',
            passphraseEnabled: false,
        };
        markDemoWallet(wallet.id);
        const onBack = vi.fn();
        const onRename = vi.fn();
        const onMigrateToBip39 = vi.fn();
        const view = renderRoute(
            <WalletDetails
                walletId={wallet.id}
                onBack={onBack}
                onRename={onRename}
                onMigrateToBip39={onMigrateToBip39}
            />,
            {
                getSettings: vi.fn().mockResolvedValue({}),
                listWallets: vi.fn().mockResolvedValue([wallet]),
                listAccounts: vi.fn().mockResolvedValue([]),
            },
        );

        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        const migrate = await screen.findByRole('button', { name: 'Upgrade recovery phrase' });
        const rename = screen.getByRole('button', { name: 'Rename wallet' });
        const exit = screen.getByRole('button', { name: 'Exit demo & wipe' });
        expect(tabStops(view.container)).toEqual([back, migrate, rename, exit]);

        pressEnter(back);
        pressEnter(migrate);
        pressEnter(rename);
        expect(onBack).toHaveBeenCalledOnce();
        expect(onMigrateToBip39).toHaveBeenCalledOnce();
        expect(onRename).toHaveBeenCalledWith(wallet);

        pressEnter(exit);
        const dialog = screen.getByRole('dialog', { name: 'Exit demo and delete its data?' });
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
        const confirm = within(dialog).getByRole('button', { name: 'Exit demo & wipe' });
        expect(tabStops(dialog)).toEqual([cancel, confirm]);
        await waitFor(() => expect(document.activeElement).toBe(cancel));
        confirm.focus();
        fireEvent.keyDown(confirm, { key: 'Tab' });
        expect(document.activeElement).toBe(cancel);
        fireEvent.keyDown(cancel, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(exit);
    });
});
