// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const tokensPath = join(repoRoot, 'packages', 'core', 'src', 'ui', 'tokens.css');
const componentsDir = join(repoRoot, 'packages', 'core', 'src', 'shared', 'components');
const tokensCss = readFileSync(tokensPath, 'utf8');
const componentCss = readdirSync(componentsDir)
    .filter((file) => file.endsWith('.module.css'))
    .map((file) => readFileSync(join(componentsDir, file), 'utf8'))
    .join('\n');

const expectedTokens = new Map([
    ['--xc-radius-xs', '2px'],
    ['--xc-radius-control', '10px'],
    ['--xc-shadow-header-menu', '0 8px 20px rgba(0, 0, 0, 0.18)'],
    ['--xc-shadow-toast', '0 8px 24px rgba(0, 0, 0, 0.15)'],
    ['--xc-shadow-popover', '0 12px 30px rgba(0, 0, 0, 0.18)'],
    ['--xc-shadow-modal', '0 16px 40px rgba(0, 0, 0, 0.35)'],
    ['--xc-shadow-side-panel', '-16px 0 40px rgba(0, 0, 0, 0.35)'],
    ['--xc-shadow-bottom-sheet', '0 -8px 32px rgba(0, 0, 0, 0.18)'],
    ['--xc-shadow-surface-ring', '0 0 0 1.5px var(--xc-surface)'],
    ['--xc-shadow-accent-ring', '0 0 0 1px var(--xc-accent-primary, var(--xc-border-strong))'],
    ['--xc-shadow-focus-ring', '0 0 0 3px var(--xc-focus-ring)'],
    ['--xc-shadow-danger-focus-ring', '0 0 0 3px rgba(220, 38, 38, 0.2)'],
    ['--xc-shadow-nav-indicator', 'inset 3px 0 0 var(--xc-accent-primary, var(--xc-text))'],
]);

describe('shared component radius and shadow tokens', () => {
    it('preserves the component geometry in the token values', () => {
        for (const [token, value] of expectedTokens) {
            expect(tokensCss).toContain(`${token}: ${value};`);
        }
    });

    it('uses every component token from a shared CSS module', () => {
        for (const token of expectedTokens.keys()) {
            expect(componentCss).toContain(`var(${token})`);
        }
    });
});
