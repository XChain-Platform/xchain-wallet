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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

const CHAIN_ID = 'dogecoin-testnet';
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
    // The standard Network field (operator ruling 2026-11-13).
    await screen.findByRole('button', { name: /^Network: / });
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'secret' } });
}

/** The rows the Network field's full-screen list offers, closed again after reading. */
function networkRowNames() {
    fireEvent.click(screen.getByRole('button', { name: /^Network: / }));
    const list = screen.getByRole('dialog', { name: 'Network' });
    const names = within(list).getAllByRole('button', { name: /^Select / })
        .map((row) => row.getAttribute('aria-label'));
    fireEvent.click(within(list).getByRole('button', { name: /^Back/ }));
    return names;
}

describe('BackupSection: check chain for backed-up contacts', () => {
    it('calls the restore path with the selected network and reports what it merged', async () => {
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
        expect(networkRowNames().some((name) => name.startsWith('Select Dogecoin'))).toBe(true);
        expect(screen.queryByText(/testnet/i)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        await waitFor(() => expect(messaging.restoreLabelsRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            password: 'secret',
            chainId: CHAIN_ID,
        }));

        // 1 contactsAdded + 1 contactsUpdated = 2 contacts; 3 addressesUpdated = 3 labels.
        expect(await screen.findByText('Restored 2 contacts and 3 labels.')).toBeTruthy();
    });

    it('reports no backed-up labels found when nothing authenticates on the chosen network', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        expect(await screen.findByText('No backed-up labels found on Dogecoin.')).toBeTruthy();
    });

    it('surfaces a thrown error (e.g. a wrong password) without losing the typed password field', async () => {
        const restoreLabelsRequest = vi.fn(async () => { throw new Error('Invalid password'); });
        mount(restoreLabelsRequest);

        await openRestoreForm();
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        expect(await screen.findByText('Invalid password')).toBeTruthy();
    });

    it('says the password is wrong when the seed decrypt fails its tag check', async () => {
        const restoreLabelsRequest = vi.fn(async () => {
            throw Object.assign(new Error('aes/gcm: invalid ghash tag'), { name: 'AeadAuthError' });
        });
        mount(restoreLabelsRequest);

        await openRestoreForm();
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        expect(await screen.findByText('Incorrect password.')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/aes\/gcm|ghash/);
    });
});

// Operator preference 2026-11-14: once unlocked, no password prompt where the
// wallet can avoid it. While the session pool holds the wallet's signer
// (wallet.signerReady), the host opens the seed with its master key.
describe('BackupSection: check and publish with the unlocked session', () => {
    function mountReady(extra) {
        const messaging = {
            getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [ADDRESS] })),
            signerReady: vi.fn(async () => ({ ready: true })),
            ...extra,
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />
            </MessagingProvider>,
        );
        return messaging;
    }

    it('checks the network without a password field while the signer is pooled', async () => {
        const restoreLabelsRequest = vi.fn(async () => ({ restored: false, skipped: null, chainId: null, searchedChainIds: [CHAIN_ID], errors: [] }));
        const messaging = mountReady({ restoreLabelsRequest });
        await waitFor(() => expect(messaging.signerReady).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Check…' }));
        await screen.findByRole('button', { name: /^Network: / });
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        await waitFor(() => expect(restoreLabelsRequest).toHaveBeenCalledOnce());
        expect(restoreLabelsRequest.mock.calls[0][0]).toEqual({ walletId: 'wallet-1', password: undefined, chainId: CHAIN_ID });
    });

    it('asks for the password in place when the pool emptied after the page read it', async () => {
        const restoreLabelsRequest = vi.fn()
            .mockRejectedValueOnce(new Error('restoreLabelSyncAfterImport: password is required'))
            .mockResolvedValue({ restored: false, skipped: null, chainId: null, searchedChainIds: [CHAIN_ID], errors: [] });
        const messaging = mountReady({ restoreLabelsRequest });
        await waitFor(() => expect(messaging.signerReady).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: 'Check…' }));
        await screen.findByRole('button', { name: /^Network: / });
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));

        expect(await screen.findByText('Enter your wallet password to check for backed-up contacts.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check for Contacts' }));
        await waitFor(() => expect(restoreLabelsRequest).toHaveBeenCalledTimes(2));
        expect(restoreLabelsRequest.mock.calls[1][0].password).toBe('secret');
    });

    it('prepares a label publish without a password field while the signer is pooled', async () => {
        const prepareLabelsRequest = vi.fn(async () => { throw new Error('stop after prepare'); });
        const messaging = mountReady({ prepareLabelsRequest, publishLabelsRequest: vi.fn() });
        await waitFor(() => expect(messaging.signerReady).toHaveBeenCalled());

        fireEvent.click(screen.getByRole('button', { name: /^Publish Now/ }));
        await screen.findByRole('button', { name: /^Network: / });
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Publish Labels' }));

        await waitFor(() => expect(prepareLabelsRequest).toHaveBeenCalledOnce());
        expect(prepareLabelsRequest.mock.calls[0][0]).toEqual({ walletId: 'wallet-1', password: undefined, chainId: CHAIN_ID });
    });
});
