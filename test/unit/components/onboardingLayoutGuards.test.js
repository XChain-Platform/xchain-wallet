// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import balanceSource from '../../../packages/core/src/shared/components/BalanceList.jsx?raw';
import homeTabsSource from '../../../packages/core/src/shared/components/HomeTabs.jsx?raw';
import homeSource from '../../../packages/core/src/shared/routes/Home.jsx?raw';
import lockedSource from '../../../packages/core/src/shared/routes/Locked.jsx?raw';
import onboardingSource from '../../../packages/core/src/shared/routes/Onboarding.jsx?raw';
import resumeSource from '../../../packages/core/src/shared/routes/ResumeConfirm.jsx?raw';

const balanceCss = readFileSync(
    'packages/core/src/shared/components/BalanceList.module.css',
    'utf8',
);
const homeTabsCss = readFileSync(
    'packages/core/src/shared/components/HomeTabs.module.css',
    'utf8',
);
const portfolioCss = readFileSync(
    'packages/core/src/shared/components/PortfolioChart.module.css',
    'utf8',
);
const totalBalanceCss = readFileSync(
    'packages/core/src/shared/components/TotalBalanceHero.module.css',
    'utf8',
);
const walletPickerCss = readFileSync(
    'packages/core/src/shared/routes/WalletPicker.module.css',
    'utf8',
);
const homeCss = readFileSync(
    'packages/core/src/shared/routes/Home.module.css',
    'utf8',
);
const lockedCss = readFileSync(
    'packages/core/src/shared/routes/Locked.module.css',
    'utf8',
);
const onboardingCss = readFileSync(
    'packages/core/src/shared/routes/Onboarding.module.css',
    'utf8',
);
const carouselCss = readFileSync(
    'packages/core/src/shared/routes/OnboardingCarousel.module.css',
    'utf8',
);

describe('onboarding and Home layout guards', () => {
    it('contains long balance values inside narrow rows', () => {
        expect(balanceCss).toMatch(/\.amounts\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*55%;/s);
        // Long amounts shrink to fit on one line (see longContentLayout.test.jsx)
        // and long names ellipsize, rather than wrapping anywhere.
        expect(balanceCss).toMatch(/\.amountFit\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/s);
        expect(balanceCss).toMatch(/\.name\s*\{[^}]*text-overflow:\s*ellipsis;/s);
        expect(walletPickerCss).toMatch(/\.rowText\s*>\s*span\s*\{[^}]*text-overflow:\s*ellipsis;/s);
        // The hero amount takes a full-width grid row of its own below the
        // label and actions, so a long total never shares a line with them.
        expect(totalBalanceCss).toMatch(/\.row\s*\{[^}]*'amount amount';[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
    });

    it('allows a resumed transaction id to wrap', () => {
        expect(resumeSource).toContain("style={{ overflowWrap: 'anywhere' }}");
    });

    it('leaves route gutters to Screen and form widths to FormPage', () => {
        expect(homeCss).not.toMatch(/\.bodyFull\s*\{[^}]*padding:/s);
        expect(lockedCss).not.toMatch(/\.hero\s*\{[^}]*padding:/s);
        expect(onboardingCss).not.toMatch(/\.hero(?:Popup|Full)\s*\{[^}]*padding:/s);
        expect(onboardingCss).not.toMatch(/\.heroFull\s*\{[^}]*(?:max-width|margin):/s);
        expect(onboardingCss).not.toMatch(/\.licenseGate\s*\{[^}]*max-width:/s);
        expect(carouselCss).not.toMatch(/\.stack\s*\{[^}]*padding:/s);
        expect(onboardingSource).toContain('<FormPage label="License agreement">');
        expect(onboardingSource).toContain('<FormPage label="Wallet setup">');
        expect(lockedSource).toContain('<FormPage');
        expect(resumeSource).toContain('<FormPage label={title}>');
        expect(resumeSource).not.toMatch(/<button\b/);
    });

    it('uses theme tokens for assigned badges and icon overlays', () => {
        expect(balanceSource).not.toContain("color: '#FFFFFF'");
        expect(homeTabsSource).not.toContain("color: '#FFFFFF'");
        expect(balanceCss).toContain('background: var(--xc-surface);');
        expect(homeTabsCss).toContain('background: var(--xc-surface);');
        expect(homeSource).toContain("color: 'var(--xc-on-accent)'");
        expect(portfolioCss).toContain('color: var(--xc-on-accent);');
        expect(totalBalanceCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
        expect(homeTabsCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    });
});
