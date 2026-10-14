// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Stylesheet and markup contracts for the Messaging and Lists screens that
// jsdom cannot lay out: truncation, separators and gutters.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');
const rule = (css, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
};

describe('My lists rows', () => {
    it('lets a long list name ellipsize instead of running under the status chip', () => {
        const body = rule(read('packages/core/src/shared/routes/MyLists.module.css'), '.name');
        expect(body).not.toBeNull();
        // text-overflow only applies to a block box; the name is a span.
        expect(body).toMatch(/display:\s*block/);
        expect(body).toMatch(/text-overflow:\s*ellipsis/);
    });
});

describe('Messaging conversation rows', () => {
    const css = () => read('packages/core/src/shared/routes/MessagingInbox.module.css');

    it('draws a straight separator, not a rounded button edge', () => {
        expect(rule(css(), '.convItem')).toMatch(/border-radius:\s*0;/);
    });

    it('keeps the whole timestamp and lets the name truncate', () => {
        const body = rule(css(), '.convTime');
        expect(body).toMatch(/flex:\s*0 0 auto/);
        expect(body).not.toMatch(/text-overflow/);
    });
});

describe('Messaging thread composer', () => {
    it('sits at the footer gutter rather than pulling past it', () => {
        const body = rule(read('packages/core/src/shared/routes/MessagingInbox.module.css'), '.composer');
        expect(body).toMatch(/margin:\s*calc\(var\(--xc-space-2\) - var\(--xc-space-3\)\) 0;/);
    });
});

describe('List member blocks', () => {
    it.each([
        'packages/core/src/shared/routes/ListDetail.jsx',
        'packages/core/src/shared/routes/ListForkForm.jsx',
    ])('%s draws no bullets outside its member box', (file) => {
        const lists = read(file).match(/<ul className=\{styles\.detailsList\}[^>]*>/g) || [];
        expect(lists.length).toBeGreaterThan(0);
        for (const tag of lists) expect(tag).toMatch(/listStyle:\s*'none'/);
    });
});

describe('Encrypted-session request actions', () => {
    it('outlines Decline and Message beside the filled Share my key', () => {
        const src = read('packages/core/src/shared/routes/MessagingInbox.jsx');
        expect(src).toMatch(/<Button variant="secondary" onClick=\{onDecline\}/);
        expect(src).toMatch(/<Button variant="secondary" onClick=\{onMessage\}/);
    });
});
