// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

export const VISUAL_REPORT_GENERATOR = 'visual-compare';

/** True when the layout measurements used by the visual gate are equal. */
export function matchingLayoutMetrics(baseline, candidate) {
    if (!baseline || !candidate || baseline.error || candidate.error) return false;
    if (!Number.isFinite(baseline.docScrollX) || !Number.isFinite(candidate.docScrollX)) return false;
    if (!Number.isFinite(baseline.docScrollY) || !Number.isFinite(candidate.docScrollY)) return false;
    return baseline.docScrollX === candidate.docScrollX
        && baseline.docScrollY === candidate.docScrollY
        && (baseline.header?.h ?? null) === (candidate.header?.h ?? null)
        && JSON.stringify(baseline.scrollers || []) === JSON.stringify(candidate.scrollers || []);
}

/** Removes noise-floor images and returns the retained PNG paths. */
export function pruneReportRows(rows, { keepAll = false, threshold = 0.5 } = {}) {
    const retained = new Set();
    let pruned = 0;
    for (const row of rows) {
        const files = [row.baseline, row.candidate, row.diff].filter(Boolean);
        const prune = !keepAll
            && Number.isFinite(row.percent)
            && row.percent < threshold
            && matchingLayoutMetrics(row.baselineMetrics, row.candidateMetrics);
        row.pruned = prune;
        if (prune) {
            for (const file of files) {
                if (existsSync(file)) unlinkSync(file);
            }
            pruned += 1;
        } else {
            for (const file of files) retained.add(file);
        }
    }
    return { pruned, retained: [...retained] };
}

/** Losslessly rewrites retained PNGs when sharp is available in this install. */
export async function optimizePngs(files) {
    let sharp;
    try {
        ({ default: sharp } = await import('sharp'));
    } catch {
        return { optimizer: null, optimized: 0, bytesSaved: 0, failed: 0 };
    }

    let optimized = 0;
    let bytesSaved = 0;
    let failed = 0;
    for (const file of files) {
        if (!existsSync(file)) continue;
        try {
            const before = readFileSync(file);
            const after = await sharp(before).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
            if (after.length < before.length) {
                writeFileSync(file, after);
                bytesSaved += before.length - after.length;
            }
            optimized += 1;
        } catch {
            failed += 1;
        }
    }
    return { optimizer: 'sharp', optimized, bytesSaved, failed };
}
