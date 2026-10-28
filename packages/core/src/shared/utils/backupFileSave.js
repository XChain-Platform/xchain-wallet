// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Where an encrypted backup file goes, and what counts as proof it got there.
//
// The backup reminder disappears once a backup is marked done, so a file the
// browser never wrote (a blocked download, a cancelled dialog, a popup that
// closed first) must not mark it. Each route reports what really happened:
//
//   'desktop'  the shell's save dialog writes the file and returns its path,
//              or reports a cancel.
//   'picker'   the browser's save picker hands back a file the page writes
//              itself; the write resolving is the proof.
//   'download' an ordinary download, which reports nothing back, so the user
//              confirms the file is in their downloads.
//
// Feature-detected rather than shell-branched, since core imports nothing
// from a shell package. Extension pages take the download route.

const BACKUP_EXTENSION = '.xchain-wallet';

/**
 * @param {any} [env]
 * @returns {'desktop' | 'picker' | 'download'}
 */
export function backupSaveRoute(env = globalThis) {
    if (typeof env?.xchainWalletBridge?.saveBackupFile === 'function') return 'desktop';
    if (env?.location?.protocol === 'chrome-extension:') return 'download';
    if (typeof env?.showSaveFilePicker === 'function') return 'picker';
    return 'download';
}

/**
 * A safe, descriptive file name for a backup of `walletName` taken at `createdAt`.
 *
 * @param {string} walletName
 * @param {string | number | Date} [createdAt]
 * @returns {string}
 */
export function backupFileName(walletName, createdAt) {
    const safeName = String(walletName || 'wallet')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 60)
        .replace(/[._-]+$/g, '') || 'wallet';
    const at = new Date(createdAt ?? Date.now());
    const stamp = Number.isNaN(at.getTime())
        ? new Date().toISOString().slice(0, 10)
        : at.toISOString().slice(0, 10);
    return `${safeName}-backup-${stamp}${BACKUP_EXTENSION}`;
}

/** Whether `err` is the user dismissing a picker or dialog. */
export function isSaveCancel(err) {
    return err?.name === 'AbortError';
}

/**
 * Open the browser's save picker. Must run inside the click that asked for
 * the export: the picker needs that user activation, and encrypting the file
 * first can outlast it.
 *
 * @param {string} suggestedName
 * @param {string} description   the file type name the picker shows
 * @param {any} [env]
 * @returns {Promise<any>} the chosen file handle; rejects with an AbortError on cancel
 */
export function pickBackupFile(suggestedName, description, env = globalThis) {
    return env.showSaveFilePicker({
        suggestedName,
        types: [{
            description,
            accept: { 'application/json': [BACKUP_EXTENSION] },
        }],
    });
}

/**
 * Write the backup into a handle from `pickBackupFile`; resolves once the file is closed.
 *
 * @param {any} handle
 * @param {string} fileContent
 */
export async function writeBackupFile(handle, fileContent) {
    const writable = await handle.createWritable();
    try {
        await writable.write(fileContent);
    } catch (err) {
        try { await writable.abort?.(); } catch { /* the write error is the one to report */ }
        throw err;
    }
    await writable.close();
}

/**
 * Save through the desktop shell's dialog.
 *
 * @param {string} fileName
 * @param {string} fileContent
 * @param {any} [env]
 * @returns {Promise<{ saved: true, path: string } | { saved: false }>}
 */
export async function saveBackupThroughShell(fileName, fileContent, env = globalThis) {
    const reply = await env.xchainWalletBridge.saveBackupFile({ fileName, content: fileContent });
    if (!reply || reply.ok !== true) {
        throw new Error(String(reply?.error || 'save failed'));
    }
    if (reply.saved === true && typeof reply.path === 'string' && reply.path) {
        return { saved: true, path: reply.path };
    }
    return { saved: false };
}

/**
 * Hand the file to the browser as an ordinary download. Nothing comes back to
 * say whether it was written, so the caller asks the user to confirm.
 *
 * @param {string} fileName
 * @param {string} fileContent
 */
export function startBackupDownload(fileName, fileContent) {
    const blob = new Blob([fileContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
