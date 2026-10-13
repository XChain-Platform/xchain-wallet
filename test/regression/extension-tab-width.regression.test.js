// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: extension document width.
//
//   [P1] 2026-10-13: A blanket popup.html width cap constrains full-tab
//        and side-panel views to 360 px.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { isToolbarPopupView } from '../../packages/extension/src/popup/launchState.js';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = join(here, '..', '..', 'packages', 'extension');
const popupCss = readFileSync(join(extensionRoot, 'src', 'popup', 'popup.css'), 'utf8');
const popupMain = readFileSync(join(extensionRoot, 'src', 'popup', 'main.jsx'), 'utf8');

describe('regression/extension-tab-width', () => {
    it('[REGRESSION P1] marks only the toolbar popup for the 360px width cap', () => {
        const toolbarPopup = { location: { pathname: '/popup.html' }, innerWidth: 360 };
        const fullTab = { location: { pathname: '/popup.html' }, innerWidth: 1280 };
        const sidePanel = { location: { pathname: '/sidepanel.html' }, innerWidth: 480 };
        const extensionApi = { getViews: vi.fn(() => [toolbarPopup]) };

        expect(isToolbarPopupView(toolbarPopup, extensionApi)).toBe(true);
        expect(isToolbarPopupView(fullTab, extensionApi)).toBe(false);
        expect(isToolbarPopupView(sidePanel, extensionApi)).toBe(false);
        expect(popupMain).toMatch(
            /document\.documentElement\.classList\.toggle\(\s*'xchain-toolbar-popup',\s*isToolbarPopupView\(\)\s*\)/,
        );
    });

    it('[REGRESSION P1] leaves full-tab and side-panel documents at the window width', () => {
        const cappedRules = [...popupCss.matchAll(
            /([^{}]+)\{([^{}]*\bwidth:\s*min\(360px,\s*100vw\);[^{}]*)\}/g,
        )];
        const sharedSurfaceRule = popupCss.match(
            /body,\s*#xchain-popup-root\s*\{([^}]*)\}/,
        )?.[1] ?? '';

        expect(cappedRules).toHaveLength(1);
        expect(cappedRules[0][1].trim()).toBe('html.xchain-toolbar-popup');
        expect(sharedSurfaceRule).toMatch(/\bwidth:\s*100%\s*;/);
        expect(sharedSurfaceRule).toMatch(/\bmax-width:\s*100%\s*;/);
        expect(sharedSurfaceRule).toMatch(/\bmin-width:\s*0\s*;/);
    });
});
