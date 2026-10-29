// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Add account reached from the account picker, when the signer list read
// fails on its way to the wallet service. The inline signer note says the
// wallet service is out of reach and that the software signer stays in use,
// instead of a generic failure line or the raw transport text, and submitting
// still creates the account once with the software signer.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddAccountForm } from '../../../packages/core/src/shared/routes/AddAccountForm.jsx';
import { t } from '../../../packages/core/src/i18n/index.js';
import '../../../packages/core/src/i18n/locales/en/signerSelect.js';

afterEach(cleanup);

const GENERIC = 'Failed to load signers.';

const FAULTS = [
    ['a fetch failure', () => new TypeError('Failed to fetch')],
    ['a network failure', () => new Error('NetworkError when attempting to fetch resource.')],
    ['a request timeout', () => new Error('Request timed out')],
    ['an aborted timeout signal', () => Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })],
    ['a closed message port', () => new Error('The message port closed before a response was received.')],
    ['a missing receiving end', () => new Error('Could not establish connection. Receiving end does not exist.')],
];

function mount(fault) {
    const created = { account: { id: 'acct-2', name: 'Savings' } };
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listAccounts: vi.fn().mockResolvedValue([{ id: 'acct-1', name: 'Account 1', index: 0 }]),
        listSigners: vi.fn().mockRejectedValue(fault),
        createAccount: vi.fn().mockResolvedValue(created),
    };
    const onCreated = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddAccountForm walletId="wallet-1" onBack={() => {}} onCreated={onCreated} />
        </MessagingProvider>,
    );
    return { messaging, onCreated, created };
}

describe('AddAccountForm network faults', () => {
    it.each(FAULTS)('creates the account once when the list read fails with %s', async (_label, makeFault) => {
        const fault = makeFault();
        const { messaging, onCreated, created } = mount(fault);

        expect(await screen.findByText(t('signerSelect.loadUnreachable'))).toBeTruthy();
        expect(screen.queryByText(GENERIC)).toBeNull();
        expect(document.body.textContent).not.toContain(fault.message);
        expect(messaging.listSigners).toHaveBeenCalledWith('wallet-1');

        await waitFor(() => expect(screen.getByLabelText('Account name')).toHaveValue('Account 2'));
        fireEvent.change(screen.getByLabelText('Account name'), { target: { value: 'Savings' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add account' }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
        expect(onCreated).toHaveBeenCalledWith(created.account);
        expect(messaging.createAccount).toHaveBeenCalledTimes(1);
        expect(messaging.createAccount).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            name: 'Savings',
            signerId: undefined,
        });
    });
});
