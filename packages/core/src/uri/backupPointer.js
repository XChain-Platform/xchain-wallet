// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Backup-pointer URI parse/encode (§15.4 "Scan QR ... or backup
// pointer").
//
// A backup pointer is a compact QR-friendly URI that says WHERE an
// encrypted §19.4 backup envelope lives, without carrying the envelope
// itself. Scanning one at the Welcome screen lets a user restore a
// wallet they published somewhere (an on-chain FILE action, an https
// mirror, a self-hosted blob) by pointing the app at it and entering
// the backup password. The pointer never carries the decryption
// password: the envelope stays password-encrypted, so a leaked pointer
// alone cannot open the backup.
//
// Format:
//
//   xchain-backup:<version>?loc=<location>&name=<label>
//
//   version   integer payload version (currently 1)
//   loc       REQUIRED. Percent-encoded location the app fetches the
//             encrypted envelope from. The scheme of `loc` is
//             deliberately open: an https URL, or an on-chain
//             reference the shell knows how to resolve (e.g.
//             `xchain-file:bitcoin/<discoveryName>`). Core does not
//             fetch it; resolution is injected by the shell (see
//             `restoreFromBackupPointer`).
//   name      Optional percent-encoded human label shown in the UI.
//
// Resolution is intentionally NOT part of parsing: the parser is pure
// string classification (no network, no SDK), matching the rest of the
// `uri/` layer.

export const BACKUP_POINTER_SCHEME = 'xchain-backup';
export const BACKUP_POINTER_VERSION = 1;

export class InvalidBackupPointerError extends Error {
    /**
     * @param {string} reason
     * @param {string} [uri]
     */
    constructor(reason, uri) {
        super(`backup pointer: ${reason}`);
        this.name = 'InvalidBackupPointerError';
        this.uri = uri;
    }
}

/**
 * @typedef {Object} BackupPointer
 * @property {number} version                    payload version (currently 1)
 * @property {string} location                   where the encrypted envelope lives (decoded)
 * @property {string} [name]                     optional human label (decoded)
 * @property {string} raw                         the original URI string
 */

/**
 * True when `input` looks like a backup-pointer URI (scheme match
 * only; does not validate the rest). Cheap pre-check for the QR
 * classifier so a malformed pointer is still recognized AS a pointer
 * rather than silently reclassified as something else.
 *
 * @param {unknown} input
 * @returns {boolean}
 */
export function looksLikeBackupPointer(input) {
    if (typeof input !== 'string') return false;
    const raw = input.trim();
    const colonIdx = raw.indexOf(':');
    if (colonIdx <= 0) return false;
    return raw.slice(0, colonIdx).toLowerCase() === BACKUP_POINTER_SCHEME;
}

/**
 * Parse a backup-pointer URI. Throws `InvalidBackupPointerError` on
 * anything malformed.
 *
 * @param {string} uri
 * @returns {BackupPointer}
 */
export function parseBackupPointer(uri) {
    if (typeof uri !== 'string' || uri.trim().length === 0) {
        throw new InvalidBackupPointerError('uri must be a non-empty string', uri);
    }
    const raw = uri.trim();

    const colonIdx = raw.indexOf(':');
    if (colonIdx <= 0) {
        throw new InvalidBackupPointerError('missing scheme (no ":")', raw);
    }
    const scheme = raw.slice(0, colonIdx).toLowerCase();
    if (scheme !== BACKUP_POINTER_SCHEME) {
        throw new InvalidBackupPointerError(
            `wrong scheme "${scheme}" (expected "${BACKUP_POINTER_SCHEME}")`,
            raw,
        );
    }

    const body = raw.slice(colonIdx + 1);
    const qIdx = body.indexOf('?');
    const versionStr = (qIdx < 0 ? body : body.slice(0, qIdx)).trim();
    if (versionStr.length === 0) {
        throw new InvalidBackupPointerError('missing version segment', raw);
    }
    if (!/^\d+$/.test(versionStr)) {
        throw new InvalidBackupPointerError(`invalid version "${versionStr}"`, raw);
    }
    const version = Number(versionStr);
    if (version !== BACKUP_POINTER_VERSION) {
        throw new InvalidBackupPointerError(
            `unsupported version ${version} (this build understands ${BACKUP_POINTER_VERSION})`,
            raw,
        );
    }

    if (qIdx < 0) {
        throw new InvalidBackupPointerError('missing "loc" parameter', raw);
    }
    const query = body.slice(qIdx + 1);

    /** @type {Record<string, string>} */
    const params = {};
    for (const pair of query.split('&')) {
        if (pair.length === 0) continue;
        const eq = pair.indexOf('=');
        const key = (eq < 0 ? pair : pair.slice(0, eq)).toLowerCase();
        const rawVal = eq < 0 ? '' : pair.slice(eq + 1);
        let val;
        try {
            val = decodeURIComponent(rawVal.replace(/\+/g, ' '));
        } catch {
            throw new InvalidBackupPointerError(`param "${key}" is not valid percent-encoding`, raw);
        }
        // First occurrence wins; ignore accidental duplicates.
        if (!(key in params)) params[key] = val;
    }

    const location = (params.loc ?? '').trim();
    if (location.length === 0) {
        throw new InvalidBackupPointerError('missing or empty "loc" parameter', raw);
    }

    /** @type {BackupPointer} */
    const out = { version, location, raw };
    if (typeof params.name === 'string' && params.name.length > 0) {
        out.name = params.name;
    }
    return out;
}

/**
 * Build a backup-pointer URI string from its parts. Inverse of
 * `parseBackupPointer`.
 *
 * @param {{ location: string, name?: string }} parts
 * @returns {string}
 */
export function buildBackupPointer({ location, name } = {}) {
    if (typeof location !== 'string' || location.trim().length === 0) {
        throw new InvalidBackupPointerError('location is required to build a pointer');
    }
    let out = `${BACKUP_POINTER_SCHEME}:${BACKUP_POINTER_VERSION}?loc=${encodeURIComponent(location.trim())}`;
    if (typeof name === 'string' && name.length > 0) {
        out += `&name=${encodeURIComponent(name)}`;
    }
    return out;
}
