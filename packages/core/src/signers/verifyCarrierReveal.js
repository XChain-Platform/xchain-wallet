// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The spend of a data-carrier output: the second transaction of a two-phase
// action reveals the payload by spending a P2SH or P2WSH output whose redeem
// (or witness) script is exactly
//
//     <data push> OP_DROP OP_DUP OP_HASH160 <20-byte key hash> OP_EQUALVERIFY OP_CHECKSIG
//
// and whose spending data is `<signature> <pubkey> <script>`. The broadcast
// check verifies that shape and nothing wider: any other opcode, any other hash
// length and any other item count is not a carrier spend and stays refused.

import { checkSignature, hash160, isPubkey } from './verifyInputSignatures.js';

// OP_DROP OP_DUP OP_HASH160 <push 20> <20 bytes> OP_EQUALVERIFY OP_CHECKSIG.
const GATE_HEX_LENGTH = 52;

/** Bytes occupied by the leading data push of `hex`, or 0 when it is not one. */
function leadingPushLength(hex) {
    const byteAt = (p) => parseInt(hex.slice(p * 2, p * 2 + 2), 16);
    const total = hex.length / 2;
    const op = byteAt(0);
    let header;
    let size;
    if (op >= 0x01 && op <= 0x4b) {
        header = 1;
        size = op;
    } else if (op === 0x4c && total >= 2) {
        header = 2;
        size = byteAt(1);
    } else if (op === 0x4d && total >= 3) {
        header = 3;
        size = byteAt(1) | (byteAt(2) << 8);
    } else {
        return 0;
    }
    return size > 0 ? header + size : 0;
}

/**
 * The key hash a carrier script's spend gate checks, or null when the script is
 * not exactly a carrier script.
 *
 * @param {string} scriptHex
 * @returns {{ keyHash: string }|null}
 */
export function parseCarrierScript(scriptHex) {
    if (typeof scriptHex !== 'string' || !/^([0-9a-f]{2})+$/.test(scriptHex)) return null;
    const pushBytes = leadingPushLength(scriptHex);
    if (pushBytes === 0 || scriptHex.length !== pushBytes * 2 + GATE_HEX_LENGTH) return null;
    const gate = scriptHex.slice(pushBytes * 2);
    const m = /^7576a914([0-9a-f]{40})88ac$/.exec(gate);
    return m ? { keyHash: m[1] } : null;
}

/**
 * Check a carrier spend's items (the signature, then the public key) against the
 * script's key hash. Returns a reason, or null when they verify.
 *
 * @param {string[]} items        the spending data without the trailing script
 * @param {string} scriptHex      the redeem or witness script
 * @param {() => Uint8Array} digestFor  the digest the signature commits to
 * @param {number} wantSighash
 * @returns {string|null}
 */
export function checkCarrierSpend(items, scriptHex, digestFor, wantSighash) {
    const carrier = parseCarrierScript(scriptHex);
    if (!carrier) return 'the script is not a data-carrier script';
    if (!items || items.length !== 2) return 'a carrier spend is not <signature> <pubkey> <script>';
    const [sigHex, pubkeyHex] = items;
    if (!isPubkey(pubkeyHex) || hash160(pubkeyHex) !== carrier.keyHash) {
        return 'the public key does not own the carrier script';
    }
    return checkSignature(sigHex, pubkeyHex, digestFor, wantSighash);
}
