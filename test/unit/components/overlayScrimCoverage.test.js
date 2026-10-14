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
        expect(overlay).toMatch(/background:\s*var\(--xc-overlay,\s*rgba\(15, 23, 42, 0\.55\)\)/);
    });
});
