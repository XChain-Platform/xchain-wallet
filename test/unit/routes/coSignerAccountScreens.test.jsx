// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { CoSignerProvision } from '../../../packages/core/src/shared/routes/CoSignerProvision.jsx';

const DAEMON_KEY = `02${'a'.repeat(64)}`;

function mount(child, messaging) {
    return render(
        <MessagingProvider
            shell="extension"
            messaging={{ getSettings: () => Promise.resolve({}), ...messaging }}
        >
            {child}
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('co-signer account screens', () => {
    it('confirms before disabling an active account', async () => {
        const account = {
            id: 'account-1',
            name: 'Build agent',
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'bcrt1paccount',
            enabled: true,
            policy: { allowedActions: ['SEND'] },
            allowedOutputs: [],
            window: null,
        };
        const updateCoSignerAccount = vi.fn().mockResolvedValue({ ...account, enabled: false });
        mount(
            <CoSignerAccountDetail accountId={account.id} onBack={() => {}} />,
            {
                getCoSignerAccount: () => Promise.resolve(account),
                updateCoSignerAccount,
            },
        );

        await screen.findByText('Build agent');
        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));

        const dialog = screen.getByRole('dialog', { name: 'Disable this agent account?' });
        expect(within(dialog).getByText(/revokes the agent's signing access/i)).toBeTruthy();
        expect(updateCoSignerAccount).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
        await waitFor(() => expect(updateCoSignerAccount).toHaveBeenCalledWith({
            id: account.id,
            patch: { enabled: false },
        }));
    });

    it('offers provisioning from the empty account state', async () => {
        const onProvision = vi.fn();
        mount(
            <CoSignerAccountList
                walletId="wallet-1"
                onBack={() => {}}
                onProvision={onProvision}
                onOpen={() => {}}
            />,
            { listCoSignerAccounts: () => Promise.resolve([]) },
        );

        expect(await screen.findByText('No agent accounts yet')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'New agent account' }));
        expect(onProvision).toHaveBeenCalledTimes(1);
    });

    it('blocks an uncompressed agent key during provisioning', async () => {
        mount(
            <CoSignerProvision walletId="wallet-1" onBack={() => {}} />,
            {
                getAddressesByChain: () => Promise.resolve({
                    'bitcoin-regtest': [{
                        id: 'address-1',
                        address: 'bcrt1qdaemon',
                        publicKey: DAEMON_KEY,
                        derivationPath: "m/86'/1'/0'/0/0",
                    }],
                }),
                provisionCoSignerAccount: vi.fn(),
            },
        );

        const addressPicker = await screen.findByLabelText("This wallet's key");
        fireEvent.change(addressPicker, { target: { value: 'address-1' } });
        fireEvent.change(screen.getByLabelText('Agent public key (hex, 33-byte compressed)'), {
            target: { value: `04${'b'.repeat(64)}` },
        });

        expect(await screen.findByText(/starting with 02 or 03/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Create agent account' }).disabled).toBe(true);
    });
});
