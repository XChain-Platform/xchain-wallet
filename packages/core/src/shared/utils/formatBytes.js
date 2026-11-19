// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet's one byte-size formatter. Sizes read in KB below one MB and
// MB from there, never raw bytes, base 1024, one decimal at most with a
// trailing ".0" dropped ("256 KB", "7.9 KB", "1 MB"). A limit rounds DOWN,
// so "up to 7.9 KB" never promises room the chain does not have; anything
// else (a file's or a message's own size) rounds UP, so a size just over a
// limit never reads as fitting under it.

const KB = 1024;
const MB = 1024 * 1024;

/**
 * @param {number} bytes
 * @param {{ limit?: boolean }} [opts]  limit: a ceiling, rounded down; else a size, rounded up
 * @returns {string}
 */
export function formatBytes(bytes, { limit = false } = {}) {
    const raw = Number(bytes);
    const n = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const unit = n >= MB ? MB : KB;
    const label = unit === MB ? 'MB' : 'KB';
    const round = limit ? Math.floor : Math.ceil;
    // Tenths of a unit; n * 10 / a power of two is exact, so the rounding
    // never trips on float noise.
    const tenths = round((n * 10) / unit);
    // A non-empty size never reads as 0 KB.
    const value = (n > 0 && tenths === 0 ? 1 : tenths) / 10;
    return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${label}`;
}

/** True once `used` reaches 80% of `limit`; counters stay hidden until then. */
export function reachedEightyPercent(used, limit) {
    return Number(limit) > 0 && Number(used) >= Number(limit) * 0.8;
}
