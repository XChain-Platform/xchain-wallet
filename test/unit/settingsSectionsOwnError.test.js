// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A settings section that renders its own save error must mount useSettings
// with reportsOwnError, or one refused save shows a toast and an inline error.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../packages/core/src/shared/components/settings');
const sections = readdirSync(dir).filter((f) => f.endsWith('.jsx'));

describe('settings sections that render their own save error', () => {
    for (const file of sections) {
        const src = readFileSync(join(dir, file), 'utf8');
        const usesHook = /useSettings\(/.test(src);
        const rendersOwnSaveError = /\bsaveErrors?\b/.test(src);
        if (!usesHook || !rendersOwnSaveError) continue;
        it(`${file} passes reportsOwnError`, () => {
            expect(src).toMatch(/useSettings\(\{[^}]*reportsOwnError:\s*true/);
        });
    }
    it('covers Display and Fees', () => {
        const covered = sections.filter((f) => /\bsaveErrors?\b/.test(readFileSync(join(dir, f), 'utf8')));
        expect(covered).toEqual(expect.arrayContaining(['DisplaySection.jsx', 'FeesSection.jsx']));
    });
});
