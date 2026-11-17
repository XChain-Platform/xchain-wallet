// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('packages/core/src/shared/routes/VaultUnavailable.module.css', 'utf8');
const formCss = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');
const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
const source = readFileSync('packages/core/src/shared/routes/VaultUnavailable.jsx', 'utf8');

describe('Vault unavailable centring', () => {
    it('centres its one page column vertically at every width', () => {
        expect(source).toMatch(/<Screen variant=\{variant\} bodyClassName=\{styles\.centre\}>/);
        expect(css).toMatch(/\.centre\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
        expect(css).toMatch(/\.centre\s*>\s*\*\s*\{[^}]*margin-block:\s*auto;/);
        expect(css).not.toMatch(/@media[^\{]*min-width:\s*600px[^\{]*\{\s*\.centre\b/);
    });

    it('keeps its error-screen card inside the standard 8px screen gutters on phones', () => {
        expect(screenCss).toMatch(/\.body\s*\{[^}]*padding:\s*var\(--xc-page-top\) var\(--xc-page-gutter\);/);
        expect(tokens).toMatch(/--xc-page-gutter:\s*var\(--xc-space-2\);\s*\/\* 8px at every width/);
        expect(source).toMatch(/<FormPage[\s\S]*?className=\{styles\.vaultCard\}[\s\S]*?<div className=\{styles\.wrap\}>/);
        expect(css).toMatch(/\.vaultCard\s*\{\s*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css';\s*\}/);
    });

    it('keeps the explicit card at every width and the shared wide sizing at 600px', () => {
        const vaultCard = css.match(/\.vaultCard\s*\{([^}]*)\}/)?.[1] || '';
        expect(vaultCard).toMatch(/composes:\s*card/);
        expect(css).not.toMatch(/@media[^\{]*\{[\s\S]*?\.vaultCard\s*\{[^}]*background:\s*transparent/);
        expect(formCss).toMatch(/@media \(min-width: 600px\) \{[\s\S]*?\.form\s*\{[^}]*padding:\s*var\(--xc-card-pad\);/);
    });
});
