// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qplain0000000000000000000000000000000000';
const MULTISIG = 'bc1qmultisig00000000000000000000000000000000';

function messagingWith(overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1',
                address: ADDRESS,
                label: 'BTC Address #1',
                source: 'hd',
                addressType: 'p2wpkh',
                role: 'receive',
                accountId: ACCOUNT.id,
            }],
        }),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
}

function mount(messaging, props = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost>
                <AddressList
                    walletId={WALLET.id}
                    accountId={ACCOUNT.id}
                    onBack={() => {}}
                    {...props}
                />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('Address detail actions', () => {
    it('shows address fiat balances in the selected currency', async () => {
        mount(messagingWith({
            getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest', fiatCurrency: 'EUR' }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ADDRESS,
                    balances: {
                        native: { tick: 'BTC', quantity: '50000000', divisibility: 8, fiatRate: 80000 },
                        tokens: [],
                    },
                }],
            }),
        }));

        expect(await screen.findByText('€40,000.00 EUR')).toBeInTheDocument();
        expect(screen.queryByText('$40,000.00 USD')).toBeNull();
    });

    it('reports clipboard failure and does not switch the button to Copied', async () => {
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: vi.fn(() => false),
        });
        mount(messagingWith());
        fireEvent.click(await screen.findByRole('button', { name: `View address ${ADDRESS}` }));

        fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
    });

    it('hides record-only actions for a synthetic multisig receive address', async () => {
        const messaging = messagingWith({
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            listMultisigReceiveAddresses: vi.fn().mockResolvedValue([{
                multisigConfigId: 'multisig-1',
                address: MULTISIG,
                threshold: 2,
                cosignerCount: 3,
                scheme: 'p2wsh',
            }]),
        });
        mount(messaging, { onShowPrivateKey: vi.fn(), onSelect: vi.fn() });
        fireEvent.click(await screen.findByRole('button', { name: `View address ${MULTISIG}` }));

        expect(screen.queryByRole('button', { name: /^Use$/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Secret/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
        expect(screen.getByRole('button', { name: 'XChain' })).toBeInTheDocument();
    });
});
