// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { base64urlnopad } from '@scure/base';
import { URI_MAX_LENGTH } from '../uri/bip21.js';

export function buildReturnUrl(returnUrl, payload, { maxLength = URI_MAX_LENGTH } = {}) {
    if (typeof returnUrl !== 'string' || returnUrl.includes('#')) {
        throw new TypeError('returnUrl must be a string without a fragment');
    }
    if (typeof payload?.id !== 'string' || payload.id.length === 0) {
        throw new TypeError('payload.id must be a non-empty string');
    }
    if (typeof payload.claim !== 'string' || payload.claim.length === 0) {
        throw new TypeError('payload.claim must be a non-empty string');
    }

    const encode = (value) => base64urlnopad.encode(
        new TextEncoder().encode(JSON.stringify(value)),
    );
    const fullPayload = {
        v: payload.v,
        id: payload.id,
        method: payload.method,
        ok: payload.ok,
        result: payload.result,
        error: payload.error,
        state: payload.state,
        claim: payload.claim,
    };
    const fullUrl = `${returnUrl}#xchain=${encode(fullPayload)}`;
    if (fullUrl.length <= maxLength) return { url: fullUrl, full: true };

    const shortUrl = `${returnUrl}#xchain=${encode({
        id: payload.id,
        ok: payload.ok,
        claim: payload.claim,
    })}`;
    if (shortUrl.length > maxLength) {
        throw new TypeError('return URL exceeds maxLength in short form');
    }
    return { url: shortUrl, full: false };
}
