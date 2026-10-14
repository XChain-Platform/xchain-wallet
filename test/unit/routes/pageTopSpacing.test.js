// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');
const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
};

describe('route page-top ownership', () => {
    it('keeps every CreateWallet stage root flush with Screen', () => {
        const source = read('packages/core/src/shared/routes/CreateWallet.jsx');
        const form = rule(read('packages/core/src/ui/FormPage.module.css'), '.form');
        expect(source.match(/<FormPage\b/g)).toHaveLength(5);
        expect(form).toMatch(/margin:\s*0/);
        expect(form).toMatch(/padding:\s*0/);
    });

    it('keeps the Settings Keyboard root and its first paragraph flush with Screen', () => {
        const settings = read('packages/core/src/shared/routes/Settings.module.css');
        const keyboard = read('packages/core/src/shared/components/settings/KeyboardSection.jsx');
        expect(rule(settings, '.page')).not.toMatch(/(?:margin|padding)(?:-block-start|-top)?\s*:/);
        expect(keyboard).toMatch(/const INTRO = \{[^}]*margin:\s*0/);
        expect(keyboard).toContain('<p style={INTRO}>');
    });

    it('keeps TokenDetail on the top-spacing-free ListPage root', () => {
        const source = read('packages/core/src/shared/routes/TokenDetail.jsx');
        const page = rule(read('packages/core/src/ui/ListPage.module.css'), '.page');
        expect(source.match(/<ListPage(?:>|><)/g)).toHaveLength(2);
        expect(page).not.toMatch(/(?:margin|padding)(?:-block-start|-top)?\s*:/);
    });

    it('keeps each Send FormPage root flush with Screen', () => {
        const source = read('packages/core/src/shared/routes/Send.jsx');
        const form = rule(read('packages/core/src/ui/FormPage.module.css'), '.form');
        expect(source.match(/<FormPage\b/g)).toHaveLength(3);
        expect(form).toMatch(/margin:\s*0/);
        expect(form).toMatch(/padding:\s*0/);
    });

    it('uses the responsive gutter for reachability notices and releases the landscape scrollbar gutter', () => {
        const banner = read('packages/core/src/shared/components/ReachabilityBanner.module.css');
        const screen = read('packages/core/src/ui/Screen.module.css');
        // The shell owns the tier values, so the notice reads its inset.
        const shell = read('packages/core/src/shared/components/LeftNav.module.css');
        expect(shell).toMatch(/\.notices\s*\{[^}]*padding-inline:\s*var\(--xc-notice-inset,\s*var\(--xc-space-3\)\)/);
        // A phone-width query may compact the banner, but never sets its inset.
        for (const [, block] of banner.matchAll(/@media \([^)]*width[^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
            expect(block).not.toMatch(/margin/);
        }
        expect(shell).toMatch(/data-xc-tier='rail'\] \.notices\s*\{[^}]*--xc-notice-inset:\s*var\(--xc-space-4\)/);
        expect(shell).toMatch(/data-xc-tier='full'\] \.notices\s*\{[^}]*--xc-notice-inset:\s*var\(--xc-space-6\)/);
        expect(screen).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?\.body\s*\{[^}]*scrollbar-gutter:\s*auto/);
    });
});
