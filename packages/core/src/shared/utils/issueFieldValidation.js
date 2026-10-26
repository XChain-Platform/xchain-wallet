// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The one place the wallet decides what the issue, wizard and admin forms may
// put in MAX_SUPPLY and DESCRIPTION. Each check names its cause beside the
// field; left to the SDK or the indexer the refusal reaches the user as a
// generic failure on the confirm step, or after the fee is spent.

import { compareDecimalStrings } from './amountFormat.js';

// The indexer's MAX_TOKEN_SUPPLY, one sextillion, mirrored by the SDK
// validator (MAX_SUPPLY_CEILING), in display units.
export const MAX_TOKEN_SUPPLY = '1000000000000000000000';

// The indexer refuses a DESCRIPTION of 250 UTF-16 code units or more
// (MAX_TOKEN_DESCRIPTION), so the longest accepted text is 249 units, which is
// also what a field's maxLength counts. A collectible's image URL is stored in
// DESCRIPTION and shares the limit.
export const MAX_ISSUE_TEXT_LENGTH = 249;

export function issueSupplyLimitError(value, noun = 'Supply') {
    return compareDecimalStrings(String(value ?? '').trim(), MAX_TOKEN_SUPPLY) === 1
        ? `${noun} cannot be more than 1,000,000,000,000,000,000,000.`
        : null;
}

export function issueTextLengthError(value, noun) {
    return String(value ?? '').trim().length > MAX_ISSUE_TEXT_LENGTH
        ? `${noun} cannot be longer than ${MAX_ISSUE_TEXT_LENGTH} characters.`
        : null;
}

// The wire is pipe-delimited and BATCH is semicolon-delimited, so the SDK
// refuses either character in DESCRIPTION.
export function issueDescriptionError(value, noun = 'Description') {
    const text = String(value ?? '').trim();
    if (/[|;]/.test(text)) return `${noun} cannot contain | or ; characters.`;
    return issueTextLengthError(text, noun);
}

// The wallet draws artwork only from an http(s), ipfs:// or ar: address
// (flows/tokenInfo.js normalizeMediaUrl); any other text would be locked
// on-chain beside a token whose artwork can never show.
export function issueImageUrlError(value) {
    const url = String(value ?? '').trim();
    const textError = issueDescriptionError(url, 'Image URL');
    if (textError) return textError;

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
