// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { clearBackupReminderState, getBackupVerifiedAt } from '../../../packages/core/src/flows/backupReminder.js';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

const CONTENT = JSON.stringify({
    magic: 'XCHAIN-WALLET-BACKUP',
    formatVersion: 1,
    createdAt: '2026-10-13T18:00:00.000Z',
    walletName: 'Cold / Vault',
    encryption: {
        algorithm: 'aes-256-gcm',
        kdf: {
            algorithm: 'argon2id',
            salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
            iterations: 3,
            memory: 65536,
            parallelism: 1,
        },
        iv: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    },
    payload: 'encrypted-payload',
}, null, 2);

let clickedDownload;
let downloadedBlob;
let originalCreateObjectURL;
let originalRevokeObjectURL;
let originalAnchorClick;

beforeEach(() => {
    clearBackupReminderState();
    clickedDownload = '';
    downloadedBlob = null;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn((blob) => {
        downloadedBlob = blob;
        return 'blob:backup-test';
    });
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = function click() {
        clickedDownload = this.download;
    };
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    delete window.showSaveFilePicker;
    delete window.xchainWalletBridge;
    vi.restoreAllMocks();
});

function mount(exportBackupFile = vi.fn(async () => ({ fileContent: CONTENT })), props = {}) {
    const messaging = { exportBackupFile };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Stale name' }} {...props} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    return messaging;
}

function fillPasswords(password, confirmation = password) {
    fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm backup password'), {
        target: { value: confirmation },
    });
}

describe('BackupSection encrypted export', () => {
    it('requires an eight-character password and an exact confirmation', () => {
        const messaging = mount();

        expect(screen.getByText(/configured download location, usually the Downloads folder/i)).toBeTruthy();
        fillPasswords('short', 'short');
        expect(screen.getByText('Backup password must be at least 8 characters.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();

        fillPasswords('long-enough', 'long-enougH');
        expect(screen.getByText('Backup passwords don\'t match.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
        expect(messaging.exportBackupFile).not.toHaveBeenCalled();

        fillPasswords('long-enough');
        expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    });

    it('locks the prompt while saving and downloads the returned JSON under a safe descriptive name', async () => {
        let finish;
        const exportBackupFile = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        mount(exportBackupFile);
        fillPasswords('backup-secret');

        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        expect(screen.getByLabelText('Backup password')).toBeDisabled();
        expect(screen.getByLabelText('Confirm backup password')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled();
        expect(exportBackupFile).toHaveBeenCalledTimes(1);

        finish({ fileContent: CONTENT });
        expect(await screen.findByText('Confirm the backup file')).toBeTruthy();
        expect(clickedDownload).toBe('Cold-Vault-backup-2026-10-13.xchain-wallet');
        fireEvent.click(screen.getByRole('button', { name: 'I saved the file' }));
        expect(await screen.findByText('Backup file saved')).toBeTruthy();
        expect(screen.getByText(/configured download location, usually the Downloads folder/i)).toBeTruthy();
        expect(downloadedBlob).toBeInstanceOf(Blob);
        expect(downloadedBlob.type).toBe('application/json');
        expect(downloadedBlob.size).toBe(new Blob([CONTENT]).size);
    });

    it('shows elapsed encryption time and safely ignores a cancelled result', async () => {
        let finish;
        mount(vi.fn(() => new Promise((resolve) => { finish = resolve; })));
        fillPasswords('backup-secret');
        vi.useFakeTimers();

        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        act(() => vi.advanceTimersByTime(3_000));
        expect(screen.getByText('Encrypting for 3 seconds…')).toBeTruthy();
        act(() => vi.advanceTimersByTime(27_000));
        expect(screen.getByText(/Cancel and try again/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('button', { name: 'Export…' })).toBeTruthy();
        await act(async () => { finish({ fileContent: CONTENT }); });
        expect(clickedDownload).toBe('');
    });

    it('creates an HTTPS backup pointer QR without putting the file or password in it', async () => {
        mount();
        fillPasswords('backup-secret');
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
        fireEvent.click(await screen.findByRole('button', { name: 'I saved the file' }));
        await screen.findByText('Optional backup pointer QR');

        fireEvent.change(screen.getByLabelText('Backup file HTTPS address'), {
            target: { value: 'http://backups.example/cold.xchain-wallet' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create pointer QR' }));
        expect(screen.getByText('The backup location must use HTTPS.')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Backup file HTTPS address'), {
            target: { value: 'https://backups.example/cold.xchain-wallet' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create pointer QR' }));

        expect(await screen.findByRole('img', { name: 'Backup pointer QR' })).toBeTruthy();
        const pointer = screen.getByText(/^xchain-backup:/).textContent;
        expect(pointer).toContain('loc=https%3A%2F%2Fbackups.example%2Fcold.xchain-wallet');
        expect(pointer).toContain('name=Cold%20%2F%20Vault');
        expect(pointer).not.toContain('encrypted-payload');
        expect(pointer).not.toContain('backup-secret');
    });

    it('refuses a malformed response instead of saving a corrupt backup file', async () => {
        mount(vi.fn(async () => ({ fileContent: '{"not":"a backup"}' })));
        fillPasswords('backup-secret');
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        expect(await screen.findByText('Backup export returned an invalid file.')).toBeTruthy();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
    });
});

function exportWithPassword() {
    fillPasswords('backup-secret');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
}

function abortError() {
    return Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
}

function fakeHandle(name = 'chosen.xchain-wallet') {
    const written = [];
    const writable = {
        write: vi.fn(async (blob) => { written.push(blob); }),
        close: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
    };
    return { name, written, writable, createWritable: vi.fn(async () => writable) };
}

describe('BackupSection marks a backup done only on a real save signal', () => {
    it('download: says nothing is saved and keeps the reminder until the user confirms the file', async () => {
        mount();
        exportWithPassword();

        expect(await screen.findByText('Confirm the backup file')).toBeTruthy();
        expect(screen.getByText('Check that the file is in your downloads, then confirm.')).toBeTruthy();
        expect(screen.queryByText('Backup file saved')).toBeNull();
        expect(getBackupVerifiedAt('wallet-1')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'I saved the file' }));
        expect(await screen.findByText('Backup file saved')).toBeTruthy();
        expect(getBackupVerifiedAt('wallet-1')).toBeTypeOf('string');
    });

    it('download: cancelling the confirm step marks nothing', async () => {
        mount();
        exportWithPassword();
        await screen.findByText('Confirm the backup file');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('button', { name: 'Export…' })).toBeTruthy();
        expect(getBackupVerifiedAt('wallet-1')).toBeNull();
    });

    it('picker: opens before encryption, and a cancelled picker exports nothing and marks nothing', async () => {
        window.showSaveFilePicker = vi.fn(async () => { throw abortError(); });
        const messaging = mount();
        exportWithPassword();

        expect(await screen.findByText(/The backup file wasn't saved/)).toBeTruthy();
        expect(window.showSaveFilePicker).toHaveBeenCalledWith(expect.objectContaining({
            suggestedName: expect.stringMatching(/^Stale-name-backup-\d{4}-\d{2}-\d{2}\.xchain-wallet$/),
        }));
        expect(messaging.exportBackupFile).not.toHaveBeenCalled();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(getBackupVerifiedAt('wallet-1')).toBeNull();
        expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    });

    it('picker: marks the backup done once the file write completes', async () => {
        const handle = fakeHandle('cold.xchain-wallet');
        window.showSaveFilePicker = vi.fn(async () => handle);
        mount();
        exportWithPassword();

        expect(await screen.findByText('Backup file saved')).toBeTruthy();
        expect(screen.getByText('cold.xchain-wallet')).toBeTruthy();
        expect(handle.writable.close).toHaveBeenCalledOnce();
        expect(handle.written).toEqual([CONTENT]);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(getBackupVerifiedAt('wallet-1')).toBeTypeOf('string');
    });

    it('picker: a failed write marks nothing and says the file was not saved', async () => {
        const handle = fakeHandle();
        handle.writable.write = vi.fn(async () => { throw new Error('disk full'); });
        window.showSaveFilePicker = vi.fn(async () => handle);
        mount();
        exportWithPassword();

        expect(await screen.findByText(/Couldn't save the backup file/)).toBeTruthy();
        expect(screen.queryByText('Backup file saved')).toBeNull();
        expect(getBackupVerifiedAt('wallet-1')).toBeNull();
    });

    it('desktop: a cancelled save dialog marks nothing and leaves no saved title', async () => {
        window.xchainWalletBridge = { saveBackupFile: vi.fn(async () => ({ ok: true, saved: false })) };
        mount();
        exportWithPassword();

        expect(await screen.findByText(/The backup file wasn't saved/)).toBeTruthy();
        expect(window.xchainWalletBridge.saveBackupFile).toHaveBeenCalledWith({
            fileName: 'Cold-Vault-backup-2026-10-13.xchain-wallet',
            content: CONTENT,
        });
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByText('Backup file saved')).toBeNull();
        expect(getBackupVerifiedAt('wallet-1')).toBeNull();
    });

    it('desktop: a written file marks the backup done and shows where it went', async () => {
        window.xchainWalletBridge = {
            saveBackupFile: vi.fn(async () => ({ ok: true, saved: true, path: '/Users/me/Backups/cold.xchain-wallet' })),
        };
        mount();
        exportWithPassword();

        expect(await screen.findByText('Backup file saved')).toBeTruthy();
        expect(screen.getByText('/Users/me/Backups/cold.xchain-wallet')).toBeTruthy();
        expect(screen.getByText(/The file is where you chose to save it/)).toBeTruthy();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(getBackupVerifiedAt('wallet-1')).toBeTypeOf('string');
    });

    it('extension popup: Export opens the full tab instead of exporting in the popup', () => {
        const onExportInTab = vi.fn();
        mount(undefined, { onExportInTab });

        expect(onExportInTab).toHaveBeenCalledOnce();
        expect(screen.queryByLabelText('Backup password')).toBeNull();
    });
});
