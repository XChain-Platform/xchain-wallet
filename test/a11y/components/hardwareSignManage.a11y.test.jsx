// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Axe over the hardware sign page (running and failed), a hardware wallet's
// Wallet Details on each tab, a hardware account's Account Details Addresses
// tab with its Add network rows, and the Unlink page.

import { afterEach, describe, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { HardwareSignPage } from '../../../packages/core/src/shared/components/HardwareSignPage.jsx';
import { UnlinkHardwareWallet } from '../../../packages/core/src/shared/components/UnlinkHardwareWallet.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { AccountDetails } from '../../../packages/core/src/shared/routes/AccountDetails.jsx';
import { begin, end, fail, step } from '../../../packages/core/src/signers/hardwareSession.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const HW = { id: 'hw-1', name: 'My Trezor', format: 'hardware', origin: 'connected-hardware', importedKeys: [], passphraseEnabled: false };
const SIGNER = { id: 'sig-1', walletId: HW.id, vendor: 'trezor', model: 'Safe 3' };
const messaging = {
    getSettings: () => Promise.resolve({ walletMode: 'full' }),
    listAccounts: () => Promise.resolve([]),
    listWallets: () => Promise.resolve([HW]),
    listSigners: () => Promise.resolve([SIGNER]),
    getSignerStatus: () => Promise.resolve({ status: 'idle', detail: 'not connected' }),
    getAddressesByChain: () => Promise.resolve({
        'bitcoin-mainnet': [{ address: 'bc1qaaa', derivationPath: "m/84'/0'/0'/0/0" }],
    }),
};

afterEach(cleanup);

describe('hardware wallet pages accessibility', () => {
    it('has no serious violations on the sign page, running and after a failure', async () => {
        const { container } = render(<HardwareSignPage />);
        let id;
        act(() => { id = begin({ signerId: 's', vendor: 'trezor', model: 'Safe 3', op: 'signPsbt' }); step(id, 'connected'); });
        await expectNoSeriousAxeViolations(container);
        act(() => fail(id, { kind: 'unplugged' }));
        await expectNoSeriousAxeViolations(container);
        act(() => end(id));
    });

    it('has no serious violations on each tab of a hardware wallet\'s details', async () => {
        let view;
        await act(async () => {
            view = render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <WalletDetails walletId={HW.id} onBack={() => {}} onRename={() => {}} />
                </MessagingProvider>,
            );
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        await expectNoSeriousAxeViolations(view.container);
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        await expectNoSeriousAxeViolations(view.container);
    });

    // Add network lives on the shared Account Details, Addresses tab (G131).
    it('has no serious violations on a hardware account\'s Addresses tab and its Add network rows, idle and waiting for a Ledger app', async () => {
        const ledger = { id: 'sig-l', walletId: HW.id, vendor: 'ledger', model: 'nanoX' };
        const ledgerMessaging = {
            ...messaging,
            listAccounts: () => Promise.resolve([{ id: 'a1', walletId: HW.id, index: 0 }]),
            listSigners: () => Promise.resolve([ledger]),
            getAddressesByChain: () => Promise.resolve({
                'bitcoin-mainnet': [{ accountId: 'a1', address: 'bc1qaaa', derivationPath: "m/84'/0'/0'/0/0" }],
            }),
            activateChainRequest: () => Promise.resolve({ addresses: [], hardwareSkipped: 'wrong-app' }),
        };
        let view;
        await act(async () => {
            view = render(
                <MessagingProvider shell="web" messaging={ledgerMessaging}>
                    <AccountDetails walletId={HW.id} accountId="a1" activeAccountId="a1" onBack={() => {}} onRename={() => {}} />
                </MessagingProvider>,
            );
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('tab', { name: /Addresses/ }));
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        await expectNoSeriousAxeViolations(view.container);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^Add Litecoin/ }));
            for (let i = 0; i < 12; i += 1) await Promise.resolve();
        });
        screen.getByRole('button', { name: /^Add Litecoin.*Open the Litecoin app/ });
        await expectNoSeriousAxeViolations(view.container);
    });

    it('has no serious violations on the Unlink page', async () => {
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <UnlinkHardwareWallet wallet={HW} signer={SIGNER} accountCount={3} onBack={() => {}} />
            </MessagingProvider>,
        );
        await expectNoSeriousAxeViolations(container);
    });
});
