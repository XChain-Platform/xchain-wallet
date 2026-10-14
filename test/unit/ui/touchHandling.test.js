// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = readFileSync(join(root, 'packages/core/src/ui/tokens.css'), 'utf8');
const devBadge = readFileSync(
    join(root, 'packages/web/src/DevVariantBadge.module.css'),
    'utf8',
);

describe('touch handling CSS', () => {
    it('gives buttons and semantic tappable rows immediate taps', () => {
        const rule = /:where\(([\s\S]*?)\)\s*\{\s*touch-action:\s*manipulation;\s*\}/.exec(tokens);

        expect(rule).not.toBeNull();
        for (const selector of [
            'button',
            "input[type='button']",
            'a[href]',
            "[role='button']",
            "[role='tab']",
            "[role='menuitem']",
            "[role='option']",
        ]) {
            expect(rule[1]).toContain(selector);
        }
    });

    it('contains every scroll boundary inside a dialog', () => {
        expect(tokens).toMatch(
            /:where\(\[role='dialog'\], \[role='dialog'\] \*\)\s*\{\s*overscroll-behavior:\s*contain;\s*\}/,
        );
    });

    it('keeps pinch zoom available over the draggable dev badge grip', () => {
        expect(devBadge).toMatch(/\.grip\s*\{[\s\S]*?touch-action:\s*pinch-zoom;/);
        expect(devBadge).not.toMatch(/touch-action:\s*none/);
    });
});
