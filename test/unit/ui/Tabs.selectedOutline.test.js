// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'Tabs.module.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the declaration block of the first rule whose selector is exactly
// `selector`, at the top level or inside an at-rule.
function ruleBody(selector) {
    const match = css.match(new RegExp(`(^|[{}])\\s*${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// The selected tab carries no outline: the tab row draws one line under the
// whole row, and the selected tab's 2px underline sits on that line.
describe('selected tab outline', () => {
    it('draws one line under the whole tab row', () => {
        expect(ruleBody('.tabs')).toMatch(/border-bottom:\s*1px solid var\(--xc-control-border\)\s*;/);
    });

    it('draws no outline around the selected tab', () => {
        const selected = ruleBody(".tab[aria-selected='true']");
        expect(selected).not.toBeNull();
        expect(selected).not.toMatch(/(^|[;\s])(border|border-color|outline|box-shadow)\s*:/);
    });
});
