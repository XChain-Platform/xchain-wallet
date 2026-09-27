// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.5.2 restore, on-demand half: "Check chain for backed-up contacts".
// The automatic restore only ever runs once, silently, inside a from-seed
// import; this button is the only way an existing wallet can re-pull that
// same payload later, so it earns its own coverage of the wired-up
// success and not-found paths (the request/apply plumbing itself is
// `restoreLabelSyncAfterImport` + `applyLabelSyncPayload`'s own unit
// tests under packages/core).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

const CHAIN_ID = 'dogecoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'D9restorelabelsaddress0000000000000',
    source: 'hd',
};

afterEach(() => cleanup());

function mount(restoreLabelsRequest) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [ADDRESS] })),
        restoreLabelsRequest,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />
        </MessagingProvider>,
    );
    return messaging;
}

/** Opens the restore form, waits for the chain picker, types the password. */
async function openRestoreForm() {
    fireEvent.click(screen.getByRole('button', { name: 'Check…' }));
    await screen.findByLabelText('Restore chain');
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'secret' } });
}

describe('BackupSection: check chain for backed-up contacts', () => {
    it('calls the restore path with the selected chain and reports what it merged', async () => {
        const restoreLabelsRequest = vi.fn(async () => ({
            restored: true,
            skipped: null,
            chainId: CHAIN_ID,
            updatedAt: '2026-01-01T00:00:00.000Z',
            searchedChainIds: [CHAIN_ID],
            errors: [],
            addressesUpdated: 3,
            addressesSkipped: 0,
            addressesMissing: 0,
            contactsAdded: 1,
            contactsUpdated: 1,
            contactsSkipped: 0,
        }));
        const messaging = mount(restoreLabelsRequest);

        await openRestoreForm();
        fireEvent.click(screen.getByRole('button', { name: 'Check' }));

        await waitFor(() => expect(messaging.restoreLabelsRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            password: 'secret',
            chainId: CHAIN_ID,
        }));

        // 1 contactsAdded + 1 contactsUpdated = 2 contacts; 3 addressesUpdated = 3 labels.
        expect(await screen.findByText('Restored 2 contacts and 3 labels.')).toBeTruthy();
    });

    it('reports no backed-up labels found when nothing authenticates on the chosen chain', async () => {
        const restoreLabelsRequest = vi.fn(async () => ({
            restored: false,
            skipped: null,
            chainId: null,
            updatedAt: null,
            searchedChainIds: [CHAIN_ID],
            errors: [],
            addressesUpdated: 0,
            addressesSkipped: 0,
            addressesMissing: 0,
            contactsAdded: 0,
            contactsUpdated: 0,
            contactsSkipped: 0,
        }));
        mount(restoreLabelsRequest);

        await openRestoreForm();
        fireEvent.click(screen.getByRole('button', { name: 'Check' }));

        expect(await screen.findByText(`No backed-up labels found on ${CHAIN_ID}.`)).toBeTruthy();
    });

    it('surfaces a thrown error (e.g. a wrong password) without losing the typed password field', async () => {
        const restoreLabelsRequest = vi.fn(async () => { throw new Error('Invalid password'); });
        mount(restoreLabelsRequest);

        await openRestoreForm();
        fireEvent.click(screen.getByRole('button', { name: 'Check' }));

        expect(await screen.findByText('Invalid password')).toBeTruthy();
    });
});
