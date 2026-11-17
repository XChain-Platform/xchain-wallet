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

describe('left nav layout 5 highlight', () => {
    it('draws the active row as an accent wash without a square edge', () => {
        const active = topLevelRule('.itemActive');
        expect(active).not.toBeNull();
        expect(active).toMatch(/background:\s*var\(--xc-row-active-bg\)\s*;/);
        expect(active).toMatch(/border:\s*1px solid transparent\s*;/);
        expect(active).not.toMatch(/box-shadow/);
    });

    it('insets every row and gives it rounded corners', () => {
        const item = topLevelRule('.item');
        expect(item).not.toBeNull();
        expect(item).toMatch(/width:\s*calc\(100% - \(2 \* var\(--xc-side-menu-row-inset\)\)\)\s*;/);
        expect(item).toMatch(/margin-inline:\s*var\(--xc-side-menu-row-inset\)\s*;/);
        expect(item).toMatch(/border-radius:\s*calc\(var\(--xc-radius-md\) \+ var\(--xc-radius-xs\)\)\s*;/);
        expect(item).toMatch(/padding:\s*var\(--xc-space-2\)\s+var\(--xc-space-3\)\s*;/);
    });

    it('pins fixed 44px rows and centred 47px row geometry at every wide width', () => {
        const layout = topLevelRule('.layout');
        const nav = topLevelRule('.nav');
        const navItem = topLevelRule('.nav .item');
        expect(layout).toMatch(/--xc-side-menu-icons-width:\s*64px\s*;/);
        expect(layout).toMatch(/--xc-side-menu-row-inset:\s*var\(--xc-space-2\)\s*;/);
        expect(nav).toMatch(/border-inline-end:\s*1px solid var\(--xc-border\)\s*;/);
        expect(navItem).toMatch(/min-height:\s*44px\s*;/);
        expect(navItem).toMatch(/block-size:\s*44px\s*;/);
        expect(css).toMatch(/\.nav\.nav\s*\{[^}]*scrollbar-width:\s*none\s*;/s);

        expect(css).toMatch(
            /\.layout\[data-xc-side-menu='icons'\] \.sidebar,\s*\.layout\[data-xc-tier='rail'\] \.sidebar\s*\{[^}]*flex:\s*0 0 64px\s*;[^}]*inline-size:\s*var\(--xc-side-menu-icons-width\)\s*;[^}]*min-inline-size:\s*var\(--xc-side-menu-icons-width\)\s*;[^}]*max-inline-size:\s*var\(--xc-side-menu-icons-width\)\s*;/s,
        );
        expect(css).toMatch(
            /\.layout\[data-xc-side-menu='icons'\] \.item,\s*\.layout\[data-xc-tier='rail'\] \.item\s*\{[^}]*box-sizing:\s*border-box\s*;[^}]*width:\s*calc\(100% - \(2 \* var\(--xc-side-menu-row-inset\)\)\)\s*;[^}]*margin-inline:\s*var\(--xc-side-menu-row-inset\)\s*;[^}]*justify-content:\s*center\s*;[^}]*padding-inline:\s*0\s*;/s,
        );
        expect(css).toMatch(
            /\.layout\[data-xc-rail='shown'\]\[data-xc-side-menu='icons'\] > \.sidebar,\s*\.layout\[data-xc-rail='shown'\]\[data-xc-tier='rail'\] > \.sidebar\s*\{[^}]*width:\s*64px\s*;/s,
        );
        expect(css).toMatch(
            /\.layout\[data-xc-rail='shown'\]\[data-xc-side-menu='collapsed'\] > \.sidebar\s*\{[^}]*width:\s*0\s*;[^}]*inline-size:\s*0\s*;[^}]*min-inline-size:\s*0\s*;[^}]*max-inline-size:\s*0\s*;[^}]*flex-basis:\s*0\s*;/s,
        );
    });

    it('centres primary and footer icons alike and gives every divider the same inset', () => {
        expect(css).toMatch(
            /\.layout\[data-xc-side-menu='icons'\] \.item > \.icon,\s*\.layout\[data-xc-tier='rail'\] \.item > \.icon\s*\{[^}]*margin-inline:\s*0\s*;/s,
        );
        const divider = topLevelRule('.groupDivider');
        expect(divider).toMatch(
            /margin:\s*var\(--xc-space-2\)\s+calc\(var\(--xc-side-menu-row-inset\) \+ var\(--xc-space-2\) - var\(--xc-space-1\) \/ 2\)\s*;/,
        );
    });

    it('uses the neutral hover wash and preserves the keyboard focus ring', () => {
        const hover = topLevelRule('.nav .item:hover');
        const focus = topLevelRule('.nav .item:focus-visible');
        expect(hover).toMatch(/background:\s*var\(--xc-row-hover-bg\)\s*;/);
        expect(focus).toMatch(/outline:\s*2px solid var\(--xc-accent-primary, var\(--xc-text\)\)\s*;/);
        expect(focus).toMatch(/outline-offset:\s*-2px\s*;/);
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
