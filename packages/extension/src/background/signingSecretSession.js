// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Signing-secret session slot — the enabler for "password only at unlock".
//
// The MV3 background is a service worker Chrome can terminate at any time.
// The session master key survives in chrome.storage.session, but the
// in-memory SignerPool does not — and the master key alone CANNOT rebuild
// the pool, because each wallet's seed is encrypted under a password-derived
// key (its own kdfParams), not under the vault master key.
//
// So to keep the wallet able to sign for the whole unlocked session
// (including after a service-worker restart), we cache the password in a
// dedicated chrome.storage.session slot at unlock/create/import and use it
// to re-populate the SignerPool in `ensureHost`. It is cleared on lock.
//
// SECURITY: this is a deliberate posture change (see the wallet auth plan).
// chrome.storage.session is in-memory, per-browser-session, and not
// page-accessible, but it now holds a signing-capable secret. The window is
// bounded by explicit lock, the idle auto-lock, and browser close (which
// wipes session storage). Flagged for the external security audit, which may
// prefer caching the per-wallet unlocked seed instead of the password.
//
// Extension-only: desktop's main process and the web page persist for the
// whole session, so their pools stay populated without this slot.

const SIGNING_SECRET_ENCODER = new TextEncoder();
const SIGNING_SECRET_DECODER = new TextDecoder();

/** chrome.storage.session key for the cached signing secret (the password). */
export const SIGNING_SECRET_SESSION_KEY = 'xchain-wallet:session-signing-secret';

/**
 * Persist the password to the signing-secret session slot. No-op when the
 * backend is absent (e.g. the desktop pre-host path, which doesn't need it).
 *
 * @param {{ save: (blob: Uint8Array) => Promise<void> } | undefined | null} backend
 * @param {string} password
 */
export async function saveSigningSecret(backend, password) {
    if (!backend || typeof password !== 'string' || password.length === 0) return;
    await backend.save(SIGNING_SECRET_ENCODER.encode(password));
}

/**
 * Read the cached password, or null when none is stored.
 *
 * @param {{ load: () => Promise<Uint8Array | null> } | undefined | null} backend
 * @returns {Promise<string | null>}
 */
export async function loadSigningSecret(backend) {
    if (!backend) return null;
    const bytes = await backend.load();
    return bytes ? SIGNING_SECRET_DECODER.decode(bytes) : null;
}

/**
 * Clear the cached signing secret (on lock / teardown). No-op when absent.
 *
 * @param {{ clear: () => Promise<void> } | undefined | null} backend
 */
export async function clearSigningSecret(backend) {
    if (!backend) return;
    await backend.clear();
}
