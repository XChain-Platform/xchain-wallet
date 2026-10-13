// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const sourceRoot = join(root, 'packages', 'core', 'src');
const allowed = new Set(['400px', '420px', '480px', '48rem', '520px', '600px', '640px', '1024px']);

function filesBelow(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
    });
}

const offScale = [];
for (const path of filesBelow(sourceRoot).filter((file) => file.endsWith('.module.css'))) {
    const source = readFileSync(path, 'utf8');
    for (const media of source.matchAll(/@media\s+([^\{]+)/g)) {
        const query = media[1];
        const widths = [
            ...query.matchAll(/(?:min-|max-)?width\s*:\s*([\d.]+(?:px|rem|em))\b/g),
            ...query.matchAll(/\bwidth\s*[<>=]+\s*([\d.]+(?:px|rem|em))\b/g),
            ...query.matchAll(/\b([\d.]+(?:px|rem|em))\s*[<>=]+\s*width\b/g),
        ].map((match) => match[1]);
        for (const width of widths) {
            if (!allowed.has(width)) offScale.push(`${relative(root, path)}: ${width}`);
        }
    }
}

assert.deepEqual(offScale, [], `off-scale CSS module media widths:\n${offScale.join('\n')}`);
console.log('OK: core CSS module media queries use only documented viewport widths');
