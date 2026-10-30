// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An import window left open while another window or tab makes the first
// wallet gets the vault's refusal on submit. The typed secrets leave the
// screen, the window offers that wallet's unlock, and Back goes there too.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WIF = 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ';
const PASSWORD = 'correct-horse-battery';
const EXISTS = 'A wallet already exists. Unlock or reset first.';
const NOTICE = /This device already has a wallet, so nothing was imported here\. Unlock that wallet to continue\./;

const BACKUP_FIELD_IDS = [
    'xc-backup-content',
    'import-backup-file-password',
    'import-backup-wallet-password',
    'import-backup-device-password',
];

afterEach(cleanup);

const refusals = [
    ['a named refusal', () => Object.assign(new Error(EXISTS), { name: 'WalletExistsError' })],
    ['a refusal passed as its message', () => new Error(EXISTS)],
];

function mount(messaging, { mode = 'fresh' } = {}) {
    const onBack = vi.fn();
    const onImported = vi.fn();
    render(
        <MessagingProvider shell="popup" messaging={messaging}>
            <ImportWallet onBack={onBack} onImported={onImported} mode={mode} />
        </MessagingProvider>,
    );
    return { onBack, onImported };
}

function fillPasswords() {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: PASSWORD } });
}

async function submit(name) {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name }));
    });
}

function expectUnlockAndBack({ onBack, onImported }) {
    expect(document.body).not.toHaveTextContent(EXISTS);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onImported).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));
    expect(onImported).toHaveBeenCalledTimes(2);
    expect(onBack).not.toHaveBeenCalled();
}

describe('ImportWallet in a window another window out-created', () => {
    it.each(refusals)('clears the phrase lane and offers Unlock after %s', async (_label, refusal) => {
        const importMnemonic = vi.fn(async () => { throw refusal(); });
        const handlers = mount({ importMnemonic });
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fillPasswords();
        await submit('Import');

        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
        expect(screen.getByLabelText('Recovery phrase')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expect(screen.getByLabelText(/^Confirm/)).toHaveValue('');
        expectUnlockAndBack(handlers);
    });

    it('clears the private key lane and offers Unlock after the refusal', async () => {
        const importMnemonic = vi.fn(async () => { throw refusals[0][1](); });
        const handlers = mount({ importMnemonic });
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));
        fireEvent.change(screen.getByLabelText('WIF private key'), { target: { value: WIF } });
        fireEvent.click(screen.getByLabelText("I understand this key isn't recoverable from a recovery phrase."));
        fillPasswords();
        await submit('Import');

        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
        expect(screen.getByLabelText('WIF private key')).toHaveValue('');
        expect(screen.getByLabelText('Password')).toHaveValue('');
        expectUnlockAndBack(handlers);
    });

    it('clears the backup lane and offers Unlock after the refusal', async () => {
        const importBackupFresh = vi.fn(async () => { throw refusals[1][1](); });
        const handlers = mount({ importBackupFresh });
        fireEvent.click(screen.getByRole('tab', { name: /backup/i }));
        const backupFields = () => BACKUP_FIELD_IDS.map((id) => document.getElementById(id));
        for (const field of backupFields()) fireEvent.change(field, { target: { value: PASSWORD } });
        await submit('Restore');

        expect(importBackupFresh).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
        for (const field of backupFields()) expect(field).toHaveValue('');
        expectUnlockAndBack(handlers);
    });

    it('moves focus to the notice so a form scrolled to its Import button shows it', async () => {
        const importMnemonic = vi.fn(async () => { throw refusals[0][1](); });
        mount({ importMnemonic });
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fillPasswords();
        await submit('Import');

        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);
        expect(screen.getByRole('alert')).toHaveFocus();
    });

    it('keeps an ordinary import failure on the form with its secrets', async () => {
        const importMnemonic = vi.fn(async () => { throw new Error('Could not reach the vault.'); });
        const { onBack, onImported } = mount({ importMnemonic });
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fillPasswords();
        await submit('Import');

        expect(document.body).not.toHaveTextContent(NOTICE);
        expect(screen.queryByRole('button', { name: 'Unlock' })).toBeNull();
        expect(screen.getByLabelText('Recovery phrase')).toHaveValue(PHRASE);
        fireEvent.click(screen.getByRole('button', { name: 'Back to wallet setup' }));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onImported).not.toHaveBeenCalled();
    });
});
