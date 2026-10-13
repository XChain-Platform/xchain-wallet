// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The recovery screen never shows a user a stack-trace fragment.
//
// The flows this screen calls throw function-prefixed preconditions
// ("importMnemonic: mnemonic is required"), and `setError(err?.message || …)`
// only falls back when the message is EMPTY, so every non-empty dev string
// passed straight through onto the one screen where a user is recovering a
// wallet. `userFacingMessage` is the filter written for exactly this (its own
// header names these strings), and it is a FILTER, not a blanket replacer:
// copy that was written for a user still reaches the user.
//
// Driven through the rendered screen rather than asserted against the source,
// because the thing under test is what a person reads.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

afterEach(cleanup);

/** Render the recovery-phrase lane and drive it to a real submit. */
async function submitWith(importMnemonic, { name } = {}) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
    if (name) fireEvent.change(screen.getByLabelText('Wallet name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importMnemonic).toHaveBeenCalled());
}

describe('the import screen shows house copy, not flow-layer internals', () => {
    it('swaps a function-prefixed precondition for the screen fallback', async () => {
        const importMnemonic = vi.fn().mockRejectedValue(new Error('importMnemonic: mnemonic is required'));
        await submitWith(importMnemonic);

        await screen.findByText('Could not import the wallet.');
        expect(screen.queryByText(/importMnemonic:/)).toBeNull();
    });

    it('still shows a message the flow wrote for the user', async () => {
        const written = 'That recovery phrase belongs to a wallet you already imported.';
        const importMnemonic = vi.fn().mockRejectedValue(new Error(written));
        await submitWith(importMnemonic);

        await screen.findByText(written);
        expect(screen.queryByText('Could not import the wallet.')).toBeNull();
    });

    it('keeps the wallet name when a backend error is retried', async () => {
        const backendError = Object.assign(new Error('backend unavailable'), {
            code: 'BACKEND_UNAVAILABLE',
        });
        const importMnemonic = vi.fn()
            .mockRejectedValueOnce(backendError)
            .mockResolvedValueOnce({ walletId: 'wallet-1' });
        await submitWith(importMnemonic, { name: 'Travel Wallet' });

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not import the wallet.');
        expect(screen.queryByText('backend unavailable')).toBeNull();
        expect(screen.getByLabelText('Wallet name')).toHaveValue('Travel Wallet');
        expect(importMnemonic.mock.calls[0][0].name).toBe('Travel Wallet');

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledTimes(2));
        expect(importMnemonic.mock.calls[1][0].name).toBe('Travel Wallet');
    });
});

describe('onboarding persistence failures', () => {
    it('shows a plain create error and retries with the same wallet name', async () => {
        const writeError = Object.assign(new Error('vault transaction aborted'), {
            code: 'VAULT_WRITE_FAILED',
        });
        const importMnemonic = vi.fn()
            .mockRejectedValueOnce(writeError)
            .mockResolvedValueOnce({ walletId: 'wallet-1' });
        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <CreateWallet onBack={() => {}} onCreated={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(screen.getByLabelText('Wallet name'), {
            target: { value: 'Rainy Day' },
        });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reveal recovery phrase' }));
        const phraseWords = screen.getAllByRole('listitem').map((item) => (
            item.textContent.replace(/^\d+\.\s*/, '').trim()
        ));
        fireEvent.click(screen.getByRole('checkbox', { name: /saved my recovery phrase/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
        for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
            const position = Number(input.labels[0].textContent.replace('Word ', ''));
            fireEvent.change(input, { target: { value: phraseWords[position - 1] } });
        }
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create wallet. Try again.');
        expect(screen.queryByText('vault transaction aborted')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Create wallet' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledTimes(2));
        expect(importMnemonic.mock.calls[1][0].name).toBe('Rainy Day');
    });

    it('shows plain copy for a corrupt backup and retries with its pasted contents', async () => {
        const importBackupFresh = vi.fn()
            .mockRejectedValueOnce(new SyntaxError('Unexpected token } in JSON at position 41'))
            .mockResolvedValueOnce({ walletId: 'wallet-1' });
        render(
            <MessagingProvider shell="web" messaging={{ importBackupFresh }}>
                <ImportWallet
                    onBack={() => {}}
                    onImported={() => {}}
                    mode="fresh"
                    initialLane="backup"
                />
            </MessagingProvider>,
        );
        const backupContent = '{"encrypted":"backup-data"}';
        fireEvent.change(screen.getByLabelText('Backup file contents'), {
            target: { value: backupContent },
        });
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Password of the wallet in this backup'), {
            target: { value: PASSWORD },
        });
        fireEvent.change(screen.getByLabelText('Password for this device'), {
            target: { value: PASSWORD },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'That backup could not be restored. Check the backup file and try again.',
        );
        expect(screen.queryByText(/Unexpected token/)).toBeNull();
        expect(screen.getByLabelText('Backup file contents')).toHaveValue(backupContent);

        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(importBackupFresh).toHaveBeenCalledTimes(2));
        expect(importBackupFresh.mock.calls[1][0].fileContent).toBe(backupContent);
    });
});

// The passphrase is captured once and stored on the wallet record, while
// hardware signers collect their passphrase on the device.
describe('the BIP39 passphrase InfoTip on import', () => {
    it('briefly explains storage and hardware-wallet entry', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'BIP39 passphrase help' }));
        const tip = screen.getByRole('tooltip').textContent;
        expect(tip).toMatch(/stays behind your password here/i);
        expect(tip).toMatch(/hardware wallets request it on the device/i);
        expect(tip.match(/[.!?](?:\s|$)/g)).toHaveLength(2);
    });
});
