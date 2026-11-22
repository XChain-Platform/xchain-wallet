// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { base64urlnopad } from '@scure/base';

export const CALLBACK_BODY_MAX_BYTES = 10240;

export function mintClaim(
    randomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length)),
) {
    return base64urlnopad.encode(randomBytes(16));
}

export function callbackBodyFits(body) {
    return new TextEncoder().encode(JSON.stringify(body)).length <= CALLBACK_BODY_MAX_BYTES;
}
