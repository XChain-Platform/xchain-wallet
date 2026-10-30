// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A form's result screen comes from ResultScreen. The two older result
// components (a warning-bordered queued card and a card-plus-section watcher
// panel) drew unrelated looks for the same moment, so no file imports either
// one again. ALLOWLIST holds the files that could not move, each with its
// reason; it only ever shrinks.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const OLD_RESULT_COMPONENT = /\b(?:Queued|Watcher)ResultPanel\b/;
const WATCHER_EXPORT_IMPORT = /from\s+'[^']*\/WatcherExport\.jsx'/;

/** @type {Record<string, string>} source file path to the reason it still imports an old result component */
const ALLOWLIST = {};
const ALLOWLIST_CEILING = 0;

function sourceFiles() {
    const out = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'packages/*/src/**/*.jsx', 'packages/*/src/**/*.js'], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
}

describe('result screens use ResultScreen', () => {
    it('keeps neither old result component in the tree', () => {
        for (const name of ['QueuedResultPanel', 'WatcherResultPanel']) {
            for (const ext of ['jsx', 'module.css']) {
                expect(existsSync(join(ROOT, `packages/core/src/shared/components/${name}.${ext}`)), `${name}.${ext}`).toBe(false);
            }
        }
    });

    it('has no file importing an old result component outside the allowlist', () => {
        const offenders = sourceFiles().filter((file) => {
            if (Object.hasOwn(ALLOWLIST, file)) return false;
            const text = readFileSync(join(ROOT, file), 'utf8');
            return text.split('\n').some((line) => /^\s*import\b/.test(line) && OLD_RESULT_COMPONENT.test(line));
        });
        expect(offenders).toEqual([]);
    });

    it('lets the allowlist only shrink and keeps a reason on every entry', () => {
        expect(Object.keys(ALLOWLIST).length).toBeLessThanOrEqual(ALLOWLIST_CEILING);
        for (const [file, reason] of Object.entries(ALLOWLIST)) {
            expect(reason.length, file).toBeGreaterThan(10);
            expect(existsSync(join(ROOT, file)), file).toBe(true);
        }
    });

    it('keeps the unsigned export body behind ResultScreen', () => {
        const importers = sourceFiles().filter((file) => (
            !file.endsWith('/ResultScreen.jsx')
            && WATCHER_EXPORT_IMPORT.test(readFileSync(join(ROOT, file), 'utf8'))
        ));
        expect(importers).toEqual([]);
    });
});
