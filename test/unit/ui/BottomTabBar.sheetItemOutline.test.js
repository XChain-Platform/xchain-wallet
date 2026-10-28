// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'components', 'BottomTabBar.module.css');
const css = readFileSync(cssPath, 'utf8');

// Returns the declaration block of the first rule whose selector list is exactly `selector`.
function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/,\s*/g, ',\\s*');
    // Anchor at a rule start (file start or a closing brace, past any comments)
    // so a selector inside a longer selector list does not match.
    const match = css.match(new RegExp(`(^|\\})\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)*${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// Rows in the More sheet are flat list rows: no white control outline sits
// around each row, and hover and keyboard focus stay visibly distinct.
describe('More sheet row outline', () => {
    it('gives each sheet row no border of its own', () => {
        const item = ruleBody('.sheetItem');
        expect(item).not.toBeNull();
        expect(item).toMatch(/border:\s*(0|none)\s*;/);
        expect(item).not.toMatch(/border(-[a-z-]+)?:\s*1px solid var\(--xc-control-border\)/);
    });

    it('marks hover and focus with a surface fill, not an edge', () => {
        const active = ruleBody('.sheetItem:hover, .sheetItem:focus-visible');
        expect(active).not.toBeNull();
        expect(active).toMatch(/background:\s*var\(--xc-surface\)\s*;/);
        expect(active).not.toMatch(/border/);
    });

    it('keeps a visible keyboard focus ring', () => {
        const focus = ruleBody('.sheetItem:focus-visible');
        expect(focus).not.toBeNull();
        expect(focus).toMatch(/outline:\s*2px solid /);
    });
});
