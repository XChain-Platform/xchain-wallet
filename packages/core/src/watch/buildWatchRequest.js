// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function newWatchRequestId(
    fillRandom = (bytes) => globalThis.crypto.getRandomValues(bytes),
) {
    const bytes = new Uint8Array(16);
    fillRandom(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
