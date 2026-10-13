// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import { AddAddressModal } from '../../../packages/core/src/shared/routes/AddAddressModal.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const CHAIN = 'bitcoin-regtest';
const ACCOUNT = { id: 'account-1', index: 0, walletId: 'wallet-1' };
const FIRST = 'bcrt1qfirst000000000000000000000000000000000';
const SECOND = 'bcrt1qsecond00000000000000000000000000000000';
const SETTINGS = {
    activeNetwork: 'regtest',
    fees: { [CHAIN]: { strategy: 'normal' } },
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function addressMessaging(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', format: 'bip39' }]),
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [
                { id: 'address-1', address: FIRST, label: 'First', source: 'hd', role: 'receive', accountId: ACCOUNT.id },
                { id: 'address-2', address: SECOND, label: 'Second', source: 'hd', role: 'receive', accountId: ACCOUNT.id },
            ],
        }),
        setAddressLabel: vi.fn().mockResolvedValue({ ok: true }),
        ...overrides,
    };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('address management async guards', () => {
    it('keeps a completed label save attached to its original address', async () => {
        const save = deferred();
        const messaging = addressMessaging({ setAddressLabel: vi.fn(() => save.promise) });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ToastHost>
                    <AddressList walletId="wallet-1" accountId={ACCOUNT.id} onBack={() => {}} />
                </ToastHost>
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: `View address ${FIRST}` }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Address label' }), {
            target: { value: 'Renamed first' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        fireEvent.click(screen.getByRole('button', { name: `View address ${SECOND}` }));

        await act(async () => save.resolve({ ok: true }));

        expect(messaging.setAddressLabel).toHaveBeenCalledWith('address-1', 'Renamed first');
        expect(screen.getByRole('textbox', { name: 'Address label' })).toHaveValue('Second');
        expect(screen.getByText(SECOND)).toBeInTheDocument();
    });

    it('keeps row identity and multisig matching scoped to a chain', async () => {
        const duplicate = { id: 'shared-id', address: FIRST, label: 'Shared', source: 'hd', role: 'receive' };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <MessagingProvider shell="web" messaging={addressMessaging({
                getAddressesByChain: vi.fn().mockResolvedValue({
                    [CHAIN]: [duplicate],
                    'litecoin-regtest': [duplicate],
                }),
                listMultisigReceiveAddresses: vi.fn().mockResolvedValue([{
                    multisigConfigId: 'multisig-1',
                    address: FIRST,
                    threshold: 2,
                    cosignerCount: 3,
                    scheme: 'p2wsh-multisig',
                }]),
            })}>
                <ToastHost>
                    <AddressList walletId="wallet-1" accountId={ACCOUNT.id} onBack={() => {}} />
                </ToastHost>
            </MessagingProvider>,
        );

        expect(await screen.findAllByRole('button', { name: `View address ${FIRST}` })).toHaveLength(2);
        const badges = await screen.findAllByTestId('multisig-badge');
        expect(badges).toHaveLength(1);
        expect(badges[0].closest('button')).toHaveTextContent('Bitcoin');
        expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i);
    });

    it('starts only one batch when submit fires twice before React rerenders', async () => {
        const generation = deferred();
        const generateReceiveAddress = vi.fn(() => generation.promise);
        const onClose = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={{
                getSettings: vi.fn().mockResolvedValue(SETTINGS),
                generateReceiveAddress,
            }}>
                <AddAddressModal
                    walletId="wallet-1"
                    accountId={ACCOUNT.id}
                    chainIds={[]}
                    onClose={onClose}
                />
            </MessagingProvider>,
        );

        const button = await screen.findByRole('button', { name: 'Generate' });
        const form = button.closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(generateReceiveAddress).toHaveBeenCalledTimes(1);
        await act(async () => generation.resolve({ address: FIRST }));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    });

    it('observes rejected promises returned by account route actions', async () => {
        const switchResult = deferred();
        const catchSpy = vi.spyOn(switchResult.promise, 'catch');
        const onBack = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={{ listAccounts: vi.fn().mockResolvedValue([ACCOUNT]) }}>
                <AccountPicker
                    walletId="wallet-1"
                    activeAccountId={null}
                    onSwitch={() => switchResult.promise}
                    onAddAccount={() => {}}
                    onBack={onBack}
                />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: /Account 1/ }));
        switchResult.reject(new Error('switch failed'));
        await act(async () => Promise.resolve());

        expect(catchSpy).toHaveBeenCalledOnce();
        expect(onBack).toHaveBeenCalledOnce();
    });
});
