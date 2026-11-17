// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(path, 'utf8');

const onboardingSource = read('packages/core/src/shared/routes/Onboarding.jsx');
const onboardingCss = read('packages/core/src/shared/routes/Onboarding.module.css');
const carouselCss = read('packages/core/src/shared/routes/OnboardingCarousel.module.css');
const importSource = read('packages/core/src/shared/routes/ImportWallet.jsx');
const importCss = read('packages/core/src/shared/routes/ImportWallet.module.css');
const createSource = read('packages/core/src/shared/routes/CreateWallet.jsx');
const createCss = read('packages/core/src/shared/routes/CreateWallet.module.css');
const formPageCss = read('packages/core/src/ui/FormPage.module.css');
const screenCss = read('packages/core/src/ui/Screen.module.css');
const tokensCss = read('packages/core/src/ui/tokens.css');

function rule(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('onboarding responsive width', () => {
    it('keeps welcome and carousel actions uncapped below 600px', () => {
        const welcome = rule(onboardingCss, 'form.welcomeForm');
        expect(welcome).toMatch(/min-height:\s*100%/);
        expect(welcome).not.toMatch(/max-(?:inline-)?width/);

        const narrowCarousel = carouselCss.slice(0, carouselCss.indexOf('@media (min-width: 600px)'));
        expect(rule(narrowCarousel, '.column')).toMatch(/inline-size:\s*100%/);
        expect(rule(narrowCarousel, '.column')).not.toMatch(/max-(?:inline-)?size|max-width/);
        expect(rule(carouselCss, '.nav')).not.toMatch(/max-(?:inline-)?size|max-width/);
        expect(rule(carouselCss, '.actionsRow')).not.toMatch(/max-(?:inline-)?size|max-width/);

        const narrowForm = rule(formPageCss, '.form');
        expect(narrowForm).toMatch(/width:\s*100%/);
        expect(narrowForm).not.toMatch(/max-width/);
        expect(tokensCss).toMatch(/--xc-page-gutter:\s*var\(--xc-space-2\);\s*\/\* 8px at every width/);
        expect(rule(screenCss, '.body')).toMatch(/padding:\s*var\(--xc-page-top\) var\(--xc-page-gutter\)/);
    });

    it('uses the shared FormPage card from 600px for welcome and carousel', () => {
        expect(formPageCss).toMatch(
            /@media \(min-width: 600px\) \{[\s\S]*?\.form\s*\{[^}]*max-width:\s*var\(--xc-form-card-max-width\);[^}]*margin:\s*0 auto;[^}]*background:\s*var\(--xc-card-bg\);/,
        );

        const welcome = onboardingSource.slice(onboardingSource.indexOf('// The first-run page has no app header'));
        expect(welcome).toMatch(/<FormPage\s+label=\{t\('onboarding\.walletSetup'\)\}/);
        expect(welcome).not.toMatch(/\bcardless\b/);

        const carousel = onboardingSource.slice(
            onboardingSource.indexOf('if (showExplainer)'),
            onboardingSource.indexOf('// The first-run page has no app header'),
        );
        expect(carousel).toMatch(/<Screen variant=\{variant\} header=\{null\}[^>]*>/);
        expect(carousel).toMatch(/<FormPage\s+as="div"[\s\S]*className=\{styles\.carouselForm\}/);
        expect(onboardingCss).not.toMatch(/\.carouselForm\s*\{[^}]*max-width/s);
    });

    it('leaves import, its legacy deep route, and create password on the shared frame', () => {
        expect(importSource).toMatch(/const form = \(\s*<FormPage/);
        expect(importSource).toMatch(/importVariant === 'freewallet' \? 'freewallet' : 'bip39'/);
        expect(createSource).toMatch(/const formBody = \(\s*<FormPage/);
        expect(importCss).not.toMatch(/form[^\{]*\{[^}]*(?:max-width|max-inline-size)/s);
        expect(createCss).not.toMatch(/form[^\{]*\{[^}]*(?:max-width|max-inline-size)/s);
    });
});
