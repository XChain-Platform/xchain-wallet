// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsSection } from '../../../packages/core/src/shared/components/settings/ContactsSection.jsx';
import { RegtestRow } from '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx';

function mount(component, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {component}
        </MessagingProvider>,
    );
}

const settings = { walletMode: 'full', language: 'en', display: {} };

afterEach(() => cleanup());

describe('settings diagnostic disclosures', () => {
    it('lists every contact that an import skips with its rejection message', async () => {
        const saveContact = vi.fn(async ({ record }) => {
            if (record.name === 'Broken contact') throw new Error('entries must contain an address');
        });
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(settings),
            listContacts: vi.fn().mockResolvedValue([]),
            saveContact,
        };
        mount(<ContactsSection />, messaging);

        const file = {
            text: async () => JSON.stringify([
                { id: 'ok', name: 'Good contact' },
                { id: 'bad', name: 'Broken contact' },
            ]),
        };
        fireEvent.change(await screen.findByLabelText('Import contacts JSON'), {
            target: { files: [file] },
        });

        expect(await screen.findByText('Imported 1 contact; 1 skipped.')).toBeTruthy();
        const summary = screen.getByText('Skipped contacts (1)');
        fireEvent.click(summary);
        expect(screen.getByText('Broken contact')).toBeTruthy();
        expect(screen.getByText(/entries must contain an address/)).toBeTruthy();
    });

    it('lists each account left unchanged during network activation', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(settings),
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1' }]),
            listSigners: vi.fn().mockResolvedValue([]),
            activateChainRequest: vi.fn().mockResolvedValue({
                addresses: [{ accountId: 'account-2', address: {} }],
                skippedAccounts: 1,
                skippedAccountDetails: [{ accountId: 'account-1', name: 'Savings' }],
            }),
        };
        const descriptor = { id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' };
        mount(<RegtestRow descriptor={descriptor} isActive={false} disabled={false} />, messaging);

        fireEvent.click(await screen.findByRole('button', { name: 'Activate…' }));
        const password = await screen.findByLabelText('Bitcoin Regtest activation password');
        fireEvent.change(password, { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        expect(await screen.findByText('Activated. Derived 1 address.')).toBeTruthy();
        const summary = screen.getByText('Accounts not changed (1)');
        fireEvent.click(summary);
        expect(screen.getByText('Savings')).toBeTruthy();
        expect(screen.getByText(/Already has an address on Bitcoin Regtest/)).toBeTruthy();
        await waitFor(() => expect(messaging.activateChainRequest).toHaveBeenCalledOnce());
    });
});
