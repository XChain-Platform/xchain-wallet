// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Save an encrypted wallet backup through the native save dialog.
//
// The renderer says "save this backup" and suggests a name; main shows the
// dialog, writes the file to the path the user picked, and answers with that
// path or with "not saved". The renderer marks the backup done only on a
// written path, so a cancelled dialog leaves the backup reminder in place.
// The renderer never names a directory: a compromised renderer can at most
// offer a file the user still has to place.

import { join } from 'node:path';

const BACKUP_EXTENSION = 'xchain-wallet';
const BACKUP_MAGIC = 'XCHAIN-WALLET-BACKUP';
const DEFAULT_FILE_NAME = `wallet-backup.${BACKUP_EXTENSION}`;
// A backup holds one wallet's records; far above any real one, and small
// enough that a renderer cannot use the channel to fill the disk.
const MAX_BACKUP_CHARS = 32 * 1024 * 1024;

/**
 * The suggested name as a bare file name with the backup extension, or a
 * default. Path separators and anything outside a plain name are dropped.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function safeBackupFileName(name) {
    if (typeof name !== 'string') return DEFAULT_FILE_NAME;
    const base = name.split(/[\\/]/).pop() ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(base)) return DEFAULT_FILE_NAME;
    return base.endsWith(`.${BACKUP_EXTENSION}`) ? base : DEFAULT_FILE_NAME;
}

/**
 * @param {unknown} content
 * @returns {boolean}
 */
function isBackupEnvelope(content) {
    if (typeof content !== 'string' || content.length === 0 || content.length > MAX_BACKUP_CHARS) return false;
    try {
        const parsed = JSON.parse(content);
        return Boolean(parsed) && typeof parsed === 'object' && parsed.magic === BACKUP_MAGIC;
    } catch {
        return false;
    }
}

/**
 * @param {unknown} request   `{ fileName, content }` from the renderer
 * @param {{
 *   dialog: { showSaveDialog: Function },
 *   writeFile: (path: string, data: string, opts: object) => Promise<void>,
 *   window?: unknown,
 *   defaultDir?: string,
 * }} deps
 * @returns {Promise<{ ok: true, saved: true, path: string } | { ok: true, saved: false } | { ok: false, error: string }>}
 */
export async function saveBackupFile(request, { dialog, writeFile, window, defaultDir }) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        return { ok: false, error: 'save-backup: expected { fileName, content }' };
    }
    const keys = Object.keys(request);
    if (keys.some((key) => key !== 'fileName' && key !== 'content')) {
        return { ok: false, error: 'save-backup: unexpected property' };
    }
    if (!isBackupEnvelope(request.content)) {
        return { ok: false, error: 'save-backup: content is not a wallet backup' };
    }
    const fileName = safeBackupFileName(request.fileName);
    const options = {
        defaultPath: defaultDir ? join(defaultDir, fileName) : fileName,
        filters: [{ name: 'Wallet backup', extensions: [BACKUP_EXTENSION] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const choice = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
    if (!choice || choice.canceled || typeof choice.filePath !== 'string' || !choice.filePath) {
        return { ok: true, saved: false };
    }
    await writeFile(choice.filePath, request.content, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, saved: true, path: choice.filePath };
}
