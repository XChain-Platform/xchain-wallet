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

// The selected tab fills with the near-white hover colour on a white page,
// so it carries the 1px control edge on its top and sides. Every tab
// reserves that edge as a transparent border, so selecting one never shifts
// the row, and the bottom keeps its 2px selection bar. The padding stays on
// the spacing scale; the edge widens each tab by 2px.
describe('selected tab outline', () => {
    it('reserves a transparent 1px edge on every tab', () => {
        const tab = ruleBody('.tab');
        expect(tab).not.toBeNull();
        expect(tab).toMatch(/border:\s*1px solid transparent\s*;/);
        expect(tab).toMatch(/border-bottom:\s*2px solid transparent\s*;/);
    });

    it('keeps the tab padding on the spacing scale', () => {
        expect(ruleBody('.tab')).toMatch(/padding:\s*0 var\(--xc-space-3\)\s*;/);
    });

    it('draws the control border around the selected tab', () => {
        const selected = ruleBody(".tab[aria-selected='true']");
        expect(selected).not.toBeNull();
        expect(selected).toMatch(/border-color:\s*var\(--xc-control-border\)\s*;/);
        expect(selected).toMatch(/border-bottom-color:\s*var\(--xc-control-selected\)\s*;/);
    });

    it('draws the same edge on a hovered tab, which takes the same fill', () => {
        const hover = ruleBody(".tab:hover:not([aria-selected='true'])");
        expect(hover).not.toBeNull();
        expect(hover).toMatch(/border-color:\s*var\(--xc-control-border\)\s*;/);
        expect(hover).toMatch(/border-bottom-color:\s*transparent\s*;/);
    });

    it('keeps idle tabs edgeless and marks the selected tab in forced colors', () => {
        // Forced colors paints a transparent border in CanvasText, so the
        // override has to come after the base rules to win the cascade.
        const selectedRuleAt = css.search(/(^|\n)\.tab\[aria-selected='true'\]\s*\{/);
        const late = forcedColorsBlocks().filter((block) => block.start > selectedRuleAt);
        const idle = late.map((block) => ruleIn(block.body, '.tab')).find(Boolean);
        const selected = late
            .map((block) => ruleIn(block.body, ".tab[aria-selected='true']"))
            .find(Boolean);
        expect(idle).toMatch(/border-color:\s*Canvas\s*;/);
        expect(selected).toMatch(/border-color:\s*Highlight\s*;/);
    });
});
