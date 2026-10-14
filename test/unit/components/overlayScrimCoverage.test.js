// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The keyboard help and the command palette mount inside the content pane.
// An absolute scrim there stopped at the pane, so the app header and the
// navigation stayed bright and clickable behind a modal dialog. Every modal
// scrim is fixed to the viewport and uses the shared scrim colour.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rule = (css, selector) => {
    const match = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    return match ? match[2] : '';
};

const SCRIMS = [
    'packages/core/src/shared/keyboard/ShortcutHelp.module.css',
    'packages/core/src/shared/commandPalette/CommandPalette.module.css',
    'packages/core/src/shared/components/OverlaySurface.module.css',
];

describe('modal scrims cover the whole viewport', () => {
    it.each(SCRIMS)('%s pins its scrim to the viewport with the shared colour', (file) => {
        const overlay = rule(readFileSync(file, 'utf8'), '.overlay');
        expect(overlay).toMatch(/position:\s*fixed/);
        expect(overlay).toMatch(/inset:\s*0/);
        // A cap on the visible height alone would stop a top-anchored scrim
        // short of the bottom edge by the top safe-area inset on a notched phone.
        const cap = /max-height:([^;]*);/.exec(overlay)?.[1];
        if (cap) expect(cap).toMatch(/\+\s*env\(safe-area-inset-top/);
        expect(overlay).toMatch(/background:\s*var\(--xc-overlay,\s*rgba\(15, 23, 42, 0\.55\)\)/);
    });
});

describe('popover header', () => {
    it('start-aligns the title in the first cell with no centring spacer before it', () => {
        const css = readFileSync('packages/core/src/shared/components/OverlaySurface.module.css', 'utf8');
        const header = /\.popover \.header\s*\{([^}]*)\}/.exec(css)?.[1] || '';
        const title = /\.popover \.title\s*\{([^}]*)\}/.exec(css)?.[1] || '';
        const close = /\.popover \.close\s*\{([^}]*)\}/.exec(css)?.[1] || '';
        expect(header).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--xc-control-h-md\)/);
        expect(header).toMatch(/padding-inline:\s*var\(--xc-space-2\)/);
        expect(title).toMatch(/grid-column:\s*1/);
        expect(title).toMatch(/text-align:\s*start/);
        expect(close).toMatch(/grid-column:\s*2/);
        // The override must come after the base close cell or it loses the cascade.
        expect(css.indexOf('.popover .close')).toBeGreaterThan(css.indexOf('\n.close {'));
    });
});

describe('contact add-address dialog', () => {
    it('uses the shared dialog scrim, padding, centred title and an outlined Cancel', () => {
        const css = readFileSync('packages/core/src/shared/routes/ContactsList.module.css', 'utf8');
        const block = (selector) => new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
        expect(block('.modalOverlay')).toMatch(/z-index:\s*var\(--xc-z-modal\)/);
        expect(block('.modalOverlay')).toMatch(/background:\s*var\(--xc-overlay,/);
        expect(block('.modalCard')).toMatch(/padding:\s*var\(--xc-space-4\)/);
        expect(block('.modalTitle')).toMatch(/text-align:\s*center/);
        const jsx = readFileSync('packages/core/src/shared/routes/ContactsList.jsx', 'utf8');
        expect(jsx).toMatch(/variant="secondary" onClick=\{\(\) => setAddAddrOpen\(false\)\}>Cancel</);
    });
});
