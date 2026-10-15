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
import createWalletRawSource from '../../../packages/core/src/shared/routes/CreateWallet.jsx?raw';
import importWalletSource from '../../../packages/core/src/shared/routes/ImportWallet.jsx?raw';
import onboardingRawSource from '../../../packages/core/src/shared/routes/Onboarding.jsx?raw';
import { withEnglishCopy } from '../../helpers/englishSource.js';
import carouselSource from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx?raw';
import resumeSource from '../../../packages/core/src/shared/routes/ResumeConfirm.jsx?raw';

const onboardingSource = withEnglishCopy(onboardingRawSource);
const createWalletSource = withEnglishCopy(createWalletRawSource);
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
        // Balances render as ListRow trailing content, so the row's trailing
        // slot caps the amount column and the amounts block may shrink inside it.
        expect(balanceCss).toMatch(/\.amounts\s*\{[^}]*min-width:\s*0;/s);
        const listRowCss = readFileSync('packages/core/src/ui/ListRow.module.css', 'utf8');
        expect(listRowCss).toMatch(/\.trailing\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*50%;/s);
        // The label yields space first. A value never ends in an ellipsis:
        // one that does not fit beside the name wraps onto its own line.
        expect(balanceCss).not.toMatch(/\.amountFit\s*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/s);
        expect(balanceCss).toMatch(/\.row > \.rowContent\s*\{[^}]*flex-wrap:\s*wrap;/s);
        expect(balanceCss).toMatch(/\.name\s*\{[^}]*text-overflow:\s*ellipsis;/s);
        expect(walletPickerCss).toMatch(/\.rowName\s*\{[^}]*text-overflow:\s*ellipsis;/s);
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
        expect(onboardingSource).toContain('label="License agreement"');
        expect(onboardingSource).toMatch(/label="License agreement"\s+fill\s+fullWidth\b/);
        // The terms panel fills the free height; it never caps itself at a fraction of the screen.
        expect(onboardingCss).not.toMatch(/\.licenseScroll\s*\{[^}]*max-height:/s);
        expect(onboardingCss).toMatch(/\.licenseScroll\s*\{[^}]*flex:\s*1 1 auto/s);
        expect(onboardingSource).toContain('label="Wallet setup"');
        expect(onboardingSource).toContain('title="License agreement"');
        expect(onboardingSource).toContain('title={header ? undefined : branding.PRODUCT_NAME}');
        expect(onboardingSource.match(/stackedActions/g)).toHaveLength(3);
        expect(createWalletSource).not.toContain('<header className={headClass}>');
        expect(createWalletSource.match(/aria-current="step">Step [123] of 3/g)).toHaveLength(4);
        expect(importWalletSource).not.toContain('<header className={headClass}>');
        expect(importWalletSource).toContain('titleRef={headingRef}');
        expect(carouselSource).toContain('<div className={styles.skipRow}>{skipAction}</div>');
        expect(carouselSource).toContain('<div className={styles.nav}>{navigation}</div>');
        expect(carouselCss).toMatch(/\.frameViewport\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
        expect(carouselCss).toMatch(/\.skipRow\s*\{[^}]*flex:\s*0 0 auto;/s);
        expect(carouselCss).toMatch(/\.nav\s*\{[^}]*flex:\s*0 0 auto;/s);
        expect(carouselCss).toMatch(/\.actions\s*\{[^}]*flex:\s*0 0 auto;/s);
        expect(lockedSource).toContain('<FormPage');
        expect(resumeSource).toContain('<FormPage label={title}>');
        expect(resumeSource).not.toMatch(/<button\b/);
    });

    it('keeps the license gate full-width with one compact acknowledgement row', () => {
        expect(onboardingCss).toMatch(/\.licenseParagraph\s*\{[^}]*max-width:\s*none;/s);
        expect(onboardingCss).not.toMatch(/\.licenseAck\s*\{[^}]*display:\s*flex;/s);
        expect(onboardingCss).toMatch(/\.licenseAck\s*\{[^}]*white-space:\s*nowrap;/s);
        expect(onboardingSource).toMatch(
            // The disabled reason sits beside Accept for screen readers.
            /actions=\{\(\s*<div className=\{styles\.licenseActions\}>\s*(?:\{licenseDisabledReason \? \([\s\S]*?\) : null\}\s*)?<Button/s,
        );
        expect(onboardingSource).not.toMatch(
            /<Button\s+variant="primary"\s+block\s+onClick=\{handleAcceptLicense\}/,
        );
        expect(onboardingCss).toMatch(
            /\.licenseActions > button\s*\{[^}]*width:\s*100%;/s,
        );
        expect(onboardingCss).toMatch(
            /@media \(min-width: 600px\)[\s\S]*?\.licenseActions\s*\{[^}]*justify-content:\s*flex-end;[^}]*\}[\s\S]*?\.licenseActions > button\s*\{[^}]*width:\s*auto;/,
        );
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
