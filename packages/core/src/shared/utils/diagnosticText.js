// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isValidBip39Mnemonic } from '../../crypto/mnemonic.js';

export const REDACTED_DIAGNOSTIC_VALUE = '[REDACTED]';
export const DIAGNOSTIC_TEXT_LIMIT = 2000;

const PHRASE_VALUE_RE = /(\b(?:mnemonic|seed[ _-]?phrase|recovery[ _-]?phrase|passphrase)\b["']?\s*[:=]\s*)(?!["'])[^\r\n]+/gi;
const LABELED_VALUE_RE = /(\b(?:address(?:es)?|balance(?:s)?|password|passphrase|mnemonic|seed[ _-]?phrase|recovery[ _-]?phrase|private[ _-]?key|secret[ _-]?key|wif|xprv)\b["']?\s*[:=]\s*)(\{[^{}\r\n]*\}|\[[^\]\r\n]*\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi;
const PRIVATE_KEY_RE = /\b(?:0x)?[a-f0-9]{64}\b/gi;
const EXTENDED_PRIVATE_KEY_RE = /\b(?:xprv|tprv|yprv|zprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/g;
const WIF_RE = /\b(?:5[HJK][1-9A-HJ-NP-Za-km-z]{49}|[KL][1-9A-HJ-NP-Za-km-z]{51})\b/g;
const BECH32_ADDRESS_RE = /\b(?:bc|tb|bcrt|ltc|tltc|rltc)1[ac-hj-np-z02-9]{11,87}\b/gi;
const EVM_ADDRESS_RE = /\b0x[a-f0-9]{40}\b/gi;
const BASE58_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{26,44}\b/g;
const BIP39_WORD_RE = /[a-z]+/gi;
const BIP39_WORD_COUNTS = [24, 21, 18, 15, 12];

function redactLabeledValue(_match, prefix, value) {
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${prefix}${quote}${REDACTED_DIAGNOSTIC_VALUE}${quote}`;
}

function redactBip39Phrases(value) {
    const words = Array.from(value.matchAll(BIP39_WORD_RE));
    let cursor = 0;
    let output = '';

    for (let index = 0; index < words.length; index += 1) {
        const start = words[index].index;
        if (start < cursor) continue;
        for (const count of BIP39_WORD_COUNTS) {
            const last = words[index + count - 1];
            if (!last) continue;
            const end = last.index + last[0].length;
            const candidate = value.slice(start, end);
            if (!/^[a-z]+(?:\s+[a-z]+)+$/i.test(candidate)) continue;
            if (!isValidBip39Mnemonic(candidate.toLowerCase())) continue;
            output += value.slice(cursor, start) + REDACTED_DIAGNOSTIC_VALUE;
            cursor = end;
            break;
        }
    }

    return output + value.slice(cursor);
}

/**
 * Remove wallet-identifying and secret values before diagnostic text reaches
 * the DOM or clipboard.
 *
 * `keepAddresses` leaves public addresses readable for a list of recipients
 * the user typed into the current screen; keys, phrases and labeled secrets
 * are still removed.
 *
 * @param {unknown} value
 * @param {{ limit?: number, keepAddresses?: boolean }} [opts]
 * @returns {string}
 */
export function redactDiagnosticText(value, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0
        ? opts.limit
        : DIAGNOSTIC_TEXT_LIMIT;
    const input = String(value ?? '').slice(0, limit + 512);
    const secretsRemoved = input
        .replace(PHRASE_VALUE_RE, `$1${REDACTED_DIAGNOSTIC_VALUE}`)
        .replace(LABELED_VALUE_RE, redactLabeledValue)
        .replace(EXTENDED_PRIVATE_KEY_RE, REDACTED_DIAGNOSTIC_VALUE)
        .replace(WIF_RE, REDACTED_DIAGNOSTIC_VALUE)
        .replace(PRIVATE_KEY_RE, REDACTED_DIAGNOSTIC_VALUE);
    const redacted = redactBip39Phrases(opts.keepAddresses
        ? secretsRemoved
        : secretsRemoved
            .replace(BECH32_ADDRESS_RE, REDACTED_DIAGNOSTIC_VALUE)
            .replace(EVM_ADDRESS_RE, REDACTED_DIAGNOSTIC_VALUE)
            .replace(BASE58_ADDRESS_RE, REDACTED_DIAGNOSTIC_VALUE));

    return redacted.length > limit
        ? `${redacted.slice(0, limit)} [truncated]`
        : redacted;
}
