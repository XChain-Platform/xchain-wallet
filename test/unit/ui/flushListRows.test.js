// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Rows in a flush list card are separated by divider lines and never boxed:
// the clickable ListRow draws no border of its own (an exception to the
// white-control outline rule, which covers filled controls, not list rows).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src');
const listRowCss = readFileSync(join(root, 'ui', 'ListRow.module.css'), 'utf8');

function ruleBody(selector, source) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

describe('flush list rows', () => {
    it('keeps the clickable list row unboxed', () => {
        const interactive = ruleBody('.interactive', listRowCss);
        expect(interactive).not.toBeNull();
        expect(interactive).not.toMatch(/border(-\w+)*:\s*[1-9]\d*px/);
        expect(interactive).not.toMatch(/border:\s*1px/);
    });
});
