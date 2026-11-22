// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cutAtWord } from './buildWatchDetail.js';

export function newWatchRequestId(
    fillRandom = (bytes) => globalThis.crypto.getRandomValues(bytes),
) {
    const bytes = new Uint8Array(16);
    fillRandom(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function watchRequestFrom(
    { kind, sentence, amountText, iconHash = '', expiresAt },
    { newId = newWatchRequestId } = {},
) {
    if (kind !== 'request' && kind !== 'paydue') return null;
    if (typeof sentence !== 'string' || !sentence.trim()) return null;
    if (typeof amountText !== 'string') return null;
    if (kind === 'paydue' && (!Number.isInteger(expiresAt) || expiresAt < 0)) return null;

    return {
        id: newId(),
        kind,
        iconHash: typeof iconHash === 'string' ? iconHash : '',
        sentence: cutAtWord(sentence, 200),
        amountText: amountText.trim(),
        ...(kind === 'paydue' ? { expiresAt } : {}),
    };
}
