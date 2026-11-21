// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

const MAX_POINTS = 48;

export function watchChart(sparkline) {
    const source = Array.isArray(sparkline)
        ? sparkline.filter((point) => Number.isFinite(point) && point > 0)
        : [];
    if (source.length < 2) return null;

    let points = source;
    if (source.length > MAX_POINTS) {
        const averaged = [];
        const lastIndex = source.length - 1;
        for (let bucket = 0; bucket < MAX_POINTS - 1; bucket += 1) {
            const start = Math.floor((bucket * lastIndex) / (MAX_POINTS - 1));
            const end = Math.floor(((bucket + 1) * lastIndex) / (MAX_POINTS - 1));
            const values = source.slice(start, end);
            averaged.push(values.reduce((sum, value) => sum + value, 0) / values.length);
        }
        points = [...averaged, source[lastIndex]];
    }

    return { points, up: source.at(-1) >= source[0] };
}
