// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Which role refused a restore's password. The Backup tab asks once and tries
// that password in every role, so it acts on the kind (show the wallet field,
// show the device field, mark the backup password) rather than on copy. The
// kind has to come out the same from a class instance and from the bare
// message the extension's messaging boundary leaves.

import { describe, it, expect } from 'vitest';
import {
    restoreFailureKind,
    restoreFailureMessage,
} from '../../../packages/core/src/flows/restorePasswordCopy.js';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import {
    BackupSealDamagedError,
    BackupSeedPasswordError,
    RestoreDevicePasswordError,
} from '../../../packages/core/src/flows/backupFile.js';

const cases = [
    ['file-password', () => new BackupPasswordError()],
    ['file-password', () => new Error('backup: wrong password or tampered file')],
    ['wallet-password', () => new BackupSeedPasswordError('seed')],
    ['device-password', () => new RestoreDevicePasswordError()],
    ['damaged', () => new BackupSealDamagedError('seed')],
    ['no-kdf', () => new Error('the backed-up wallet record has no kdfParams')],
    ['not-backup', () => new Error('importBackupFile: unexpected magic "undefined"')],
    ['newer', () => new Error('importBackupFile: unsupported payloadVersion 9 (expected 1)')],
    ['required-wallet', () => new Error("wallet.importBackup.fresh: walletPassword is required (it opens the backed-up wallet's seed)")],
    ['required-file', () => new Error('wallet.importBackup.fresh: backupPassword is required (it opens the backup file)')],
    ['conflict', () => new Error('importBackupFile: refusing to overwrite 1 existing record(s): contacts/c1')],
    ['other', () => new Error('importBackupFile: something nobody has classified yet')],
];

describe('restoreFailureKind', () => {
    it.each(cases)('reads %s from the error', (kind, make) => {
        expect(restoreFailureKind(make())).toBe(kind);
    });

    it.each(cases)('reads %s from the bare message the shell boundary leaves', (kind, make) => {
        const err = make();
        // A class's name is gone across the boundary; only the message survives.
        expect(restoreFailureKind(err.message)).toBe(kind);
    });

    it('the device refusal wins over the wallet and file matchers its copy also trips', () => {
        expect(restoreFailureKind(new RestoreDevicePasswordError().message)).toBe('device-password');
    });

    it('a file that opened around a locked wallet is the wallet\'s password, never the file\'s', () => {
        expect(restoreFailureKind(new BackupSeedPasswordError('imported key').message)).toBe('wallet-password');
    });

    it('keeps restoreFailureMessage on the same classification', () => {
        expect(restoreFailureMessage(new BackupSeedPasswordError('seed'))).toMatch(/backup file opened/);
        expect(restoreFailureMessage(new BackupPasswordError())).toMatch(/did not open the backup file/);
        expect(restoreFailureMessage(new Error('importBackupFile: nobody knows')))
            .toBe('Nobody knows. Check the backup file, then each of the three passwords above.');
    });
});
