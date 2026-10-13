// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tokenCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/TokenDetail.module.css'),
    'utf8',
);
const manageCss = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/routes/ManageToken.module.css'),
    'utf8',
);

describe('token detail long labels', () => {
    it('allows the TokenDetail header name to wrap', () => {
        const rule = tokenCss.match(/\.headerTitle\s*\{[^}]*\}/s)?.[0] || '';
        expect(rule).toMatch(/white-space:\s*normal/);
        expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it('allows ManageToken tickers and subasset names to wrap', () => {
        const hero = manageCss.match(/\.heroTick\s*\{[^}]*\}/s)?.[0] || '';
        const subasset = manageCss.match(/\.subassetItem\s*\{[^}]*\}/s)?.[0] || '';
        expect(hero).toMatch(/overflow-wrap:\s*anywhere/);
        expect(subasset).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
