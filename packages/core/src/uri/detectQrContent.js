// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// QR content detector (§32.2): classifies a scanned string into one of
// the shapes the wallet knows how to act on. First-match-wins; order
// is tuned so the specific formats (BIP21, xchain:, PSBT, WIF) are
// tried before the loose "probable address" fallback.
//
// This is string-level classification only (no network calls, no SDK).
// Callers receive the tentative type and are responsible for the final
// validation step (e.g., hand the address to `sdk.wallet.validateAddress`
// before spending to it).

import { decodeWif } from '../crypto/wif.js';
import { isValidBip39Mnemonic } from '../crypto/mnemonic.js';
import { isValidCounterwalletMnemonic } from '../crypto/counterwallet.js';
import { parseBip21Uri } from './bip21.js';
import { parseXcwChunk, XCW_PREFIX } from './psbtQr.js';

export const PSBT_HEX_PREFIX = '70736274ff';

/**
 * @typedef {(
 *   | { type: 'bip21', scheme: string, address: string, parts: import('./bip21.js').Bip21Parts }
 *   | { type: 'xchain-uri', parts: import('./bip21.js').Bip21Parts }
 *   | { type: 'psbt-hex', psbtHex: string }
 *   | { type: 'xcw-chunk', n: number, total: number, content: Uint8Array }
 *   | { type: 'wif', wif: string, decoded: ReturnType<typeof decodeWif> }
 *   | { type: 'mnemonic-bip39', mnemonic: string }
 *   | { type: 'mnemonic-counterwallet', mnemonic: string }
 *   | { type: 'address', address: string }
 *   | { type: 'unknown' }
 * )} QrContent
 */

/**
 * @typedef {Object} DetectOpts
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]   optional; used to recognize BIP21 schemes as chain URIs vs. generic unknown-scheme URIs
 */

/**
 * @param {string} input
 * @param {DetectOpts} [opts]
 * @returns {QrContent}
 */
export function detectQrContent(input, opts = {}) {
    if (typeof input !== 'string') return { type: 'unknown' };
    const raw = input.trim();
    if (raw.length === 0) return { type: 'unknown' };

    // --- Step 0: XCW chunked PSBT-over-QR (§20.3) ---
    // Matched before generic URI detection because `XCW:` with a BIP21
    // parser loosely applied would classify the chunk as a bip21 URI
    // with `xcw` scheme.
    if (raw.startsWith(XCW_PREFIX)) {
        try {
            const parsed = parseXcwChunk(raw);
            return {
                type: 'xcw-chunk',
                n: parsed.n,
                total: parsed.total,
                content: parsed.content,
            };
        } catch {
            // malformed XCW; fall through
        }
    }

    // --- Step 1: URI-like scheme:value ---
    const colonIdx = raw.indexOf(':');
    const looksLikeUri =
        colonIdx > 0 && /^[a-z][a-z0-9+.-]*$/i.test(raw.slice(0, colonIdx));
    if (looksLikeUri) {
        const scheme = raw.slice(0, colonIdx).toLowerCase();
        if (scheme === 'xchain') {
            try {
                const parts = parseBip21Uri(raw);
                return { type: 'xchain-uri', parts };
            } catch {
                // fall through to unknown
            }
        } else {
            // Is this a known chain's BIP21 URI?
            const knownSchemes = new Set(
                (opts.chainRegistry?.supportedChains() ?? []).map(
                    (d) => d.uriScheme,
                ),
            );
            if (knownSchemes.has(scheme) || !opts.chainRegistry) {
                try {
                    const parts = parseBip21Uri(raw);
                    if (opts.chainRegistry && !knownSchemes.has(scheme)) {
                        // Unknown scheme; not BIP21-compliant for this wallet.
                    } else {
                        return {
                            type: 'bip21',
                            scheme,
                            address: parts.address,
                            parts,
                        };
                    }
                } catch {
                    // fall through
                }
            }
        }
    }

    // --- Step 2: PSBT hex ---
    if (isHex(raw) && raw.toLowerCase().startsWith(PSBT_HEX_PREFIX)) {
        return { type: 'psbt-hex', psbtHex: raw.toLowerCase() };
    }

    // --- Step 3: WIF (base58check-decodable with 33- or 34-byte payload) ---
    try {
        const decoded = decodeWif(raw);
        return { type: 'wif', wif: raw, decoded };
    } catch {
        // not a WIF
    }

    // --- Step 4: BIP39 mnemonic (whitespace + case normalized first) ---
    const normalized = raw.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
    const wordCount = normalized.split(' ').length;
    if (wordCount >= 12 && isValidBip39Mnemonic(normalized)) {
        return { type: 'mnemonic-bip39', mnemonic: normalized };
    }

    // --- Step 5: Counterwallet legacy mnemonic (always 12 words) ---
    if (wordCount === 12 && isValidCounterwalletMnemonic(normalized)) {
        return { type: 'mnemonic-counterwallet', mnemonic: normalized };
    }

    // --- Step 6: Loose address heuristic ---
    // Single token, no colons / slashes / whitespace, length 20–90.
    // Covers p2pkh (base58, ~26–35), p2sh (~34), bech32 p2wpkh (~39–42),
    // bech32m p2tr (~62). Beyond that the caller validates.
    if (
        !/\s/.test(raw) &&
        raw.length >= 20 &&
        raw.length <= 90 &&
        /^[a-zA-Z0-9]+$/.test(raw)
    ) {
        return { type: 'address', address: raw };
    }

    return { type: 'unknown' };
}

function isHex(s) {
    return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}
