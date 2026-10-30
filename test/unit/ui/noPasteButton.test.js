// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceFiles = execFileSync('git', ['ls-files', '-z', '--', 'packages'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => /^packages\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/.test(file));

const exactPasteLabel = /<(?:button|Button)\b[^>]*(?:aria-label|title|label)\s*=\s*["']Paste(?: from clipboard)?["'][^>]*>/i;
const exactPasteContent = /<(?:button|Button)\b[^>]*>\s*Paste\s*<\/(?:button|Button)>/i;

describe('Paste button source guard', () => {
    it('keeps wallet source free of Paste button imports and renders', () => {
        const violations = sourceFiles.flatMap((file) => {
            const source = readFileSync(file, 'utf8');
            return source.includes('ClipboardPasteButton')
                || exactPasteLabel.test(source)
                || exactPasteContent.test(source)
                ? [file]
                : [];
        });

        expect(violations).toEqual([]);
    });
});
