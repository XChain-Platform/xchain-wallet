// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// encoderFieldMatch: the encoder refusal spellings encoderFieldErrors.js turns
// into field sentences, and a formatting-free check for whether one applies, so
// encoderErrorCode.js can ask without pulling the amount and fee formatters in.

export const RATE_BELOW_RELAY_RE = /feePerKb (\d+) base units\/kB produces fee (\d+), below the node relay minimum (\d+) base units for a ~(\d+)-byte transaction/;
export const FEE_BELOW_RELAY_RE = /(?:^|[\s:])fee (\d+) is below the node relay minimum (\d+) base units for a ~(\d+)-byte transaction/;
export const INSUFFICIENT_RE = /insufficient funds: selected inputs total (\d+) but (\d+) is required \(outputs (\d+) \+ fee (\d+)(?:, raised from the requested fee \d+)?\)(.*)$/s;

/**
 * True when encoderFieldError would answer with a field sentence for this error.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function hasEncoderFieldError(err) {
    const raw = err && typeof err === 'object'
        ? /** @type {any} */ (err).message
        : (typeof err === 'string' ? err : '');
    const text = String(raw || '');
    if (!text) return false;
    const rate = RATE_BELOW_RELAY_RE.exec(text);
    if (rate) return Number(rate[4]) > 0;
    if (FEE_BELOW_RELAY_RE.test(text)) return true;
    const short = INSUFFICIENT_RE.exec(text);
    return Boolean(short) && !/reserved/i.test(short[5] || '');
}
