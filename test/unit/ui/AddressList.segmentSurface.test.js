// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'AddressList.module.css'), 'utf8');

// Returns the declaration block of the first top-level rule whose selector is exactly `selector`.
function ruleBody(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(^|\\})\\s*(?:\\/\\*[\\s\\S]*?\\*\\/\\s*)*${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[2] : null;
}

// The address type toggle follows the shared SegmentedControl contract: the
// group paints the surface and draws the outer edge, and an idle segment is
// transparent inside it, so no segment reads as a white control of its own.
describe('address type toggle surface', () => {
    it('paints the surface and the 1px edge on the group', () => {
        const group = ruleBody('.segmented');
        expect(group).not.toBeNull();
        expect(group).toMatch(/border:\s*1px solid var\(--xc-border-strong\)\s*;/);
        expect(group).toMatch(/background:\s*var\(--xc-surface\)\s*;/);
    });

    it('keeps an idle segment transparent inside the group', () => {
        const segment = ruleBody('.segment');
        expect(segment).not.toBeNull();
        expect(segment).toMatch(/background:\s*transparent\s*;/);
        expect(segment).not.toMatch(/background:\s*var\(--xc-surface\)/);
    });
});
