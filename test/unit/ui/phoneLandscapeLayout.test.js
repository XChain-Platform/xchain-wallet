// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath) {
    return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

const landscapeQuery = '@media (orientation: landscape) and (max-height: 480px)';
const appHeader = read('packages/core/src/shared/components/AppHeader.module.css');
const pageHeader = read('packages/core/src/ui/PageHeader.module.css');
const routeError = read('packages/core/src/shared/components/RouteErrorBoundary.module.css');
const popup = read('packages/extension/src/popup/popup.css');
const backgroundConnection = read('packages/extension/src/popup/backgroundConnection.jsx');
const bottomBar = read('packages/core/src/shared/components/BottomTabBar.module.css');
const leftNav = read('packages/core/src/shared/components/LeftNav.module.css');
const screen = read('packages/core/src/ui/Screen.module.css');
const modal = read('packages/core/src/shared/components/NoticeModal.module.css');
const onboarding = read('packages/core/src/shared/routes/Onboarding.module.css');
const carousel = read('packages/core/src/shared/routes/OnboardingCarousel.module.css');
const LARGE_PHONE_LANDSCAPE = Object.freeze({ width: 844, height: 390 });

function mediaBody(css, query) {
    const start = css.indexOf(query);
    const open = css.indexOf('{', start);
    let depth = 1;
    let cursor = open + 1;
    while (depth > 0 && cursor < css.length) {
        if (css[cursor] === '{') depth += 1;
        if (css[cursor] === '}') depth -= 1;
        cursor += 1;
    }
    return css.slice(open + 1, cursor - 1);
}

describe('phone landscape layout', () => {
    it('reduces persistent shell chrome without removing navigation targets', () => {
        expect(appHeader).toContain(landscapeQuery);
        // Persistent chrome keeps its own inset; only Screen.body applies the page gutter.
        expect(appHeader).not.toContain('var(--xc-page-gutter)');
        expect(appHeader).toMatch(/\.bar\s*\{[\s\S]*?padding: var\(--xc-space-1\) var\(--xc-space-2\);/);
        expect(bottomBar).toContain(landscapeQuery);
        expect(bottomBar).toMatch(/\.bar\s*\{\s*min-height: 2\.75rem;/);
        expect(bottomBar).toMatch(/\.tab\s*\{[\s\S]*?min-height: var\(--xc-tap-min\);/);
        expect(leftNav).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?padding-bottom: calc\(44px/);
        expect(screen).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?\.header\s*\{[^}]*padding-block:\s*0;/);
    });

    it('gives an 844 by 390 phone at least 220px of scrollable route content', () => {
        expect(LARGE_PHONE_LANDSCAPE.width).toBeGreaterThan(LARGE_PHONE_LANDSCAPE.height);
        expect(LARGE_PHONE_LANDSCAPE.height).toBeLessThanOrEqual(480);

        const landscape = mediaBody(screen, landscapeQuery);
        expect(landscape).toMatch(/\.screen\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
        expect(landscape).toMatch(/\.header\s*\{[^}]*flex:\s*0 0 auto;[^}]*padding-block:\s*0;/);
        expect(landscape).toMatch(/\.body\s*\{[^}]*flex:\s*1 0 220px;[^}]*min-height:\s*220px;/);
    });

    it('keeps core chrome on its own inset and the popup recovery panel on the page gutter', () => {
        expect(pageHeader).not.toMatch(/margin-inline-(?:start|end):\s*calc/);
        expect(routeError).not.toContain('var(--xc-page-gutter)');
        expect(routeError).toMatch(/\.recovery\s*\{[^}]*padding: var\(--xc-space-4\);/);
        expect(popup).toMatch(/\.popup-background-connection\s*\{[\s\S]*?padding: var\(--xc-page-top\) var\(--xc-page-gutter\);/);
        expect(backgroundConnection).not.toMatch(/<Screen\b/);
    });

    it('keeps dialogs and the QR viewfinder inside the short viewport', () => {
        expect(modal).toMatch(/\.panel\s*\{[\s\S]*?max-height: calc\([^)]+100vh[\s\S]*?overflow-y: auto;/);
        expect(screen).toMatch(/:global\(\[data-testid='qr-scanner'\] > video\)\s*\{[\s\S]*?max-height: min\(40vh, 160px\);/);
    });

    it('makes onboarding content compact and independently scrollable', () => {
        expect(onboarding).toContain(landscapeQuery);
        expect(onboarding).toMatch(/\.logoPopup,[\s\S]*?\.logoFull\s*\{[\s\S]*?width: 96px;/);
        expect(onboarding).toMatch(/\.licenseScroll\s*\{[\s\S]*?min-height: 96px;/);
        expect(carousel).toContain(landscapeQuery);
        expect(carousel).toMatch(/\.frameViewport\s*\{[\s\S]*?overflow-y: auto;/);
    });
});
