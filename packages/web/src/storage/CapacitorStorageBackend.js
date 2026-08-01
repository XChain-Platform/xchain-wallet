// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// StorageBackend + meta backend for the native mobile shells ( S2).
//
// WHAT THIS REPLACES AND WHY IT IS NOT OPTIONAL. Wrapped in Capacitor, the
// SPA's IndexedDB and localStorage are WebView storage: Android's WebView
// data is subject to the same eviction and clearing machinery as a browser's,
// and "Clear data" on the app is a two-tap operation in system Settings. On
// the web that is a survivable annoyance because a browser wallet is
// understood to be a browser wallet. In an installed app whose backup posture
// is deliberately `allowBackup=false` (spec §1), the blob in WebView storage
// is the ONLY copy of the vault in existence, sitting in the one place the
// platform feels free to reclaim. Both stores therefore move behind the
// native plugin, which writes to app-private files under an OS-keystore key.
//
// The kdfParams meta moves for the same reason and one more: it is what the
// shell reads to answer "does a wallet exist here". Losing it while the blob
// survives strands the user on an unlock screen for a vault whose KDF
// parameters are gone.

import { storage as coreStorage } from '@xchain-wallet/core';
import {
    VaultStatus,
    isBytes,
    callNativeVault,
    decodeReadReply,
    encodePayload,
} from './nativeVault.js';

const { StorageBackend, VaultCorruptError, VaultUnavailableError } = coreStorage;

/**
 * The encrypted vault blob, held in an app-private file encrypted under a
 * hardware-backed AES-256-GCM key. The plaintext document never leaves the
 * WebView: what crosses the bridge is the same opaque ciphertext IndexedDB
 * would have held (§11.2).
 */
export class CapacitorStorageBackend extends StorageBackend {
    async load() {
        return decodeReadReply(await callNativeVault('loadVault'), 'vault');
    }

    /** @param {Uint8Array} blob */
    async save(blob) {
        if (!isBytes(blob)) {
            throw new Error('CapacitorStorageBackend.save: blob must be a Uint8Array');
        }
        if (blob.length === 0) {
            // The native side keeps the previous generation until the new one
            // reads back, so an empty write would not destroy the vault - but
            // it would replace it with a document that decodes to nothing, and
            // the generation that could have been recovered would then be one
            // more save away from being retired. Refuse at the boundary.
            throw new Error('CapacitorStorageBackend.save: refusing to persist an empty vault');
        }
        const reply = await callNativeVault('saveVault', { blob: encodePayload(blob) });
        assertWriteAccepted(reply, 'saveVault');
    }

    async clear() {
        assertWriteAccepted(await callNativeVault('clearVault'), 'clearVault');
    }
}

/**
 * kdfParams and friends: small plaintext JSON, same shape and same role as
 * WebMetaBackend's localStorage record. It is not secret - it is the salt and
 * cost parameters - but it IS load-bearing, so it lives in native storage
 * rather than in the evictable WebView store.
 */
export class CapacitorMetaBackend {
    /** @returns {Promise<unknown | null>} */
    async load() {
        const reply = await callNativeVault('loadMeta');
        if (reply?.status === VaultStatus.ABSENT) return null;
        const bytes = decodeReadReply(reply, 'meta');
        if (bytes === null) return null;
        const text = new TextDecoder().decode(bytes);
        try {
            return JSON.parse(text);
        } catch (err) {
            // Unparseable meta is corruption, not absence. Reporting absence
            // here would tell the shell there is no wallet on a device whose
            // vault blob is sitting right next to it, intact.
            throw new VaultCorruptError(`native meta is not valid JSON: ${err?.message || err}`);
        }
    }

    /** @param {unknown} obj */
    async save(obj) {
        const bytes = new TextEncoder().encode(JSON.stringify(obj));
        const reply = await callNativeVault('saveMeta', { blob: encodePayload(bytes) });
        assertWriteAccepted(reply, 'saveMeta');
    }

    async clear() {
        assertWriteAccepted(await callNativeVault('clearMeta'), 'clearMeta');
    }
}

/**
 * A write either succeeded or it did not happen. Silence is not success:
 * without this check a plugin that returned LOCKED from a save would leave
 * the caller believing the vault had been persisted, and the next lock would
 * discard whatever was only ever in memory.
 *
 * @param {{ status?: string, detail?: string } | null | undefined} reply
 * @param {string} method
 */
function assertWriteAccepted(reply, method) {
    if (reply?.status === VaultStatus.OK) return;
    if (reply?.status === VaultStatus.LOCKED) {
        throw new coreStorage.VaultLockedError(reply.detail || `${method} refused: keystore locked`);
    }
    throw new VaultUnavailableError(
        `${method} did not confirm the write (status ${JSON.stringify(reply?.status)})`,
    );
}
