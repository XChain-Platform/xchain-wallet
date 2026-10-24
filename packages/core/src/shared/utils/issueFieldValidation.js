// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { compareDecimalStrings } from './amountFormat.js';

export const MAX_TOKEN_SUPPLY = '1000000000000000000000';
export const MAX_ISSUE_TEXT_LENGTH = 250;

export function issueSupplyLimitError(value, noun = 'Supply') {
    return compareDecimalStrings(String(value ?? '').trim(), MAX_TOKEN_SUPPLY) === 1
        ? `${noun} cannot exceed ${MAX_TOKEN_SUPPLY}.`
        : null;
}

export function issueTextLengthError(value, noun) {
    return String(value ?? '').trim().length > MAX_ISSUE_TEXT_LENGTH
        ? `${noun} cannot be longer than ${MAX_ISSUE_TEXT_LENGTH} characters.`
        : null;
}

export function issueImageUrlError(value) {
    const url = String(value ?? '').trim();
    const lengthError = issueTextLengthError(url, 'Image URL');
    if (lengthError) return lengthError;

    if (/^ipfs:\/\/[A-Za-z0-9]+(?:\/[^\s]*)?$/i.test(url)) return null;
    if (/^ar:[^\s]+$/i.test(url)) return null;
    try {
        const parsed = new URL(url);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
            return null;
        }
    } catch {
        // The shared message below covers malformed URLs and unsafe schemes.
    }
    return 'Image URL must use http, https, ipfs, or ar.';
}
