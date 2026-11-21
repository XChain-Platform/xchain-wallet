// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function cutAtWord(text, max) {
    if (typeof text !== 'string' || !Number.isInteger(max) || max <= 0) return '';

    const trimmed = text.trim();
    const codePoints = [...trimmed];
    if (codePoints.length <= max) return trimmed;

    const prefix = codePoints.slice(0, max - 1);
    const whitespaceIndex = prefix.findLastIndex((character) => /\s/u.test(character));
    const cut = whitespaceIndex === -1 ? prefix : prefix.slice(0, whitespaceIndex);

    return `${cut.join('').trimEnd()}…`;
}
