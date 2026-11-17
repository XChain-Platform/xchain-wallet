// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Import Wallet's Backup tab, as the operator picked it (restore-v2, 2026-11-14):
// a large drop area until a file is chosen, then a summary card of that file;
// one password field, tried to open the file and then the wallet inside; a
// second field only when the wallet inside needs a different password; and
// every refusal as one red sentence under the field it is about.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import {
    BackupSeedPasswordError,
    RestoreDevicePasswordError,
} from '../../../packages/core/src/flows/backupFile.js';
import {
    backupEnvelopeText,
    chooseBackupFile,
    chooseRefusedBackupFile,
    openBackupTab,
    typeInto,
} from '../../helpers/backupFileChoice.js';

afterEach(cleanup);

const RESTORED = { walletId: 'w-restored', walletName: 'Daily Driver' };

function renderTab({ mode = 'fresh', messaging = {} } = {}) {
    const full = {
        importBackupFresh: vi.fn(async () => RESTORED),
        importBackupRequest: vi.fn(async () => RESTORED),
        ...messaging,
    };
    render(
        <MessagingProvider shell="web" messaging={full}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode={mode} />
        </MessagingProvider>,
    );
    openBackupTab();
    return full;
}

function restore() {
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
}

describe('Backup tab: empty', () => {
    it('shows the drop area with a green Choose File button, one password field and Restore', () => {
        renderTab();
        const area = document.querySelector('[data-file-field="area"]');
        expect(area).not.toBeNull();
        expect(area).toHaveTextContent('Choose your backup file');
        expect(area).toHaveTextContent('or drop it here');
        const choose = screen.getByRole('button', { name: 'Choose File' });
        expect(area.contains(choose)).toBe(true);
        expect(choose.className).toMatch(/success/);

        const passwords = Array.from(document.querySelectorAll('input[type="password"]'));
        expect(passwords).toHaveLength(1);
        expect(screen.getByLabelText('Backup password')).toBe(passwords[0]);
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        const restoreButton = screen.getByRole('button', { name: 'Restore' });
        expect(restoreButton.className).toMatch(/success/);
        expect(restoreButton.disabled).toBe(false);
    });

    it('has no paste box, pointer scan, overwrite switch or three-password card', () => {
        renderTab();
        expect(screen.queryByRole('textbox', { name: /contents/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /pointer/i })).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByText(/three different passwords/i)).toBeNull();
        expect(screen.queryByText(/overwrite/i)).toBeNull();
    });

    it('opens the file dialog once from a click on the area or on its button', () => {
        renderTab();
        const input = screen.getByLabelText('Backup file');
        // A click on the area reaches the input as the label's activation,
        // and the button's as input.click(): both arrive as one click event.
        let clicks = 0;
        input.addEventListener('click', () => { clicks += 1; });
        fireEvent.click(screen.getByRole('button', { name: 'Choose File' }));
        expect(clicks).toBe(1);
        fireEvent.click(screen.getByText('Choose your backup file'));
        expect(clicks).toBe(2);
        // The area is a label for the input, not a control of its own.
        const area = document.querySelector('[data-file-field="area"] label');
        expect(area).toHaveAttribute('for', input.id);
        expect(area).not.toHaveAttribute('role');
    });

    it('names the missing file under the area and sends nothing', async () => {
        const messaging = renderTab();
        typeInto('Backup password', 'one-password');
        restore();
        // The notice at the top and the line under the area both carry it.
        expect((await screen.findAllByText('Choose a backup file.')).length).toBeGreaterThanOrEqual(2);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Choose File' }));
        expect(messaging.importBackupFresh).not.toHaveBeenCalled();
    });

    it('names the empty password under its field and sends nothing', async () => {
        const messaging = renderTab();
        await chooseBackupFile();
        restore();
        const field = screen.getByLabelText('Backup password');
        expect(field).toHaveAccessibleDescription(/Enter the backup password\./);
        expect(document.activeElement).toBe(field);
        expect(messaging.importBackupFresh).not.toHaveBeenCalled();
    });
});

describe('Backup tab: file chosen', () => {
    it('replaces the area with a summary card of the wallet, date, file name and size', async () => {
        renderTab();
        const file = await chooseBackupFile({ walletName: 'Daily Driver' });
        expect(document.querySelector('[data-file-field="area"]')).toBeNull();
        const card = screen.getByRole('region', { name: 'Chosen backup file' });
        expect(card).toHaveTextContent('DD');
        expect(card).toHaveTextContent('Daily Driver');
        expect(card).toHaveTextContent(/Backed up .*2026/);
        expect(card).toHaveTextContent(`daily-driver.xchain-wallet, ${Math.ceil(file.size / 102.4) / 10} KB`);
        expect(screen.getByRole('button', { name: 'Change File' })).toBeInTheDocument();
        expect(screen.getByLabelText('Backup password')).toBeInTheDocument();
    });

    it('falls back when the unauthenticated header carries no usable name or date', async () => {
        renderTab();
        const content = backupEnvelopeText({ walletName: '​ ', createdAt: 'not a date' });
        await chooseBackupFile({ content, name: 'odd.xchain-wallet' });
        const card = screen.getByRole('region', { name: 'Chosen backup file' });
        expect(card).toHaveTextContent('Wallet backup');
        expect(card).not.toHaveTextContent(/Backed up/);
    });

    it('Change File opens the dialog, and a new file replaces the card and resets the extra field', async () => {
        renderTab({
            messaging: { importBackupFresh: vi.fn(async () => { throw new BackupSeedPasswordError('seed'); }) },
        });
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        restore();
        expect(await screen.findByLabelText('Wallet password')).toBeInTheDocument();

        const input = screen.getByLabelText('Backup file');
        const click = vi.spyOn(input, 'click');
        fireEvent.click(screen.getByRole('button', { name: 'Change File' }));
        expect(click).toHaveBeenCalledTimes(1);

        await chooseBackupFile({ name: 'savings.xchain-wallet', walletName: 'Savings' });
        expect(screen.getByRole('region', { name: 'Chosen backup file' })).toHaveTextContent('Savings');
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
    });

    it('refuses a file that is not a backup where it was chosen', async () => {
        renderTab();
        const alert = await chooseRefusedBackupFile('just some notes');
        expect(alert).toHaveTextContent("That isn't a wallet backup file this app can read.");
        expect(document.querySelector('[data-file-field="area"]')).not.toBeNull();
    });

    it('tells a backup from a newer release to update the app, not that it is no backup', async () => {
        renderTab();
        const newer = JSON.stringify({ ...JSON.parse(backupEnvelopeText()), formatVersion: 9 });
        const alert = await chooseRefusedBackupFile(newer, 'new.xchain-wallet');
        expect(alert).toHaveTextContent('This backup was made by a newer version of the app.');
    });
});

describe('Backup tab: one password, tried in every role', () => {
    it('a fresh install restores with the one password opening the file and the wallet, and the wallet keeps it', async () => {
        const messaging = renderTab();
        await chooseBackupFile();
        typeInto('Backup password', 'one-password');
        restore();
        await waitFor(() => expect(messaging.importBackupFresh).toHaveBeenCalledTimes(1));
        expect(messaging.importBackupFresh).toHaveBeenCalledWith({
            password: 'one-password',
            backupPassword: 'one-password',
            walletPassword: 'one-password',
            fileContent: backupEnvelopeText(),
        });
        expect(messaging.importBackupRequest).not.toHaveBeenCalled();
    });

    it('an add keeps this device\'s records and tries the same password as the vault\'s', async () => {
        const messaging = renderTab({ mode: 'add' });
        await chooseBackupFile();
        typeInto('Backup password', 'one-password');
        restore();
        await waitFor(() => expect(messaging.importBackupRequest).toHaveBeenCalledTimes(1));
        expect(messaging.importBackupRequest).toHaveBeenCalledWith(expect.objectContaining({
            password: 'one-password',
            walletPassword: 'one-password',
            devicePassword: 'one-password',
            onConflict: 'preserve',
            mode: 'add',
        }));
    });
});

describe('Backup tab: wrong password', () => {
    it('shows one red sentence under the password field and keeps the card', async () => {
        renderTab({
            messaging: { importBackupFresh: vi.fn(async () => { throw new BackupPasswordError(); }) },
        });
        await chooseBackupFile();
        typeInto('Backup password', 'wrong-password');
        restore();
        const field = screen.getByLabelText('Backup password');
        await waitFor(() => expect(field).toHaveAccessibleDescription(/That password doesn't open this backup\./));
        // The notice at the top lists it and the field carries its own line.
        const alerts = screen.getAllByRole('alert');
        expect(alerts).toHaveLength(2);
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent("That password doesn't open this backup.");
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(field);
        expect(screen.getByRole('region', { name: 'Chosen backup file' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
    });

    it('classifies the bare message the extension boundary leaves the same way', async () => {
        renderTab({
            messaging: {
                importBackupFresh: vi.fn(async () => {
                    throw new Error(new BackupPasswordError().message);
                }),
            },
        });
        await chooseBackupFile();
        typeInto('Backup password', 'wrong-password');
        restore();
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent("That password doesn't open this backup.");
    });

    it('clears the sentence as soon as the field is typed in', async () => {
        renderTab({
            messaging: { importBackupFresh: vi.fn(async () => { throw new BackupPasswordError(); }) },
        });
        await chooseBackupFile();
        typeInto('Backup password', 'wrong-password');
        restore();
        await screen.findByRole('alert', { name: 'Form errors' });
        typeInto('Backup password', 'wrong-password2');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('Backup tab: the wallet inside needs its own password', () => {
    it('shows a Wallet password field in place with its reason, then restores under that password', async () => {
        const importBackupFresh = vi.fn()
            .mockRejectedValueOnce(new BackupSeedPasswordError('seed'))
            .mockResolvedValueOnce(RESTORED);
        renderTab({ messaging: { importBackupFresh } });
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        restore();

        const walletField = await screen.findByLabelText('Wallet password');
        expect(walletField).toHaveAccessibleDescription(/The file opened, but the wallet inside uses a different password\./);
        expect(screen.queryByRole('alert')).toBeNull();
        await waitFor(() => expect(document.activeElement).toBe(walletField));

        // Empty, it is named on itself and nothing is sent.
        restore();
        expect(walletField).toHaveAccessibleDescription(/Enter the wallet password\./);
        expect(importBackupFresh).toHaveBeenCalledTimes(1);

        typeInto('Wallet password', 'wallet-password');
        restore();
        await waitFor(() => expect(importBackupFresh).toHaveBeenCalledTimes(2));
        expect(importBackupFresh).toHaveBeenLastCalledWith({
            password: 'wallet-password',
            backupPassword: 'file-password',
            walletPassword: 'wallet-password',
            fileContent: backupEnvelopeText(),
        });
        expect(await screen.findByRole('heading', { name: 'Automatic Donations' })).toBeInTheDocument();
    });

    it('a wrong wallet password is a red sentence under the wallet field', async () => {
        const importBackupFresh = vi.fn(async () => { throw new BackupSeedPasswordError('seed'); });
        renderTab({ messaging: { importBackupFresh } });
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        restore();
        await screen.findByLabelText('Wallet password');
        typeInto('Wallet password', 'still-wrong');
        restore();
        const alert = await screen.findByRole('alert', { name: 'Form errors' });
        expect(alert).toHaveTextContent("That password doesn't open the wallet in this backup.");
        expect(screen.getByLabelText('Wallet password')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Backup password')).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('an add whose wallet needs its own password still offers the vault the main password', async () => {
        const importBackupRequest = vi.fn()
            .mockRejectedValueOnce(new BackupSeedPasswordError('seed'))
            .mockResolvedValueOnce(RESTORED);
        renderTab({ mode: 'add', messaging: { importBackupRequest } });
        await chooseBackupFile();
        typeInto('Backup password', 'vault-and-file-password');
        restore();
        await screen.findByLabelText('Wallet password');
        typeInto('Wallet password', 'old-wallet-password');
        restore();
        await waitFor(() => expect(importBackupRequest).toHaveBeenCalledTimes(2));
        expect(importBackupRequest).toHaveBeenLastCalledWith(expect.objectContaining({
            password: 'vault-and-file-password',
            walletPassword: 'old-wallet-password',
            devicePassword: 'vault-and-file-password',
        }));
        expect(screen.queryByLabelText('Your password on this device')).toBeNull();
    });

    it('an add the open vault refuses asks for this device\'s password, then restores under it', async () => {
        const importBackupRequest = vi.fn()
            .mockRejectedValueOnce(new Error(new RestoreDevicePasswordError().message))
            .mockResolvedValueOnce(RESTORED);
        renderTab({ mode: 'add', messaging: { importBackupRequest } });
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        restore();
        const deviceField = await screen.findByLabelText('Your password on this device');
        expect(deviceField).toHaveAccessibleDescription(/This app unlocks with a different password\./);
        typeInto('Your password on this device', 'vault-password');
        restore();
        await waitFor(() => expect(importBackupRequest).toHaveBeenCalledTimes(2));
        expect(importBackupRequest).toHaveBeenLastCalledWith(expect.objectContaining({
            password: 'file-password',
            walletPassword: 'file-password',
            devicePassword: 'vault-password',
        }));
    });
});

describe('Backup tab: drag and drop', () => {
    function dropOn(target, file) {
        fireEvent.dragOver(target, { dataTransfer: { files: [file] } });
        fireEvent.drop(target, { dataTransfer: { files: [file] } });
    }

    it('marks the area while a file is over it and takes a dropped backup', async () => {
        renderTab();
        const area = document.querySelector('[data-file-field="area"] [data-drop-active]');
        fireEvent.dragOver(area, { dataTransfer: { files: [] } });
        expect(area).toHaveAttribute('data-drop-active', 'true');
        fireEvent.dragLeave(area);
        expect(area).toHaveAttribute('data-drop-active', 'false');

        dropOn(area, new File([backupEnvelopeText()], 'dropped.xchain-wallet', { type: 'application/json' }));
        const card = await screen.findByRole('region', { name: 'Chosen backup file' });
        expect(card).toHaveTextContent('dropped.xchain-wallet');
    });

    it('a file dropped on the summary card replaces the chosen one', async () => {
        renderTab();
        await chooseBackupFile();
        const card = screen.getByRole('region', { name: 'Chosen backup file' });
        dropOn(card, new File(
            [backupEnvelopeText({ walletName: 'Cold Storage' })],
            'cold.xchain-wallet',
            { type: 'application/json' },
        ));
        await waitFor(() => expect(screen.getByRole('region', { name: 'Chosen backup file' }))
            .toHaveTextContent('Cold Storage'));
    });

    it('refuses a dropped file of another type under the area', async () => {
        renderTab();
        const area = document.querySelector('[data-file-field="area"] [data-drop-active]');
        await act(async () => {
            dropOn(area, new File(['x'], 'photo.png', { type: 'image/png' }));
        });
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(/File type not accepted.*Choose a supported backup file/);
    });
});
