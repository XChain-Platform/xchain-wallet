/*
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 */

package io.xchain.wallet.android.vault;

/**
 * The four answers a vault read can give ( §1 blob-lifecycle contract).
 *
 * They are four and not two on purpose. ABSENT is a claim about the device -
 * the JS side turns it straight into the create-a-new-wallet screen - so
 * every other outcome has to be able to say something else. A keystore that
 * is momentarily unavailable (LOCKED) and a file that failed its integrity
 * check (CORRUPT) are both recoverable situations where the user still has a
 * wallet; reporting either as "no wallet here" invites them to make a new one
 * on top of it.
 *
 * The enum names are the wire values: `nativeVault.js` switches on exactly
 * these strings, and its default branch refuses anything it does not know
 * rather than treating it as absence.
 */
public final class VaultReadResult {

    public enum Kind { ABSENT, OK, LOCKED, CORRUPT }

    public final Kind kind;
    /** Non-null only for OK. */
    public final byte[] payload;
    /** Human-readable context for LOCKED / CORRUPT; may be null. */
    public final String detail;

    private VaultReadResult(Kind kind, byte[] payload, String detail) {
        this.kind = kind;
        this.payload = payload;
        this.detail = detail;
    }

    public static VaultReadResult absent() {
        return new VaultReadResult(Kind.ABSENT, null, null);
    }

    public static VaultReadResult ok(byte[] payload) {
        return new VaultReadResult(Kind.OK, payload, null);
    }

    public static VaultReadResult locked(String detail) {
        return new VaultReadResult(Kind.LOCKED, null, detail);
    }

    public static VaultReadResult corrupt(String detail) {
        return new VaultReadResult(Kind.CORRUPT, null, detail);
    }

    public boolean isReadable() {
        return kind == Kind.OK || kind == Kind.ABSENT;
    }
}
