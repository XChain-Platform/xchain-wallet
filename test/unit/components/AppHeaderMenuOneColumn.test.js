// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The header action menu pops out as one column at every width: a phone gets
// the same 280px column a wide layout gets, and the menu scrolls when its
// rows outgrow the viewport instead of cutting them off.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/components/AppHeader.module.css'),
    'utf8',
);

// Every block for one media query, joined: the file carries more than one.
function mediaBodies(source, query) {
    const bodies = [];
    let start = source.indexOf(query);
    while (start >= 0) {
        const open = source.indexOf('{', start);
        let depth = 0;
        let end = source.length;
        for (let i = open; i < source.length; i += 1) {
            if (source[i] === '{') depth += 1;
            if (source[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        bodies.push(source.slice(open + 1, end));
        start = source.indexOf(query, end);
    }
    return bodies.join('\n');
}

function ruleBody(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
}

describe('header action menu column layout', () => {
    it('keeps the phone menu in one column with no grid', () => {
        const phone = ruleBody(mediaBodies(css, '@media (max-width: 480px)'), '.actionMenu');

        expect(phone).not.toMatch(/display:\s*grid/);
        expect(phone).not.toMatch(/grid-template-columns/);
        expect(phone).not.toMatch(/overflow-y:\s*hidden/);
        expect(phone).not.toMatch(/(^|[\s;])width:/);
    });

    it('sizes every menu as one 280px column that scrolls when it outgrows the viewport', () => {
        const base = ruleBody(css, '.actionMenu');

        expect(base).toMatch(/width:\s*min\(280px,/);
        expect(base).toMatch(/overflow-y:\s*auto/);
        expect(css).not.toMatch(/grid-template-columns:\s*repeat\(2/);
    });
});
