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
        const filter = screen.getByRole('button', { name: 'Filter coins and tokens' });
        const bitcoin = await screen.findByRole('button', { name: /^Select Bitcoin\b/ });
        const token = screen.getByRole('button', { name: /^Select Keyboard Token\b/ });

        // The search, network and asset kind sit behind the title bar's filter
        // button. Balance rows are one roving tab stop, and the picker offers
        // no per-row pin button.
        expect(screen.queryByRole('searchbox', { name: 'Search coins or tokens' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Pin / })).toBeNull();
        expect(tabStops(view.container)).toEqual([back, filter, bitcoin]);
        expect(token).toHaveAttribute('tabindex', '-1');

        pressEnter(back);
        expect(onBack).toHaveBeenCalledOnce();

        pressEnter(filter);
        const search = screen.getByRole('searchbox', { name: 'Search coins or tokens' });
        await waitFor(() => expect(document.activeElement).toBe(search));
        const network = screen.getByRole('button', { name: /Filter by network/ });
        const kind = screen.getByRole('button', { name: /Coins and tokens/ });
        expect(tabStops(view.container)).toEqual([back, filter, search, network, kind, bitcoin]);

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

        // The asset kind choice is a listbox opened from the keyboard; Enter
        // on Tokens leaves only the token row.
        kind.focus();
        fireEvent.keyDown(kind, { key: 'ArrowDown' });
        const tokensOption = await screen.findByRole('option', { name: /^Tokens/ });
        tokensOption.focus();
        fireEvent.keyDown(tokensOption, { key: 'Enter' });
        await waitFor(() => expect(screen.queryByRole('button', { name: /^Select Bitcoin\b/ })).toBeNull());

        pressEnter(screen.getByRole('button', { name: /^Select Keyboard Token\b/ }));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
            chainId: 'bitcoin-mainnet',
            tick: 'KEYS',
        }));
    });

    it('operates VerifySignatureForm in field order and dismisses its network overlay with Escape', async () => {
        const onBack = vi.fn();
        const verifyMessageRequest = vi.fn().mockResolvedValue({ valid: true });
        const view = renderRoute(
            <VerifySignatureForm onBack={onBack} />,
            {
                getSettings: vi.fn().mockResolvedValue({}),
                verifyMessageRequest,
            },
        );

        // The picker fills once settings name the active network.
        const chain = await screen.findByRole('button', { name: /Network: Bitcoin/ });
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        const address = screen.getByLabelText('Address');
        const message = screen.getByLabelText('Message');
        const signature = screen.getByLabelText('Signature');
        const verify = screen.getByRole('button', { name: 'Verify Signature' });

        const tip = (name) => screen.getByRole('button', { name: `About ${name}` });
        // The one open section's header is a tab stop, and the Verify action
        // stays enabled (an empty form is refused on press), so it is one too.
        const section = screen.getByRole('button', { name: /^Signature/, expanded: true });
        expect(tabStops(view.container)).toEqual([
            back, section, tip('Network'), chain, tip('Address'), address, tip('Message'), message, tip('Signature'), signature, verify,
        ]);
        pressEnter(back);
        expect(onBack).toHaveBeenCalledOnce();

        chain.focus();
        pressEnter(chain);
        await screen.findByRole('dialog', { name: 'Network' });
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Network' })).not.toBeInTheDocument();
        expect(document.activeElement).toBe(chain);

        fireEvent.change(address, { target: { value: 'bc1qcounterparty' } });
        fireEvent.change(message, { target: { value: 'signed with a keyboard' } });
        fireEvent.change(signature, { target: { value: 'c2lnbmF0dXJl' } });
        expect(tabStops(view.container)).toEqual([
            back, section, tip('Network'), chain, tip('Address'), address, tip('Message'), message, tip('Signature'), signature, verify,
        ]);

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
        const savings = screen.getByRole('button', { name: /^Savings/ });
        const add = screen.getByRole('button', { name: 'Add Wallet' });

        // The plus sits on the title line, then each wallet row opens its page
        // (no separate details or Manage buttons).
        expect(screen.queryByRole('button', { name: 'Manage Wallet' })).toBeNull();
        expect(tabStops(view.container)).toEqual([back, add, primary, savings]);

        pressEnter(back);
        pressEnter(add);
        pressEnter(primary);
        pressEnter(savings);

        expect(onAddWallet).toHaveBeenCalledOnce();
        expect(onShowDetails.mock.calls).toEqual([['wallet-1'], ['wallet-2']]);
        expect(onSwitch).not.toHaveBeenCalled();
        expect(onBack).toHaveBeenCalledOnce();
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
        const rename = screen.getByRole('button', { name: 'Edit wallet' });
        const exit = screen.getByRole('button', { name: 'Exit demo & wipe' });
        const detailsTab = screen.getByRole('tab', { name: 'Details' });
        // The Actions tab is selected and is the tab stop; Details is one arrow away.
        const actionsTab = screen.getByRole('tab', { name: 'Actions' });
        expect(detailsTab).toBeTruthy();
        const stops = tabStops(view.container);
        expect(stops.filter((el) => el !== actionsTab)).toEqual(expect.arrayContaining([back, migrate, rename, exit]));
        expect(stops.indexOf(rename)).toBeLessThan(stops.indexOf(migrate));
        expect(stops.indexOf(migrate)).toBeLessThan(stops.indexOf(exit));

        pressEnter(back);
        pressEnter(migrate);
        pressEnter(rename);
        expect(onBack).toHaveBeenCalledOnce();
        expect(onMigrateToBip39).toHaveBeenCalledOnce();
        expect(onRename).toHaveBeenCalledWith(wallet);

        pressEnter(exit);
        const dialog = screen.getByRole('dialog', { name: 'Exit demo and delete its data?' });
        const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
        const confirm = within(dialog).getByRole('button', { name: 'Exit Demo & Wipe' });
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
