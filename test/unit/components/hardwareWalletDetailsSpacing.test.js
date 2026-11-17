// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

function rule(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] || '';
}

describe('hardware Wallet Details account notice spacing', () => {
    const details = read('packages/core/src/shared/components/HardwareWalletDetails.jsx');
    const toggle = read('packages/core/src/shared/components/ActionsDetailsToggle.jsx');
    const css = read('packages/core/src/shared/components/ActionsDetailsToggle.module.css');

    // The Accounts tab left this page for the shared account pages (G131); the
    // Device access note now leads the Details panel.
    it('keeps the Device access notice as the first direct child of the Details panel', () => {
        expect(details).toMatch(/const details = \(\s*<>\s*<Notice\b[\s\S]*?<dl\b/);
        expect(details).toMatch(/<ActionsDetailsToggle actions=\{actions\} details=\{details\} \/>/);
        expect(details).not.toMatch(/id: 'accounts'/);
        expect(toggle).toMatch(/className=\{styles\.panel\}[\s\S]*?\{panels\[view\]\}/);
    });

    it('uses one 8px gap around direct notices without adding Notice margins', () => {
        expect(rule(css, '.toggle')).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule(css, '.panel')).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(rule(css, '.panel > [data-variant]')).toMatch(/margin:\s*0/);
    });
});
