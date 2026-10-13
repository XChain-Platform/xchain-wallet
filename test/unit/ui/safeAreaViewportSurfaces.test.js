// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const inset = (edge) => `env\\(safe-area-inset-${edge},\\s*0px\\)`;

describe('viewport surfaces keep content inside device safe areas', () => {
    it.each([
        ['Alerts overlay', 'packages/core/src/shared/components/AlertsOverlay.module.css', '.overlay'],
        ['Notice modal', 'packages/core/src/shared/components/NoticeModal.module.css', '.overlay'],
        ['Gated file viewer', 'packages/core/src/shared/components/GatedFileViewer.module.css', '.overlay'],
        ['Contacts modal', 'packages/core/src/shared/routes/ContactsList.module.css', '.modalOverlay'],
    ])('%s pads all four viewport edges', (_name, path, selector) => {
        const css = read(path);
        const rule = css.match(new RegExp(`\\${selector}\\s*\\{[^}]*\\}`))[0];

        for (const edge of ['top', 'right', 'bottom', 'left']) {
            expect(rule).toMatch(new RegExp(inset(edge)));
        }
    });

    it('keeps the bottom sheet above the home indicator and landscape cutouts', () => {
        const css = read('packages/core/src/shared/components/BottomTabBar.module.css');
        const sheet = css.match(/\.sheet\s*\{[^}]*\}/)[0];

        expect(sheet).toMatch(new RegExp(inset('right')));
        expect(sheet).toMatch(/env\(safe-area-inset-bottom,\s*var\(--xc-space-3\)\)/);
        expect(sheet).toMatch(new RegExp(inset('left')));
    });

    it('fits toasts between both landscape safe-area edges', () => {
        const css = read('packages/core/src/shared/components/ToastHost.module.css');
        const viewport = css.match(/\.viewport\s*\{[^}]*\}/)[0];

        expect(viewport).toMatch(new RegExp(inset('left')));
        expect(viewport).toMatch(new RegExp(inset('right')));
        expect(viewport).toMatch(new RegExp(inset('bottom')));
    });

    it('pads the inline History export modal on every viewport edge', () => {
        const history = read('packages/core/src/shared/routes/History.jsx');
        const scrim = history.match(/const MODAL_SCRIM = \{[^}]*\}/)[0];

        for (const edge of ['top', 'right', 'bottom', 'left']) {
            expect(scrim).toMatch(new RegExp(inset(edge)));
        }
    });

    it('offsets web-shell fixed and sticky tools from their anchored safe edges', () => {
        const badge = read('packages/web/src/DevVariantBadge.module.css');
        const styleGuide = read('packages/web/src/style-guide/style-guide.css');

        expect(badge).toMatch(new RegExp(inset('bottom')));
        expect(badge).toMatch(new RegExp(inset('left')));
        expect(styleGuide).toMatch(new RegExp(`top:\\s*${inset('top')}`));
    });
});
