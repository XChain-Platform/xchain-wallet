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
import adsNoticeSource from '../../../packages/core/src/shared/components/AdsNotice.jsx?raw';
import carouselSource from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx?raw';

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
        // Neither the label nor value ends in an ellipsis. A value that does
        // not fit beside the wrapping name moves onto its own line.
        expect(balanceCss).not.toMatch(/\.amountFit\s*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/s);
        expect(balanceCss).toMatch(/\.row > \.rowContent\s*\{[^}]*flex-wrap:\s*wrap;/s);
        expect(balanceCss).toMatch(/\.name\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
        expect(balanceCss).not.toMatch(/\.name\s*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/s);
        expect(walletPickerCss).toMatch(/\.rowName\s*\{[^}]*text-overflow:\s*ellipsis;/s);
        // The hero amount takes a full-width grid row of its own below the
        // label and actions, so a long total never shares a line with them.
        expect(totalBalanceCss).toMatch(/\.row\s*\{[^}]*'amount amount';[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
    });

    it('leaves route gutters to Screen and form widths to FormPage', () => {
        expect(homeCss).not.toMatch(/\.bodyFull\s*\{[^}]*padding:/s);
        expect(lockedCss).not.toMatch(/\.hero\s*\{[^}]*padding:/s);
        expect(onboardingCss).not.toMatch(/\.hero(?:Popup|Full)\s*\{[^}]*padding:/s);
        expect(onboardingCss).not.toMatch(/\.heroFull\s*\{[^}]*(?:max-width|margin):/s);
        // Below 834px the licence gate keeps the full width; only the wide
        // tier narrows it.
        expect(onboardingCss).not.toMatch(/^\.licenseGate\s*\{[^}]*max-width:/m);
        expect(carouselCss).not.toMatch(/\.stack\s*\{[^}]*padding:/s);
        expect(onboardingSource).toContain('label="License agreement"');
        // From 834px the terms card narrows to two-thirds of the lane in CSS
        // (U32); below it the form keeps the full lane width.
        expect(onboardingSource).toMatch(/label="License agreement"\s+fill\b/);
        // The top-level terms panel never caps itself at a fraction of the
        // screen; only the wide tier bounds it to the gate height.
        expect(onboardingCss).not.toMatch(/^\.licenseScroll\s*\{[^}]*max-height:/m);
        // The terms are a padded card at every width (U33).
        expect(onboardingCss).toMatch(/^\.licenseScroll\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css';/m);
        // From 834px the gate takes two-thirds of the width and the card
        // wraps its text, so the checkbox follows it directly.
        const wideLicense = onboardingCss.match(/@media \(min-width: 834px\) \{\n((?: {4}.*\n|\n)*)\}/)?.[1] ?? '';
        expect(wideLicense).toMatch(/\.licenseGate\s*\{[^}]*width:\s*calc\(100% \* 2 \/ 3\);/s);
        expect(wideLicense).toMatch(/\.licenseScroll\s*\{[^}]*flex:\s*0 1 auto;/s);
        // The filled form body stops at its content, so Accept and continue
        // follows the card instead of the bottom of a tall window.
        expect(wideLicense).toMatch(/form\.licenseForm > \[data-form-stack\]\s*\{[^}]*flex:\s*0 1 auto;/s);
        expect(onboardingSource).toMatch(/label="License agreement"\s+fill\s+fullWidth\s+className=\{styles\.licenseForm\}/);
        // At every width, phones included, the card wraps its text and the
        // checkbox and Accept follow it directly (U48); the panel only shrinks
        // and scrolls on a screen too short for the whole text. It never
        // fills the free height to pin Accept to the bottom.
        const licenseScrollBase = onboardingCss.match(/(?:^|\n)\.licenseScroll\s*\{[^}]*\}/)?.[0] ?? '';
        expect(licenseScrollBase).toMatch(/flex:\s*0 1 auto/);
        expect(licenseScrollBase).not.toMatch(/flex:\s*1 1 auto/);
        expect(wideLicense).not.toMatch(/flex:\s*1 1 auto/);
        expect(onboardingSource).toContain('label="Wallet setup"');
        expect(onboardingSource).toContain('title="License agreement"');
        expect(onboardingSource).toContain('data-onboarding-welcome-header=""');
        expect(onboardingCss).toMatch(/\.welcomeHeader\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
        expect(onboardingCss).not.toMatch(/min\(\s*40%\s*,\s*140px\s*\)/);
        expect(onboardingSource.match(/stackedActions/g)).toHaveLength(2);
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
    });

    it('keeps the license gate full-width with one compact acknowledgement row', () => {
        expect(onboardingCss).toMatch(/\.licenseParagraph\s*\{[^}]*max-width:\s*none;/s);
        expect(onboardingCss).not.toMatch(/\.licenseAck\s*\{[^}]*display:\s*flex;/s);
        expect(onboardingCss).toMatch(/\.licenseAck\s*\{[^}]*white-space:\s*nowrap;/s);
        // The acknowledgement and Accept share one wrapper, while the
        // disabled reason remains beside Accept for screen readers.
        expect(onboardingSource).toMatch(
            /<div className=\{styles\.licenseControls\}>\s*<Checkbox[\s\S]*?<div className=\{styles\.licenseActions\}>\s*(?:\{licenseDisabledReason \? \([\s\S]*?\) : null\}\s*)?<Button/s,
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
        expect(onboardingCss).toMatch(
            /@media \(min-width: 834px\)[\s\S]*?\.licenseControls\s*\{[^}]*flex-direction:\s*row;[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;/,
        );
    });

    it('uses theme tokens for assigned badges and icon overlays', () => {
        expect(balanceSource).not.toContain("color: '#FFFFFF'");
        expect(homeTabsSource).not.toContain("color: '#FFFFFF'");
        expect(balanceCss).toContain('background: var(--xc-surface);');
        expect(homeSource).toContain("color: 'var(--xc-on-accent)'");
        expect(portfolioCss).toContain('color: var(--xc-on-accent);');
        expect(totalBalanceCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
        expect(homeTabsCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    });

    it('ends create and import on the same donation notice page', () => {
        const adsNoticeCss = readFileSync(
            'packages/core/src/shared/components/AdsNotice.module.css',
            'utf8',
        );
        // The list is a shared card that flattens inside the wide form card; an
        // inline surface would draw a box in a box there.
        expect(adsNoticeSource).not.toMatch(/border|background|borderRadius/);
        expect(adsNoticeCss).toMatch(/\.list\s*\{[^}]*composes:\s*card from '\.\.\/\.\.\/ui\/Card\.module\.css'/s);
        expect(adsNoticeSource).toMatch(/<Button[^>]*\bblock\b/s);
        // Both routes hold it in a FormPage, so neither draws it bare and off centre.
        const importAds = importWalletSource.slice(importWalletSource.indexOf('if (adsNotice) {'));
        expect(importAds.slice(0, importAds.indexOf('<AdsNotice'))).toContain('<FormPage');
        expect(importAds.slice(0, importAds.indexOf('</Screen>'))).not.toContain('ListPage');
        expect(createWalletSource).toMatch(/<FormPage[^>]*>\s*\{noticeBody\}/s);
    });
});
