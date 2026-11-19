// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sharedRoot = join(root, 'packages/core/src/shared');
// The History filter was the one exception; it now draws the shared network
// filter inside the title-line filter menu, so no file may use ChainPicker.
const exceptions = new Set([]);

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.jsx$/.test(entry.name) ? [path] : [];
    });
}

describe('network field control', () => {
    it('uses NetworkField for every shared network choice outside the History filter exception', () => {
        const offenders = sourceFiles(sharedRoot).flatMap((path) => {
            const rel = relative(sharedRoot, path).replaceAll('\\', '/');
            if (exceptions.has(rel)) return [];
            const source = readFileSync(path, 'utf8');
            return [...source.matchAll(/<ChainPicker\b[\s\S]*?\/>/g)].flatMap((match) => {
                const line = source.slice(0, match.index).split('\n').length;
                return [`${rel}:${line}`];
            });
        });

        expect(offenders).toEqual([]);
    });

    it('keeps the exceptions explicit and converts Link action network fields', () => {
        for (const rel of exceptions) {
            expect(readFileSync(join(sharedRoot, rel), 'utf8')).toMatch(/<ChainPicker\b/);
        }
        const link = readFileSync(join(sharedRoot, 'routes/LinkForm.jsx'), 'utf8');
        expect(link).not.toMatch(/<ChainPicker\b/);
        // The form network comes from the standard From section; the one ActionCard
        // field drawn for Action 1 and Action 2 is the only NetworkField left here.
        expect(link).toMatch(/<FromSection\b/);
        expect(link.match(/<NetworkField\b/g) || []).toHaveLength(1);
    });
});
