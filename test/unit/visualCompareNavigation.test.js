// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'tools', 'visual-compare.mjs'), 'utf8');

describe('visual compare navigation', () => {
    it('uses the Settings drilldown command for Keyboard and selects a file for Import', () => {
        expect(source).toMatch(/label === 'Keyboard'[\s\S]+?gotoByPalette\(page, 'Settings → Keyboard'\)/);
        expect(source).toMatch(/label === 'Import…'[\s\S]+?getByLabel\('Import contacts JSON'\)\.setInputFiles/);
        expect(source).toMatch(/getByRole\('dialog', \{ name: 'Import contacts\?' \}\)[\s\S]+?waitFor/);
    });

    it('refuses to capture a screen whose visible heading is unexpected', () => {
        expect(source).toMatch(/if \(expectedHeading\) await assertScreenHeading\(page, expectedHeading\)/);
        expect(source).toMatch(/heading mismatch: expected/);
        expect(source).toMatch(/await shoot\(screen\.key, screen\.heading \|\| screen\.title\)/);
        expect(source).toMatch(/await shoot\(key, expectedHeading\)/);
    });
});
