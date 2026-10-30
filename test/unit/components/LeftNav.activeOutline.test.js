// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = join(
    import.meta.dirname, '..', '..', '..',
    'packages', 'core', 'src', 'shared', 'components', 'LeftNav.module.css',
);
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns the body of the first top-level rule whose selector list is exactly `selector`.
function topLevelRule(selector) {
    const match = css.match(new RegExp(`(^|\\n)${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// Returns the bodies of every `@media (forced-colors: active)` block, in source order.
function forcedColorsBlocks() {
    const blocks = [];
    const opener = /@media\s*\(forced-colors:\s*active\)\s*\{/g;
    let found;
    while ((found = opener.exec(css)) !== null) {
        let depth = 1;
        let index = opener.lastIndex;
        while (depth > 0 && index < css.length) {
            if (css[index] === '{') depth += 1;
            if (css[index] === '}') depth -= 1;
            index += 1;
        }
        blocks.push({ start: found.index, body: css.slice(opener.lastIndex, index - 1) });
    }
    return blocks;
}

function ruleIn(body, selector) {
    const match = body.match(new RegExp(`(^|[\\s}])${escape(selector)}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// The active nav row carries the same 1px control edge as every other
// selected control. Every row reserves that edge in transparent, so selecting
// a row never moves the list.
describe('left nav active row outline', () => {
    it('draws a 1px control-border edge on the active row', () => {
        const active = topLevelRule('.itemActive');
        expect(active).not.toBeNull();
        expect(active).toMatch(/border:\s*1px solid var\(--xc-control-border\)\s*;/);
    });

    it('reserves a transparent 1px edge on every row', () => {
        const item = topLevelRule('.item');
        expect(item).not.toBeNull();
        expect(item).toMatch(/border:\s*1px solid transparent\s*;/);
        expect(item).not.toMatch(/border:\s*0\s*;/);
    });

    it('pads the row with the spacing tokens', () => {
        const item = topLevelRule('.item');
        expect(item).toMatch(/padding:\s*var\(--xc-space-2\)\s+var\(--xc-space-4\)\s*;/);
        expect(item).not.toMatch(/padding:[^;]*calc\(/);
    });

    it('keeps idle rows edgeless and marks the active row in forced colors', () => {
        // Forced colors paints a transparent border in CanvasText, so the
        // override has to come after the base rules to win the cascade.
        const itemRuleAt = css.search(/(^|\n)\.itemActive\s*\{/);
        const late = forcedColorsBlocks().filter((block) => block.start > itemRuleAt);
        const idle = late.map((block) => ruleIn(block.body, '.item')).find(Boolean);
        const active = late.map((block) => ruleIn(block.body, '.itemActive')).find(Boolean);
        expect(idle).toMatch(/border-color:\s*Canvas\s*;/);
        expect(active).toMatch(/border-color:\s*Highlight\s*;/);
    });
});
