// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Operator ruling 2026-11-15: a fact row draws one solid divider across label
// and value. Cells stretch to the row height so a tall value cannot split it.
const readCss = (path) => readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(text, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
    const match = new RegExp(`(^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
    return match?.[2] || '';
}

describe('shared fact-list grids draw one divider per row', () => {
    const sheets = [
        ['packages/core/src/shared/routes/IssueTokenForm.module.css', '.detailsList', '.detailsLabel', '.detailsValue'],
        ['packages/core/src/shared/routes/FactRows.module.css', '.list', '.label', '.value'],
    ];

    it.each(sheets)('%s stretches cells with no column gap', (path, list, label, value) => {
        const css = readCss(path);
        const grid = ruleBody(css, list);
        expect(grid).toMatch(/align-items:\s*stretch/);
        expect(grid).not.toMatch(/align-items:\s*center/);
        expect(grid).toMatch(/gap:\s*0\s*;/);
        expect(ruleBody(css, label)).toMatch(/align-content:\s*center/);
        expect(ruleBody(css, value)).toMatch(/align-content:\s*center/);
    });
});
