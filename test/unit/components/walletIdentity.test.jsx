// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { AppHeader } from '../../../packages/core/src/shared/components/AppHeader.jsx';
import { MessageConfirmScreen } from '../../../packages/core/src/shared/components/MessageConfirmScreen.jsx';
import { walletIdentityTone } from '../../../packages/core/src/shared/components/WalletIdentity.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { clearActiveWallet, writeActiveWallet } from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

afterEach(() => {
    cleanup();
    clearActiveWallet();
});

const wallets = [
    { id: 'wallet-main', name: 'Main Wallet', format: 'bip39' },
    { id: 'wallet-cold', name: 'Cold Reserve', format: 'bip39' },
];

function readyConfirm() {
    return {
        phase: 'ready',
        composed: null,
        report: null,
        acknowledged: new Set(),
        acknowledge: () => {},
        canApprove: true,
        approve: () => {},
        reject: () => {},
        error: null,
        source: null,
    };
}

describe('wallet identity surfaces', () => {
    it('keeps the same wallet tone and name in the header and switcher', async () => {
        const header = render(<AppHeader activeWallet={wallets[1]} />);
        const headerIdentity = screen.getByTestId('wallet-identity');
        expect(headerIdentity).toHaveTextContent('CR');
        expect(headerIdentity).toHaveTextContent('Cold Reserve');
        expect(headerIdentity).toHaveAttribute('data-wallet-tone', String(walletIdentityTone('wallet-cold')));
        header.unmount();

        render(
            <MessagingProvider shell="popup" messaging={{ listWallets: async () => wallets }}>
                <WalletPicker
                    activeWalletId="wallet-cold"
                    onSwitch={() => {}}
                    onAddWallet={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        const activeRow = await screen.findByRole('button', { name: /Cold Reserve/ });
        const pickerIdentity = within(activeRow).getByTestId('wallet-identity');
        expect(pickerIdentity).toHaveAttribute('data-wallet-tone', headerIdentity.getAttribute('data-wallet-tone'));
        expect(activeRow).toHaveAttribute('aria-current', 'true');
    });

    it('names the signing wallet even when a confirmation has no source address', async () => {
        const messaging = { listWallets: async () => wallets };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <ActionConfirmScreen
                    confirmAction={readyConfirm()}
                    walletId="wallet-cold"
                    chainLabel="Bitcoin"
                    signerReady
                    password=""
                    onPasswordChange={() => {}}
                />
            </MessagingContext.Provider>,
        );

        await waitFor(() => {
            const identity = screen.getByTestId('wallet-identity');
            expect(identity).toHaveTextContent('Signing with');
            expect(identity).toHaveTextContent('Cold Reserve');
            expect(identity).toHaveAttribute('data-wallet-tone', String(walletIdentityTone('wallet-cold')));
        });
    });

    it('resolves the active wallet when a confirm adapter does not supply identity', async () => {
        writeActiveWallet('wallet-main');
        const messaging = { listWallets: async () => wallets };
        render(
            <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
                <MessageConfirmScreen
                    confirmAction={readyConfirm()}
                    message="Authorize this session"
                    chainLabel="Bitcoin"
                    signingAddress="bc1qsigningaddress"
                    signerReady
                    password=""
                    onPasswordChange={() => {}}
                />
            </MessagingContext.Provider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('wallet-identity')).toHaveTextContent('Main Wallet');
        });
    });
});
