// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cssPath = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'SegmentedControl.module.css');
const css = readFileSync(cssPath, 'utf8');
const listRowCss = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'ui', 'ListRow.module.css'), 'utf8');

// Returns the declaration block of the first rule whose selector list is exactly `selector`.
function ruleBody(selector, source = css) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// The segmented control draws one outer edge. Each segment carries no edge of
// its own, so neighbours share a single divider and no inner outline sits
// inside the outer border.
describe('segmented control outline', () => {
    it('gives each segment no full border of its own', () => {
        const segment = ruleBody('.segment');
        expect(segment).not.toBeNull();
        expect(segment).toMatch(/border:\s*0\s*;/);
        expect(segment).not.toMatch(/border:\s*1px solid var\(--xc-control-border\)/);
    });

    it('draws one divider between adjacent segments', () => {
        const divider = ruleBody('.segment + .segment') ?? ruleBody('.segment:not(:first-child)');
        expect(divider).not.toBeNull();
        expect(divider).toMatch(/border-inline-start:\s*1px solid var\(--xc-control-border\)\s*;/);
    });

    it('keeps the 1px strong outer edge on the group', () => {
        const group = ruleBody('.segmented');
        expect(group).not.toBeNull();
        expect(group).toMatch(/border:\s*1px solid var\(--xc-border-strong\)\s*;/);
    });
});

// An interactive list row is a control, so it carries the same 1px control
// edge as inputs, chips and checkboxes; a static row stays edgeless.
describe('list row outline', () => {
    it('gives an interactive row the 1px control border', () => {
        const interactive = ruleBody('.interactive', listRowCss);
        expect(interactive).not.toBeNull();
        expect(interactive).toMatch(/border:\s*1px solid var\(--xc-control-border\)\s*;/);
    });

    it('keeps a static row edgeless', () => {
        const row = ruleBody('.row', listRowCss);
        expect(row).not.toBeNull();
        expect(row).toMatch(/border:\s*0\s*;/);
    });
});
