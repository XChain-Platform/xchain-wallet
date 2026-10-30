// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @vitest-environment node */

// The desktop save dialog answers with the written path or "not saved", and
// only a written path lets the renderer mark the backup done.

import { describe, expect, it, vi } from 'vitest';

import { saveBackupFile, safeBackupFileName } from '../../../packages/desktop/main/backupSave.js';

const CONTENT = JSON.stringify({ magic: 'XCHAIN-WALLET-BACKUP', formatVersion: 1, payload: 'x' });

function deps(choice) {
    return {
        dialog: { showSaveDialog: vi.fn(async () => choice) },
        writeFile: vi.fn(async () => {}),
        window: { id: 1 },
        defaultDir: '/home/user/Documents',
    };
}

describe('desktop backup save dialog', () => {
    it('writes the file where the user chose and answers with that path', async () => {
        const d = deps({ canceled: false, filePath: '/home/user/Backups/cold.xchain-wallet' });
        const reply = await saveBackupFile({ fileName: 'Cold-backup-2026-10-27.xchain-wallet', content: CONTENT }, d);

        expect(reply).toEqual({ ok: true, saved: true, path: '/home/user/Backups/cold.xchain-wallet' });
        expect(d.dialog.showSaveDialog).toHaveBeenCalledWith(d.window, expect.objectContaining({
            defaultPath: '/home/user/Documents/Cold-backup-2026-10-27.xchain-wallet',
        }));
        expect(d.writeFile).toHaveBeenCalledWith('/home/user/Backups/cold.xchain-wallet', CONTENT, { encoding: 'utf8', mode: 0o600 });
    });

    it('answers not saved and writes nothing when the dialog is cancelled', async () => {
        const d = deps({ canceled: true, filePath: '' });
        const reply = await saveBackupFile({ fileName: 'Cold-backup-2026-10-27.xchain-wallet', content: CONTENT }, d);

        expect(reply).toEqual({ ok: true, saved: false });
        expect(d.writeFile).not.toHaveBeenCalled();
    });

    it('refuses content that is not a backup without opening the dialog', async () => {
        for (const content of ['', 'not json', JSON.stringify({ magic: 'OTHER' }), 42]) {
            const d = deps({ canceled: false, filePath: '/tmp/x.xchain-wallet' });
            const reply = await saveBackupFile({ fileName: 'a.xchain-wallet', content }, d);
            expect(reply.ok).toBe(false);
            expect(d.dialog.showSaveDialog).not.toHaveBeenCalled();
            expect(d.writeFile).not.toHaveBeenCalled();
        }
        const d = deps({ canceled: false, filePath: '/tmp/x.xchain-wallet' });
        expect((await saveBackupFile({ fileName: 'a.xchain-wallet', content: CONTENT, path: '/etc' }, d)).ok).toBe(false);
        expect(d.dialog.showSaveDialog).not.toHaveBeenCalled();
    });

    it('keeps the suggested name to a bare backup file name', () => {
        expect(safeBackupFileName('Cold-backup-2026-10-27.xchain-wallet')).toBe('Cold-backup-2026-10-27.xchain-wallet');
        expect(safeBackupFileName('../../etc/passwd')).toBe('wallet-backup.xchain-wallet');
        expect(safeBackupFileName('/Users/me/evil.xchain-wallet')).toBe('evil.xchain-wallet');
        expect(safeBackupFileName('run.sh')).toBe('wallet-backup.xchain-wallet');
        expect(safeBackupFileName(null)).toBe('wallet-backup.xchain-wallet');
    });
});
