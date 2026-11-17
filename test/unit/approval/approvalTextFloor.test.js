// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The approval window's text floor and header reach, pinned in the styles.
//
// The text in the page's notice (StatusMessage .row) is the smallest size
// anything on an approval page may use, so no approval style may name a
// smaller --xc-text-* token or a raw size. The window's top bar runs edge to
// edge, so it cancels the padding Screen puts around its header slot.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (p) => join(process.cwd(), p);
const read = (p) => readFileSync(root(p), 'utf8');

const tokens = read('packages/core/src/ui/tokens.css');
const remOf = (name) => {
    const m = tokens.match(new RegExp(`${name}:\\s*([0-9.]+)rem`));
    if (!m) throw new Error(`token ${name} not found`);
    return Number(m[1]);
};

const noticeCss = read('packages/core/src/ui/StatusMessage.module.css');
const noticeToken = noticeCss.match(/\.row\s*\{[^}]*?font-size:\s*var\((--xc-text-[a-z]+)\)/s)[1];
const FLOOR = remOf(noticeToken);

const APPROVAL_STYLES = [
    'packages/extension/src/approval/approval.module.css',
    'packages/extension/src/approval/kinds/ConnectApproval.module.css',
    'packages/extension/src/approval/kinds/SignApproval.module.css',
    'packages/extension/src/approval/ApprovalHeader.module.css',
];

describe('approval window text floor', () => {
    it('reads the notice body token from the notice itself', () => {
        expect(noticeToken).toBe('--xc-text-sm');
    });

    for (const file of APPROVAL_STYLES) {
        it(`${file.split('/').pop()} never sets a font size below the notice body token`, () => {
            const css = read(file);
            const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
            for (const size of sizes) {
                const token = size.match(/^var\((--xc-text-[a-z]+)\)$/);
                expect(token, `${file}: font-size "${size}" must be a --xc-text-* token`).not.toBeNull();
                expect(remOf(token[1])).toBeGreaterThanOrEqual(FLOOR);
            }
        });
    }

    it('connect view lifts the shared full-origin line to the floor', () => {
        const css = read('packages/extension/src/approval/kinds/ConnectApproval.module.css');
        expect(css).toMatch(/\.siteOrigin\s*\{[^}]*font-size:\s*var\(--xc-text-sm\);/s);
        const connect = read('packages/extension/src/approval/kinds/ConnectApproval.jsx');
        expect(connect).toMatch(/styles\.siteOrigin\b/);
    });

    it('shared field error text uses the notice body token', () => {
        const css = read('packages/core/src/ui/Input.module.css');
        expect(css).toMatch(/\.error\s*\{[^}]*font-size:\s*var\(--xc-text-sm\);/s);
    });
});

describe('approval window header reach', () => {
    it('cancels exactly the Screen header slot padding so the bar spans the window', () => {
        const screen = read('packages/core/src/ui/Screen.module.css');
        const slot = screen.match(/\n\.header\s*\{([^}]*)\}/)[1];
        expect(slot).toMatch(/padding-block:\s*calc\(var\(--xc-page-gutter\) - 2px\)/);
        expect(slot).toMatch(/padding-inline:\s*var\(--xc-page-gutter\)/);
        expect(slot).toMatch(/padding-inline-end:\s*calc\(var\(--xc-page-gutter\) - 2px\)/);

        const css = read('packages/extension/src/approval/ApprovalHeader.module.css');
        expect(css).toMatch(/margin-block-start:\s*calc\(-1 \* \(var\(--xc-page-gutter\) - 2px\)\)/);
        expect(css).toMatch(
            /margin-inline:\s*calc\(-1 \* var\(--xc-page-gutter\)\) calc\(-1 \* \(var\(--xc-page-gutter\) - 2px\)\)/,
        );
    });

    it('draws the in-app AppHeader, not a copy of it', () => {
        const jsx = read('packages/extension/src/approval/ApprovalHeader.jsx');
        expect(jsx).toMatch(/shared\/components\/AppHeader\.jsx/);
        expect(jsx).toMatch(/styles\.bleed/);
    });
});
