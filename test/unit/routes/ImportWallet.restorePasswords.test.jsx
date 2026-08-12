// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// : the restore screen names WHICH of its three passwords it is asking
// for, in the fields and in every failure.
//
// The mechanism shipped with  (the restore re-keys the wallet onto this
// device's password). What did not ship was the copy: three password boxes,
// and a failure that said only "wrong password". A user who typed a perfectly
// correct password into the wrong box could not tell that from a typo, and two
// of the three are passwords they still use elsewhere.
//
// Driven through the rendered screen rather than asserted against the source,
// because the thing under test is what a user reads.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import {
    RESTORE_PASSWORD_INTRO,
    RESTORE_PASSWORD_LABELS,
    restoreDeviceLabel,
} from '../../../packages/core/src/flows/restorePasswordCopy.js';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import { BackupSeedPasswordError } from '../../../packages/core/src/flows/backupFile.js';

const ENVELOPE = '{"magic":"XCHAIN-WALLET-BACKUP","formatVersion":1}';

/** The password this device unlocks with. Typed into the WRONG box below. */
const DEVICE_PASSWORD = 'this-devices-password';
const WALLET_PASSWORD = 'the-old-devices-password';

function openRestoreLane(messaging, mode = 'fresh') {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode={mode} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
}

function fill(label, value) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Fills the lane the way the reported user did: device password into the file box. */
function fillWithTheMixUp(mode = 'fresh') {
    fireEvent.change(screen.getByPlaceholderText(/argon2id/), { target: { value: ENVELOPE } });
    fill(RESTORE_PASSWORD_LABELS.file, DEVICE_PASSWORD);
    fill(RESTORE_PASSWORD_LABELS.wallet, WALLET_PASSWORD);
    fill(restoreDeviceLabel(mode), DEVICE_PASSWORD);
}

describe(': the restore screen says which password it wants', () => {
    it('names all three, in the fields and once above them', () => {
        openRestoreLane({ importBackupFresh: vi.fn() });

        // The framing line. Without it the second and third boxes read as the
        // app asking for the same thing twice.
        expect(screen.getByText(RESTORE_PASSWORD_INTRO)).toBeTruthy();

        // Three labelled boxes, three different labels. getByLabelText throws
        // if a label is renamed or duplicated, which is the point.
        expect(screen.getByLabelText(RESTORE_PASSWORD_LABELS.file)).toBeTruthy();
        expect(screen.getByLabelText(RESTORE_PASSWORD_LABELS.wallet)).toBeTruthy();
        expect(screen.getByLabelText(restoreDeviceLabel('fresh'))).toBeTruthy();

        // Each hint rules the other roles out, which is what makes the label
        // actionable rather than merely different.
        expect(screen.getByText(/Not the password of the wallet inside it/i)).toBeTruthy();
        expect(screen.getByText(/on the device you backed it up from/i)).toBeTruthy();
    });

    it('an add-mode restore labels the device box for a vault that already exists', () => {
        openRestoreLane({ importBackupRequest: vi.fn() }, 'add');
        expect(screen.getByLabelText(RESTORE_PASSWORD_LABELS.device.add)).toBeTruthy();
        expect(screen.queryByLabelText(RESTORE_PASSWORD_LABELS.device.fresh)).toBeNull();
    });

    it('the device password typed into the backup-file box is told which box wants it', async () => {
        // THE REPORTED FAILURE. The host rejects the envelope; the screen has
        // to turn that into something that names the field.
        const importBackupFresh = vi.fn().mockRejectedValue(new BackupPasswordError());
        openRestoreLane({ importBackupFresh });
        fillWithTheMixUp();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/did not open the backup file/i);
        expect(alert.textContent,
            'the restore failure does not name the field it wants, so a correct password in the '
            + 'wrong box still reads as a typo')
            .toContain(RESTORE_PASSWORD_LABELS.file);
    });

    it('and blames the wallet field when it is the wallet password that is wrong', async () => {
        const importBackupFresh = vi.fn().mockRejectedValue(new BackupSeedPasswordError('seed'));
        openRestoreLane({ importBackupFresh });
        fillWithTheMixUp();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain(RESTORE_PASSWORD_LABELS.wallet);
        expect(alert.textContent).toMatch(/backup file opened/i);
    });

    it('a bare string across the messaging boundary classifies the same way', async () => {
        // The extension popup never sees the class: the error arrives as a
        // string. That is the path the copy has to survive.
        const importBackupFresh = vi.fn().mockRejectedValue(
            new Error('backup: wrong password or tampered file'),
        );
        openRestoreLane({ importBackupFresh });
        fillWithTheMixUp();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain(RESTORE_PASSWORD_LABELS.file);
    });

    it('never renders a function name in place of an explanation', async () => {
        const importBackupFresh = vi.fn().mockRejectedValue(
            new Error('importBackupFile: something nobody has classified yet'),
        );
        openRestoreLane({ importBackupFresh });
        fillWithTheMixUp();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/nobody has classified yet/);
        expect(alert.textContent).not.toMatch(/importBackupFile/);
        // An unclassified failure cannot name ONE field honestly, so it points
        // at all three rather than at none.
        expect(alert.textContent).toMatch(/three passwords above/);
    });

    it('an empty box is reported by the name printed on it', async () => {
        openRestoreLane({ importBackupFresh: vi.fn() }, 'add');
        fireEvent.change(screen.getByPlaceholderText(/argon2id/), { target: { value: ENVELOPE } });
        // Restore stays disabled with a box empty, so the guard is driven the
        // way a shell without that guard would reach it.
        fill(RESTORE_PASSWORD_LABELS.file, 'pw12345678');
        fill(RESTORE_PASSWORD_LABELS.wallet, WALLET_PASSWORD);
        fill(RESTORE_PASSWORD_LABELS.device.add, DEVICE_PASSWORD);
        fill(RESTORE_PASSWORD_LABELS.wallet, '');
        fireEvent.submit(screen.getByRole('button', { name: 'Restore' }).closest('form'));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toContain(RESTORE_PASSWORD_LABELS.wallet);
        expect(alert.textContent).toMatch(/is required/);
    });
});
