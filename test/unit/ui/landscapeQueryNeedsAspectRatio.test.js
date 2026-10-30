// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A portrait phone with its keyboard open is 360 wide by about 317 tall: wider
// than it is tall, so `orientation: landscape` matches. Every short-landscape
// rule therefore also needs a landscape aspect ratio, or opening the keyboard
// swaps the page chrome into its landscape layout.

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

describe('short-landscape media queries', () => {
    it('all require a landscape aspect ratio', () => {
        const files = execFileSync(
            'git',
            ['-C', root, 'grep', '-l', 'max-height: 480px', '--', 'packages/core/src'],
            { encoding: 'utf8' },
        ).split('\n').filter((f) => f.endsWith('.css'));
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const css = readFileSync(join(root, file), 'utf8');
            for (const line of css.split('\n')) {
                if (line.includes('orientation: landscape') && line.includes('max-height: 480px')) {
                    expect(line, file).toContain('min-aspect-ratio: 3/2');
                }
            }
        }
    });
});
