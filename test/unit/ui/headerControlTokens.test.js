// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const componentsRoot = join(process.cwd(), 'packages/core/src/shared/components');
const readCss = (name) => readFileSync(join(componentsRoot, `${name}.module.css`), 'utf8');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('header control sizing tokens', () => {
    const css = Object.fromEntries([
        'AppHeader',
        'HeaderSettingsButton',
        'PlatformSwitcher',
        'NetworkStatusIndicator',
        'HeaderActionMenu',
        'TotalBalanceHero',
        'HomeTabs',
    ].map((name) => [name, readCss(name)]));

    it('uses the medium control scale for header actions and select triggers', () => {
        for (const name of [
            'AppHeader',
            'HeaderSettingsButton',
            'PlatformSwitcher',
            'NetworkStatusIndicator',
            'HomeTabs',
        ]) {
            expect(css[name], name).toContain('var(--xc-control-h-md)');
            expect(css[name], name).toContain('var(--xc-control-radius)');
        }

        for (const name of [
            'AppHeader',
            'HeaderSettingsButton',
            'PlatformSwitcher',
            'NetworkStatusIndicator',
        ]) {
            expect(css[name], name).toContain('var(--xc-control-icon-md, var(--xc-icon-md))');
        }
    });

    it('uses the small control scale for hero eye buttons and the menu close button', () => {
        for (const name of ['HeaderActionMenu', 'TotalBalanceHero']) {
            expect(css[name], name).toContain('width: var(--xc-control-h-sm);');
            expect(css[name], name).toContain('height: var(--xc-control-h-sm);');
            expect(css[name], name).toContain('border-radius: var(--xc-control-radius);');
            expect(css[name], name).toContain('var(--xc-control-icon-sm, var(--xc-icon-sm))');
        }
    });

    it('has no 36px or 38px control geometry declarations', () => {
        for (const [name, source] of Object.entries(css)) {
            expect(withoutComments(source), name).not.toMatch(
                /(?:width|height|min-height):\s*(?:36|38)px/,
            );
        }
    });
});
