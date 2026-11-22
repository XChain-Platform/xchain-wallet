// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';

const LANDSCAPE_PATTERN = /\borientation\s*:\s*landscape\b/i;
const MAX_HEIGHT_PATTERN = /\bmax-height\s*:\s*(\d+(?:\.\d+)?)px\b/i;
const MIN_ASPECT_PATTERN = /\bmin-aspect-ratio\s*:\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/i;

export function parseShortLandscapeQuery(text) {
    const prelude = String(text).split('{', 1)[0];
    if (!/^\s*@media\b/i.test(prelude) || !LANDSCAPE_PATTERN.test(prelude)) return null;

    const maxHeightMatch = prelude.match(MAX_HEIGHT_PATTERN);
    if (!maxHeightMatch) return null;

    const aspectMatch = prelude.match(MIN_ASPECT_PATTERN);
    let minAspect;
    if (aspectMatch) {
        const numerator = Number(aspectMatch[1]);
        const denominator = aspectMatch[2] === undefined ? 1 : Number(aspectMatch[2]);
        if (numerator > 0 && denominator > 0) minAspect = numerator / denominator;
    }

    return { maxHeight: Number(maxHeightMatch[1]), minAspect };
}

export function matchesShortLandscape({ width, height }, parsed) {
    return width > height
        && height <= parsed.maxHeight
        && (parsed.minAspect === undefined || width / height >= parsed.minAspect);
}

export function listShortLandscapeQueries(root) {
    const output = execFileSync(
        'git',
        ['-C', root, 'grep', '-n', '-E', 'orientation:[[:space:]]*landscape', '--', 'packages/core/src'],
        { encoding: 'utf8' },
    );

    return output.split('\n').flatMap((entry) => {
        const match = entry.match(/^(.+):(\d+):(.*)$/);
        if (!match || !match[1].endsWith('.css') || !parseShortLandscapeQuery(match[3])) return [];
        return [{ file: match[1], line: Number(match[2]), query: match[3] }];
    });
}
