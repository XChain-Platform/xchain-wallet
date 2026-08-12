// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A restore is the only screen that asks for three passwords at once,
// and until this landed every failure said "wrong password" without saying
// which of the three it meant. A correct password typed into the wrong box was
// indistinguishable from a typo.
//
// The bar every string here has to clear: it names a field the user can see on
// the screen in front of them. Asserted at the flow layer because that is
// where it has to live - the error crosses the shell messaging boundary as a
// bare string, so the class is gone by the time a form sees it (same reason
// `_wifFailureMessage.js` sits beside it).

import { describe, it, expect } from 'vitest';
import {
    RESTORE_PASSWORD_INTRO,
    RESTORE_PASSWORD_LABELS,
    RESTORE_PASSWORD_HINTS,
    restoreDeviceHint,
    restoreDeviceLabel,
    restoreFailureMessage,
    restorePasswordRequiredMessage,
} from '../../../packages/core/src/flows/restorePasswordCopy.js';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import { BackupSeedPasswordError } from '../../../packages/core/src/flows/backupFile.js';

/** Every string this lane can put on screen clears the same bar. */
function expectUserFacing(message) {
    // No function / method name standing in for an explanation.
    expect(message).not.toMatch(/importBackupFile|decodeBackupEnvelope|rekeyWalletRecord/);
    expect(message).not.toMatch(/^[a-z][A-Za-z0-9_$]*(\.[A-Za-z0-9_$]+)*:\s/);
    // No parameter names: `walletPassword` is not a thing the user can see.
    expect(message).not.toMatch(/walletPassword|devicePassword|backupPassword|kdfParams/);
    expect(message.length).toBeGreaterThan(20);
    expect(message).toMatch(/^[A-Z"]/);
    expect(message).toMatch(/[.!?]$/);
}

/** ...and every FAILURE additionally names one of the three fields. */
function expectNamesAField(message, mode = 'fresh') {
    expectUserFacing(message);
    const named = [
        RESTORE_PASSWORD_LABELS.file,
        RESTORE_PASSWORD_LABELS.wallet,
        restoreDeviceLabel(mode),
    ].filter((label) => message.includes(label));
    expect(named.length,
        `this restore message names none of the three password fields, so a user who typed a `
        + `correct password into the wrong box still cannot tell which one it wants: "${message}"`)
        .toBeGreaterThan(0);
}

describe('The three restore passwords are distinguishable', () => {
    it('gives each role a distinct label', () => {
        const labels = new Set([
            RESTORE_PASSWORD_LABELS.file,
            RESTORE_PASSWORD_LABELS.wallet,
            RESTORE_PASSWORD_LABELS.device.fresh,
            RESTORE_PASSWORD_LABELS.device.add,
        ]);
        expect(labels.size, 'two of the restore fields share a label').toBe(4);
    });

    it('says up front that there are three of them', () => {
        expect(RESTORE_PASSWORD_INTRO).toMatch(/three different passwords/i);
        expectUserFacing(RESTORE_PASSWORD_INTRO);
    });

    it('each hint says what the field is NOT', () => {
        // The mix-up, not the typo, is the failure this item exists for: every
        // hint has to rule the other two roles out.
        expect(RESTORE_PASSWORD_HINTS.file).toMatch(/not the/i);
        expect(RESTORE_PASSWORD_HINTS.wallet).toMatch(/device you backed it up from/i);
        expect(restoreDeviceHint('fresh')).toMatch(/from now on/i);
        expect(restoreDeviceHint('add')).toMatch(/already unlock/i);
    });

    it('labels the device field by mode', () => {
        expect(restoreDeviceLabel('add')).toBe(RESTORE_PASSWORD_LABELS.device.add);
        expect(restoreDeviceLabel('fresh')).toBe(RESTORE_PASSWORD_LABELS.device.fresh);
        expect(restoreDeviceLabel(undefined)).toBe(RESTORE_PASSWORD_LABELS.device.fresh);
    });
});

describe('restoreFailureMessage names the password it is talking about', () => {
    it('the file password: the exact case in the ledger entry', () => {
        // The user typed this device's password into the backup-file box. The
        // password is right for something, just not for this field, and the old
        // copy ("wrong password or tampered file") could not say so.
        const m = restoreFailureMessage(new BackupPasswordError());
        expect(m).toContain(RESTORE_PASSWORD_LABELS.file);
        expect(m).toMatch(/did not open the backup file/i);
        expectNamesAField(m);
    });

    it('the file password, still, when only the string survived the boundary', () => {
        // The extension popup gets a bare string. Both the current wording and
        // the pre-one have to classify, because a shell one release
        // behind still throws the old text.
        expectNamesAField(restoreFailureMessage('backup: wrong password or tampered file'));
        expectNamesAField(restoreFailureMessage(new BackupPasswordError().message));
    });

    it('the backed-up wallet password, not the file one', () => {
        const m = restoreFailureMessage(new BackupSeedPasswordError('seed'));
        expect(m).toContain(RESTORE_PASSWORD_LABELS.wallet);
        // The trap this ordering exists for: the wallet-password failure also
        // mentions the backup file (it says the file OPENED), so a naive
        // matcher blames the file field and sends the user to change a
        // password that was correct.
        expect(m).not.toContain(`The "${RESTORE_PASSWORD_LABELS.file}" field wants`);
        expectNamesAField(m);
    });

    it('an empty field is named by its label, per mode', () => {
        for (const role of ['file', 'wallet', 'device']) {
            for (const mode of ['fresh', 'add']) {
                const m = restorePasswordRequiredMessage(role, mode);
                expectNamesAField(m, mode);
                expect(m).toMatch(/is required/);
            }
        }
        expect(restorePasswordRequiredMessage('device', 'add'))
            .toContain(RESTORE_PASSWORD_LABELS.device.add);
    });

    it('re-labels a core "required" throw for the mode the screen is in', () => {
        // Core has no idea whether this is a fresh install or an add, so it
        // words the fresh label; the screen fixes it up. Without this an 'add'
        // restore points at a field labelled something else.
        const fromCore = restorePasswordRequiredMessage('device', 'fresh');
        expect(restoreFailureMessage(fromCore, { mode: 'add' }))
            .toContain(RESTORE_PASSWORD_LABELS.device.add);
    });

    it('an empty box stays "empty", it does not become "wrong"', () => {
        // Ordering trap, and a real one: core's empty-box message QUOTES the
        // field label, and the wrong-password matcher looks for that same
        // label. Classified in the wrong order, a user who left the box blank
        // is told the password they never typed is incorrect.
        for (const role of ['file', 'wallet', 'device']) {
            const fromCore = restorePasswordRequiredMessage(role, 'fresh');
            const shown = restoreFailureMessage(fromCore, { mode: 'fresh' });
            expect(shown, `a "${role}" empty-box message was reclassified as a wrong password`)
                .toMatch(/is required/);
            expect(shown).not.toMatch(/did not open|is not the password/);
        }
    });

    it('classifies the shell guards, which still speak in parameter names', () => {
        expectNamesAField(restoreFailureMessage(
            new Error("wallet.importBackup: walletPassword is required (it opens the backed-up wallet's seed)"),
        ));
        expectNamesAField(restoreFailureMessage(
            new Error('wallet.importBackup: backupPassword is required (it opens the backup file)'),
        ));
        expectNamesAField(restoreFailureMessage(new Error('importBackupFile: devicePassword is required')));
    });

    it('turns a conflict into the checkbox that resolves it', () => {
        const m = restoreFailureMessage(new Error(
            'importBackupFile: refusing to overwrite 2 existing record(s): wallets/w1, accounts/a1',
        ));
        expect(m).toMatch(/Overwrite if any record collides/);
        expectUserFacing(m);
    });

    it('a record with no kdfParams is not blamed on any password', () => {
        // Nothing the user types can fix this one, so naming a field would be
        // a lie. It says so instead.
        const m = restoreFailureMessage(new Error(
            'importBackupFile: the backed-up wallet record has no kdfParams, so its seal cannot be opened at all',
        ));
        expect(m).toMatch(/missing the details needed to unlock it/i);
        expectUserFacing(m);
    });

    it('still says something for a failure it has never seen', () => {
        // The fallback matters most: an unclassified error is exactly the one
        // that used to reach the screen with a function name glued to it.
        expectUserFacing(restoreFailureMessage(new Error('importBackupFile: kaboom happened')));
        expectUserFacing(restoreFailureMessage(new Error('')));
        expectUserFacing(restoreFailureMessage(undefined));
        expectUserFacing(restoreFailureMessage({ nope: true }));
    });
});
