// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Add account on a Ledger answers the networks whose app was not open
// (`waitingChains`). The form keeps the new account and lists each waiting
// network with the connect step's line on a tappable row, which reads it into
// that account; Done (or Back) hands the account to the shell as created.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let messaging;

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging, shell: 'web' }),
    screenVariantFor: () => 'full',
}));

vi.mock('../../../packages/core/src/shared/routes/SignerSelectForm.jsx', () => ({
    SignerSelectForm: () => <p>Signer picker</p>,
}));

const { AddAccountForm } = await import('../../../packages/core/src/shared/routes/AddAccountForm.jsx');

const NEW_ACCOUNT = { id: 'a2', walletId: 'hw-1', index: 1, name: 'Account 2' };

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

async function flush() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

async function mount({ createResult, activate = vi.fn() }) {
    const onCreated = vi.fn();
    messaging = {
        listAccounts: vi.fn().mockResolvedValue([{ id: 'a1', index: 0, name: 'Account 1' }]),
        listWallets: vi.fn().mockResolvedValue([{ id: 'hw-1', format: 'hardware' }]),
        listSigners: vi.fn().mockResolvedValue([{ id: 'sig-l', walletId: 'hw-1', vendor: 'ledger' }]),
        createAccount: vi.fn().mockResolvedValue(createResult),
        activateChainRequest: activate,
    };
    await act(async () => {
        render(<AddAccountForm walletId="hw-1" onBack={() => {}} onCreated={onCreated} />);
        await flush();
    });
    await act(async () => {
        fireEvent.submit(screen.getByLabelText('Account name', { selector: 'input' }).closest('form'));
        await flush();
    });
    return { onCreated };
}

describe('Add account on a Ledger with networks waiting for their app', () => {
    it('keeps the host\'s waiting networks on screen as standard tappable rows', async () => {
        const { onCreated } = await mount({
            createResult: { account: NEW_ACCOUNT, addresses: [], waitingChains: ['bitcoin-mainnet', 'dogecoin-mainnet'] },
        });
        expect(onCreated).not.toHaveBeenCalled();
        const list = screen.getByRole('list', { name: 'Networks waiting for their app' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Open the Bitcoin app on your Ledger');
        expect(rows[1]).toHaveTextContent('Open the Dogecoin app on your Ledger');
        expect(within(rows[0]).getByRole('button', { name: /Bitcoin/ })).toBeInTheDocument();
        expect(within(rows[0]).queryByRole('button', { name: /Try Again/ })).toBeNull();
        expect(screen.getByText(/Account 2 is added/)).toBeInTheDocument();
    });

    it('Try again reads the network into the new account and drops its row; Done hands the account over', async () => {
        const activate = vi.fn(async ({ accountId }) => ({ chainId: 'dogecoin-mainnet', addresses: [{ accountId, address: {} }] }));
        const { onCreated } = await mount({
            createResult: { account: NEW_ACCOUNT, addresses: [], waitingChains: ['dogecoin-mainnet'] },
            activate,
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Dogecoin.*Open the Dogecoin app/ }));
            await flush();
        });
        expect(activate).toHaveBeenCalledWith({
            walletId: 'hw-1', chainId: 'dogecoin-mainnet', signerId: 'sig-l', accountId: NEW_ACCOUNT.id,
        });
        expect(screen.queryByRole('list', { name: 'Networks waiting for their app' })).toBeNull();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Done/ }));
            await flush();
        });
        expect(onCreated).toHaveBeenCalledWith(NEW_ACCOUNT);
    });

    it('a network still on another app keeps waiting', async () => {
        const activate = vi.fn(async () => ({ chainId: 'dogecoin-mainnet', addresses: [], hardwareSkipped: 'wrong-app' }));
        await mount({
            createResult: { account: NEW_ACCOUNT, addresses: [], waitingChains: ['dogecoin-mainnet'] },
            activate,
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Dogecoin.*Open the Dogecoin app/ }));
            await flush();
        });
        const [row] = within(screen.getByRole('list', { name: 'Networks waiting for their app' })).getAllByRole('listitem');
        expect(row).toHaveTextContent('Open the Dogecoin app on your Ledger');
    });

    it('with nothing waiting goes straight on, as before', async () => {
        const { onCreated } = await mount({ createResult: { account: NEW_ACCOUNT, addresses: [] } });
        expect(onCreated).toHaveBeenCalledWith(NEW_ACCOUNT);
        expect(screen.queryByRole('list', { name: 'Networks waiting for their app' })).toBeNull();
    });
});
