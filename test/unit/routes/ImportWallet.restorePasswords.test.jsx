// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The restore screen says which password failed.
//
// A restore can need up to three secrets: the one that opens the backup file,
// the one that opens the wallet sealed inside it, and (adding to an open
// vault) the one this device unlocks with. The rebuilt tab (restore-v2,
// 2026-11-14) asks once and tries that password in every role, so what the
// user reads after a failure has to say which role refused it, and the only
// extra field it ever shows is the one for that role.
//
// Driven through the rendered screen rather than asserted against the source,
// because the thing under test is what a user reads.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import { BackupSeedPasswordError } from '../../../packages/core/src/flows/backupFile.js';
import { chooseBackupFile, openBackupTab, typeInto } from '../../helpers/backupFileChoice.js';

afterEach(cleanup);

async function openRestoreLane(messaging, mode = 'fresh') {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode={mode} />
        </MessagingProvider>,
    );
    openBackupTab();
    await chooseBackupFile();
}

function submitWith(password) {
    typeInto('Backup password', password);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
}

describe('The restore screen says which password failed', () => {
    it('asks for one password, whichever mode is restoring', async () => {
        await openRestoreLane({ importBackupFresh: vi.fn() });
        expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
        cleanup();
        await openRestoreLane({ importBackupRequest: vi.fn() }, 'add');
        expect(document.querySelectorAll('input[type="password"]')).toHaveLength(1);
        expect(screen.queryByLabelText('Your password on this device')).toBeNull();
    });

    it('a password that does not open the file is named on the backup password field', async () => {
        await openRestoreLane({ importBackupFresh: vi.fn().mockRejectedValue(new BackupPasswordError()) });
        submitWith('this-devices-password');
        // The field's own line and the notice at the top both carry it.
        const alert = (await screen.findAllByRole('alert')).find((node) => node.getAttribute('aria-label') !== 'Form errors');
        expect(alert.textContent).toBe("That password doesn't open this backup.");
        expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent("That password doesn't open this backup.");
        expect(screen.getByLabelText('Backup password')).toHaveAttribute('aria-invalid', 'true');
    });

    it('a file that opened around a wallet that did not asks for that wallet\'s password, not a retype', async () => {
        await openRestoreLane({ importBackupFresh: vi.fn().mockRejectedValue(new BackupSeedPasswordError('seed')) });
        submitWith('file-password');
        expect(await screen.findByLabelText('Wallet password')).toBeTruthy();
        expect(screen.getByLabelText('Backup password')).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('a bare string across the messaging boundary classifies the same way', async () => {
        // The extension popup never sees the class: the error arrives as a
        // string. That is the path the screen has to survive.
        await openRestoreLane({
            importBackupFresh: vi.fn().mockRejectedValue(new Error('backup: wrong password or tampered file')),
        });
        submitWith('pw12345678');
        expect((await screen.findByRole('alert', { name: 'Form errors' })).textContent).toContain("That password doesn't open this backup.");
    });

    it('a shell that still words the wallet role as a parameter reveals the wallet field', async () => {
        await openRestoreLane({
            importBackupFresh: vi.fn().mockRejectedValue(
                new Error("wallet.importBackup.fresh: walletPassword is required (it opens the backed-up wallet's seed)"),
            ),
        });
        submitWith('pw12345678');
        expect(await screen.findByLabelText('Wallet password')).toBeTruthy();
    });

    it('never renders a function name in place of an explanation', async () => {
        await openRestoreLane({
            importBackupFresh: vi.fn().mockRejectedValue(
                new Error('importBackupFile: something nobody has classified yet'),
            ),
        });
        submitWith('pw12345678');
        const alert = await screen.findByRole('alert', { name: 'Form errors' });
        expect(alert.textContent).not.toMatch(/importBackupFile/);
        expect(alert.textContent).not.toMatch(/three passwords/);
    });

    it('never echoes a password into the page or the console', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await openRestoreLane({ importBackupFresh: vi.fn().mockRejectedValue(new BackupSeedPasswordError('seed')) });
        submitWith('Secret-File-Pass-1');
        await screen.findByLabelText('Wallet password');
        typeInto('Wallet password', 'Secret-Wallet-Pass-2');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByRole('alert', { name: 'Form errors' });
        const text = document.body.textContent;
        expect(text).not.toContain('Secret-File-Pass-1');
        expect(text).not.toContain('Secret-Wallet-Pass-2');
        const logged = [...log.mock.calls, ...warn.mock.calls].flat().map(String).join(' ');
        expect(logged).not.toContain('Secret-File-Pass-1');
        expect(logged).not.toContain('Secret-Wallet-Pass-2');
        log.mockRestore();
        warn.mockRestore();
    });
});
