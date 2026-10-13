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

describe('phone landscape layout', () => {
    it('reduces persistent shell chrome without removing navigation targets', () => {
        expect(appHeader).toContain(landscapeQuery);
        expect(appHeader).toMatch(/\.bar\s*\{[\s\S]*?padding-inline: var\(--xc-page-gutter\);/);
        expect(appHeader).toMatch(
            /@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?\.bar\s*\{[\s\S]*?padding-block: var\(--xc-space-1\);/,
        );
        expect(bottomBar).toContain(landscapeQuery);
        expect(bottomBar).toMatch(/\.bar\s*\{\s*min-height: 2\.75rem;/);
        expect(bottomBar).toMatch(/\.tab\s*\{[\s\S]*?min-height: var\(--xc-tap-min\);/);
        expect(leftNav).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?padding-bottom: calc\(44px/);
        expect(screen).toMatch(/@media \(orientation: landscape\) and \(max-height: 480px\)[\s\S]*?\.header,[\s\S]*?padding: var\(--xc-space-1\) var\(--xc-space-3\);/);
    });

    it('aligns headers and recovery containers to the responsive page gutter', () => {
        expect(pageHeader).not.toMatch(/margin-inline-(?:start|end):\s*calc/);
        expect(routeError).toMatch(/padding: var\(--xc-page-top\) var\(--xc-page-gutter\);/);
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
