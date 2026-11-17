// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export const MULTIPART_WAVE_PIECES = 100;

export function multipartWaveCount(totalParts) {
    return Math.ceil((totalParts + 1) / MULTIPART_WAVE_PIECES);
}

export function multipartWaveRanges(totalParts) {
    return Array.from({ length: multipartWaveCount(totalParts) }, (_, index) => ({
        index,
        from: index * MULTIPART_WAVE_PIECES,
        to: Math.min(((index + 1) * MULTIPART_WAVE_PIECES) - 1, totalParts),
    }));
}

export function multipartTransactionCount(totalParts) {
    return multipartWaveCount(totalParts) + (2 * (totalParts + 1));
}
