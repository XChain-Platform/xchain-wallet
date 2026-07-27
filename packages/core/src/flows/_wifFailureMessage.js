// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Internal: plain-language copy for a rejected WIF private key.
//
// D-64. The SDK rejects a bad key in library terms ("Failed to import WIF:
// Non-base58 character", "WIF key does not match configured network") and
// both import lanes rendered whatever they caught, verbatim, in front of the
// user. Same class as , which rewrote the recovery-phrase lane's copy
// and left the two key lanes alone.
//
// The classification lives at the flow layer, not in the form, because the
// error crosses the shell messaging boundary as a bare string: by the time
// the popup sees it, the error class and the SDK's code are gone and only
// `message` survives. It is shared by importWif (add a key to an HD wallet)
// and importSingleWif (onboard a wif-only wallet) so the two screens cannot
// describe the same rejection differently.

/**
 * @param {string} reason  the underlying library / SDK message
 * @param {string} [code]  the SDK error code, when one survived
 * @returns {string} plain-language copy naming what the user can check
 */
export function wifFailureMessage(reason, code) {
    const hay = `${code || ''} ${reason || ''}`.toLowerCase();
    if (/network_mismatch|does not match configured network|invalid network/.test(hay)) {
        // The single most likely mistake, and the one worth naming: a mainnet
        // key pasted on a testnet or regtest chain, or the reverse. Without
        // it the user re-checks a key that is perfectly good.
        return 'That private key is for a different network. Pick the chain the key belongs to, or paste a key for this chain.';
    }
    if (/non-base58|checksum|invalid character|invalid length|expected|version|malformed/.test(hay)) {
        return 'That is not a valid private key. Check for a typo, a missing character, or extra text pasted with it.';
    }
    if (/required|empty|must be a string/.test(hay)) {
        return 'Paste a WIF private key.';
    }
    return 'That private key could not be read. Paste the WIF exactly as your other wallet shows it.';
}
