// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tokenCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
);
const tokenSource = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.jsx'),
    'utf8',
);
const listRowCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/ui/ListRow.module.css'),
    'utf8',
);
const manageCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ManageToken.module.css'),
    'utf8',
);

describe('token detail long labels', () => {
    it('keeps the TokenDetail header name on one line and ellipsizes it', () => {
        const rule = tokenCss.match(/\.headerTitle\s*\{[^}]*\}/s)?.[0] || '';
        expect(rule).toMatch(/white-space:\s*nowrap/);
        expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    });

    it('allows the ManageToken name and description to wrap', () => {
        const hero = manageCss.match(/\.approvedHeroName\s*\{[^}]*\}/s)?.[0] || '';
        const description = manageCss.match(/\.approvedHeroDescription\s*\{[^}]*\}/s)?.[0] || '';
        expect(hero).toMatch(/overflow-wrap:\s*anywhere/);
        expect(description).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('lets the price facts wrap instead of cutting a value to an ellipsis', () => {
        // The stats strip is retired: price and market facts are Details rows.
        expect(tokenCss).not.toMatch(/(?:^|\n)\.stats\s*\{/);
        expect(tokenSource).toMatch(/<TokenMarketRows[\s\S]*?valueClassName=\{listRowStyles\.trailing\}/);
        const trailing = listRowCss.match(/(?:^|\n)\.trailing\s*\{[^}]*\}/s)?.[0] || '';
        expect(trailing).toMatch(/min-width:\s*0/);
        expect(trailing).not.toMatch(/text-overflow:\s*ellipsis/);
        expect(trailing).not.toMatch(/white-space:\s*nowrap/);
    });
});
