// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// fileSizeLimits (PC-28): encoding-aware upload ceilings for FILE
// publishes, replacing the flat "7000 bytes to be safe" guess.
//
// The real limit is consensus-side: every indexing decoder drops a
// transaction whose COMPILED ACTION push exceeds 8192 bytes
// (MAX_ACTION_DATA_LENGTH, xchain-documentation/protocol/constants.js),
// and the encoder enforces the same ceiling at encode time
// (MAX_COMPILED_ACTION_DATA_LENGTH, xchain-encoder/src/validator.js).
// The embedding (OP_RETURN vs P2SH vs P2WSH) changes how the push rides
// the transaction, not this ceiling; the encoder auto-selects P2SH for
// anything past the 80-byte OP_RETURN lane, so file-sized payloads are
// always measured against the compiled 8192.
//
// The compiled push is bitcoin.script.compile([actionString, rawData]):
// two data pushes, each with a minimal-push length prefix (1 byte under
// 76, 2 bytes through 255, 3 bytes through 65535). So the exact budget
// for file bytes is 8192 minus the action string's own compiled size
// minus the raw push's prefix - computable per upload from the file's
// metadata, which is what the helpers below do.
//
// The action-string mirrors here are pinned against the real SDK
// serializer and bitcoinjs compile in unit tests; if the SDK's
// FormatSelector ever changes its trailing-empty trim, the pinned
// strings in fileSizeLimits.test.js catch the drift.

/**
 * Compiled-push ceiling, in bytes. Canonical source of truth:
 * xchain-documentation/protocol/constants.js MAX_ACTION_DATA_LENGTH.
 */
export const MAX_COMPILED_ACTION_BYTES = 8192;

/**
 * AES-256-GCM envelope bytes prepended to gated ciphertext:
 * [iv 12][tag 16] (sdk.gatedFile.encryptWithKey layout).
 */
export const AES_GCM_ENVELOPE_BYTES = 28;

/**
 * Hex length of the ECIES key-handoff string riding the MESSAGE v2 leg
 * of a gated publish: version(1) + ephemeral pubkey(33) + iv(12) +
 * tag(16) + ct(33, the 0x01||K payload) = 95 bytes, hex-encoded.
 * Pinned against sdk.messaging.eciesEncryptBytes in unit tests.
 */
export const ECIES_HANDOFF_HEX_CHARS = 190;

/** KEY_HASH is always sha256 hex: 64 characters. */
export const KEY_HASH_HEX_CHARS = 64;

/**
 * Minimal-push length-prefix size for an n-byte data push, matching
 * bitcoinjs script.compile. (A 1-byte push of 0x00-0x10/0x81 compiles
 * to a single opcode; treating it as prefix+byte over-counts by one,
 * which only ever makes the limit conservative.)
 *
 * @param {number} n
 * @returns {number}
 */
export function pushPrefixSize(n) {
    if (n < 0x4c) return 1;
    if (n <= 0xff) return 2;
    if (n <= 0xffff) return 3;
    return 5;
}

/** @param {string} s @returns {number} UTF-8 byte length */
function utf8Bytes(s) {
    return new TextEncoder().encode(s == null ? '' : String(s)).length;
}

/**
 * Largest raw push that still fits a byte budget once its own length
 * prefix is counted.
 *
 * @param {number} budget
 * @returns {number}
 */
function maxRawWithin(budget) {
    for (let cand = Math.max(0, budget - 1); cand >= 0; cand -= 1) {
        if (cand + pushPrefixSize(cand) <= budget) return cand;
    }
    return 0;
}

/**
 * The serialized public FILE v0 action string for the given metadata,
 * mirroring the SDK's FormatSelector.serialize (trailing empty fields
 * trimmed, so an untitled/unmemoed file is just `FILE|0|NAME|TYPE`)
 * and fileAction's field normalization (NAME/TYPE/TITLE trimmed, MEMO
 * kept verbatim).
 *
 * @param {{ name: string, type: string, title?: string, memo?: string }} meta
 * @returns {string}
 */
export function publicFileActionString({ name, type, title, memo }) {
    const parts = [
        'FILE', '0',
        String(name ?? '').trim(),
        String(type ?? '').trim(),
        typeof title === 'string' ? title.trim() : '',
        typeof memo === 'string' ? memo : '',
    ];
    while (parts.length > 2 && parts[parts.length - 1] === '') parts.pop();
    return parts.join('|');
}

/**
 * Maximum raw file bytes for a PUBLIC FILE publish with this metadata.
 *
 * @param {{ name: string, type: string, title?: string, memo?: string }} meta
 * @returns {number}
 */
export function maxPublicFileBytes(meta) {
    const a = utf8Bytes(publicFileActionString(meta));
    return maxRawWithin(MAX_COMPILED_ACTION_BYTES - (a + pushPrefixSize(a)));
}

/**
 * The gated-publish BATCH action string for the given metadata, with
 * KEY_HASH and the ECIES handoff as fixed-width placeholders (their
 * real values are only known at compose time but their lengths never
 * vary). Mirrors flows/gatedPublishAction.js exactly: the FILE sub-
 * command joins all 8 fields (no trailing trim; KEY_HASH is last and
 * non-empty), and the MESSAGE v2 leg is self-addressed. When a PC-29
 * unlock threshold is being emitted (post-flag-day only), the FILE
 * sub-command carries GATE_MIN_AMOUNT as a ninth field and the budget
 * shrinks by its width.
 *
 * @param {{ name: string, type: string, title?: string, memo?: string,
 *           gateTicker: string, coin: string, address: string,
 *           gateMinAmount?: string | null }} meta
 * @returns {string}
 */
export function gatedBatchActionString({ name, type, title, memo, gateTicker, coin, address, gateMinAmount }) {
    const fileCmd = [
        'FILE', '0',
        String(name ?? '').trim(),
        String(type ?? '').trim(),
        typeof title === 'string' ? title.trim() : '',
        typeof memo === 'string' ? memo : '',
        String(gateTicker ?? '').trim().toUpperCase(),
        '1',
        'k'.repeat(KEY_HASH_HEX_CHARS),
        ...(gateMinAmount != null && String(gateMinAmount).length > 0
            ? [String(gateMinAmount)]
            : []),
    ].join('|');
    const messageCmd = [
        'MESSAGE', '2',
        String(coin ?? ''),
        String(address ?? ''),
        'e'.repeat(ECIES_HANDOFF_HEX_CHARS),
    ].join('|');
    return `BATCH|0|${fileCmd};${messageCmd}`;
}

/**
 * Maximum PLAINTEXT bytes for a gated publish with this metadata: the
 * compiled budget left for the ciphertext push, minus the AES-GCM
 * envelope the ciphertext carries.
 *
 * @param {{ name: string, type: string, title?: string, memo?: string,
 *           gateTicker: string, coin: string, address: string,
 *           gateMinAmount?: string | null }} meta
 * @returns {number}
 */
export function maxGatedPlaintextBytes(meta) {
    const a = utf8Bytes(gatedBatchActionString(meta));
    const maxCiphertext = maxRawWithin(MAX_COMPILED_ACTION_BYTES - (a + pushPrefixSize(a)));
    return Math.max(0, maxCiphertext - AES_GCM_ENVELOPE_BYTES);
}
