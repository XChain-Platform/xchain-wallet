// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '../../helpers/userEvent.js';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { AddAccountForm } from '../../../packages/core/src/shared/routes/AddAccountForm.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => null,
}));

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    walletMode: 'full',
    fees: {
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
        'dogecoin-regtest': { strategy: 'normal' },
    },
};

function withMessaging(child, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {child}
        </MessagingProvider>,
    );
}

describe('A-D route keyboard flows', () => {
    it('reaches and activates every AccountPicker action in logical tab order', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onSwitch = vi.fn();
        const onAddAccount = vi.fn();
        const onRenameAccount = vi.fn();
        const accounts = [
            { id: 'a1', index: 0, name: 'Savings' },
            { id: 'a2', index: 1, name: 'Spending' },
        ];
        withMessaging(
            <AccountPicker
                walletId="w1"
                activeAccountId="a1"
                onBack={onBack}
                onSwitch={onSwitch}
                onAddAccount={onAddAccount}
                onRenameAccount={onRenameAccount}
            />,
            { listAccounts: vi.fn().mockResolvedValue(accounts) },
        );

        const savings = (await screen.findByText('Savings')).closest('button');
        const spending = screen.getByText('Spending').closest('button');
        const stops = [
            screen.getByRole('button', { name: 'Back to previous screen' }),
            savings,
            screen.getByRole('button', { name: 'Rename Savings' }),
            spending,
            screen.getByRole('button', { name: 'Rename Spending' }),
            screen.getByRole('button', { name: 'Add account' }),
            screen.getByRole('button', { name: 'Manage account' }),
        ];

        for (const stop of stops) {
            await user.tab();
            expect(stop).toHaveFocus();
            await user.keyboard('{Enter}');
        }

        expect(onBack).toHaveBeenCalledTimes(3);
        expect(onSwitch).toHaveBeenCalledWith('a2');
        expect(onRenameAccount).toHaveBeenNthCalledWith(1, accounts[0]);
        expect(onRenameAccount).toHaveBeenNthCalledWith(2, accounts[1]);
        expect(onRenameAccount).toHaveBeenNthCalledWith(3, accounts[0]);
        expect(onAddAccount).toHaveBeenCalledOnce();
    });

    it('reaches enabled and explained-disabled ActionsMenu entries by keyboard', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const firstAction = vi.fn();
        const unavailableAction = vi.fn();
        const secondAction = vi.fn();
        withMessaging(
            <ActionsMenu
                onBack={onBack}
                entries={[
                    { id: 'first', label: 'First action', onSelect: firstAction },
                    {
                        id: 'unavailable',
                        label: 'Unavailable action',
                        disabled: true,
                        disabledReason: 'Connect a signer.',
                        onSelect: unavailableAction,
                    },
                    { id: 'second', label: 'Second action', onSelect: secondAction },
                ]}
            />,
            { getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS) },
        );

        const stops = [
            screen.getByRole('button', { name: 'Back to home' }),
            screen.getByRole('button', { name: 'First action' }),
            screen.getByRole('button', { name: /Unavailable action/ }),
            screen.getByRole('button', { name: 'Second action' }),
        ];
        for (const stop of stops) {
            await user.tab();
            expect(stop).toHaveFocus();
            await user.keyboard('{Enter}');
        }

        expect(onBack).toHaveBeenCalledOnce();
        expect(firstAction).toHaveBeenCalledOnce();
        expect(unavailableAction).not.toHaveBeenCalled();
        expect(secondAction).toHaveBeenCalledOnce();
    });

    it('keeps AddAccountForm navigation and submission keyboard-only', async () => {
        const user = userEvent.setup();
        const onBack = vi.fn();
        const onCreated = vi.fn();
        const account = { id: 'a2', index: 1, name: 'Trading' };
        const messaging = {
            listAccounts: vi.fn().mockResolvedValue([]),
            createAccount: vi.fn().mockResolvedValue({ account }),
        };
        withMessaging(
            <AddAccountForm walletId="w1" onBack={onBack} onCreated={onCreated} />,
            messaging,
        );

        const name = screen.getByLabelText('Account name');
        await waitFor(() => expect(name).toHaveValue('Account 1'));
        await waitFor(() => expect(name).toHaveFocus());

        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Back to previous screen' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onBack).toHaveBeenCalledOnce();

        await user.tab();
        expect(name).toHaveFocus();
        await user.clear(name);
        await user.type(name, 'Trading');
        await user.tab();
        expect(screen.getByRole('button', { name: 'Add account' })).toHaveFocus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(account));
        expect(messaging.createAccount).toHaveBeenCalledWith({
            walletId: 'w1',
            name: 'Trading',
            signerId: undefined,
        });
    });

    it('operates AddAddressModal fields with arrows and closes its picker with Escape', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const onGenerated = vi.fn();
        const generateDispenserAddress = vi.fn().mockResolvedValue({ address: 'rltc1qexample' });
        withMessaging(
            <AddAddressModal
                walletId="w1"
                accountId="a1"
                chainIds={[]}
                onClose={onClose}
                onGenerated={onGenerated}
            />,
            {
                getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
                listWallets: vi.fn().mockResolvedValue([{ id: 'w1', format: 'bip39' }]),
                generateReceiveAddress: vi.fn(),
                generateDispenserAddress,
            },
        );

        const coin = await screen.findByRole('button', { name: /^Coin: Bitcoin/ });
        await user.tab();
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        expect(back).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(onClose).toHaveBeenCalledOnce();

        await user.tab();
        expect(coin).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('listbox', { name: 'Coin' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox', { name: 'Coin' })).toBeNull();
        expect(coin).toHaveFocus();

        await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
        expect(coin).toHaveAccessibleName(/^Coin: Litecoin/);

        await user.tab();
        const type = screen.getByLabelText('Type');
        expect(type).toHaveFocus();
        await user.keyboard('{ArrowDown}');

        await user.tab();
        const purpose = screen.getByLabelText('Purpose');
        expect(purpose).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(purpose).toHaveValue('dispenser');

        await user.tab();
        const count = screen.getByLabelText('Number of addresses');
        expect(count).toHaveFocus();
        await user.clear(count);
        await user.type(count, '2');

        await user.tab();
        expect(screen.getByRole('button', { name: 'Generate 2' })).toHaveFocus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(generateDispenserAddress).toHaveBeenCalledTimes(2));
        expect(generateDispenserAddress.mock.calls[0][0]).toMatchObject({
            walletId: 'w1',
            accountId: 'a1',
            chainId: 'litecoin-regtest',
        });
        expect(onGenerated).toHaveBeenCalledWith(2);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
