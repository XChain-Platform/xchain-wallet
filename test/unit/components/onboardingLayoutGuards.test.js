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
// The license lines are the shared warning lines.
const warningCardCss = readFileSync(
    'packages/core/src/shared/components/WarningCard.module.css',
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
        expect(onboardingSource).toContain('label="License Agreement"');
        // From 834px the terms card narrows to two-thirds of the lane in CSS
        // (U32); below it the form keeps the full lane width.
        expect(onboardingSource).toMatch(/label="License Agreement"\s+fill\b/);
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
        expect(onboardingSource).toMatch(/label="License Agreement"\s+fill\s+fullWidth\s+className=\{styles\.licenseForm\}/);
        // On phone and popup widths the terms panel takes all the remaining
        // height (operator ruling, supersedes U48); from 834px it stops at its
        // content height, as asserted above.
        const licenseScrollBase = onboardingCss.match(/(?:^|\n)\.licenseScroll\s*\{[^}]*\}/)?.[0] ?? '';
        expect(licenseScrollBase).toMatch(/flex:\s*1 1 auto/);
        expect(wideLicense).not.toMatch(/flex:\s*1 1 auto/);
        expect(onboardingSource).toContain('label="Wallet Setup"');
        expect(onboardingSource).toContain('title="License Agreement"');
        expect(onboardingSource).toContain('data-onboarding-welcome-header=""');
        expect(onboardingCss).toMatch(/\.welcomeHeader\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
        const cardBreakpoint = onboardingCss.match(/@media \(min-width: 600px\) \{[\s\S]*?\n\}/)?.[0] ?? '';
        expect(cardBreakpoint).toMatch(/form\.welcomeForm\s*\{[^}]*min-height:\s*auto;/s);
        expect(cardBreakpoint).not.toMatch(/form\.welcomeForm\s*\{[^}]*flex(?:-grow)?:/s);
        expect(cardBreakpoint).toMatch(/div\.carouselForm\s*\{[^}]*height:\s*auto;/s);
        expect(cardBreakpoint).toMatch(/div\.carouselForm > \[data-form-stack\]\s*\{[^}]*flex:\s*0 1 auto;/s);
        // Import Wallet uses the shared intrinsic-height card and never opts
        // into FormPage's fill-height mode.
        expect(importWalletSource).not.toMatch(/<FormPage[\s\S]{0,320}?\sfill(?:\s|=)/);
        expect(onboardingCss).not.toMatch(/min\(\s*40%\s*,\s*140px\s*\)/);
        expect(onboardingSource.match(/stackedActions/g)).toHaveLength(2);
        expect(createWalletSource).not.toContain('<header className={headClass}>');
        // G01: the step count rides in the PageHeader subtitle, once for every stage.
        expect(createWalletSource).toMatch(/subtitle=\{stepKey \? <span aria-current="step">/);
        expect(createWalletSource).not.toMatch(/progress=\{/);
        expect(importWalletSource).not.toContain('<header className={headClass}>');
        expect(importWalletSource).toContain('titleRef={headingRef}');
        expect(carouselSource).not.toContain('skipRow');
        expect(carouselSource).toContain('<div className={styles.nav}>{navigation}</div>');
        expect(carouselCss).toMatch(/\.frameViewport\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
        expect(carouselCss).not.toMatch(/\.skipRow/);
        expect(carouselCss).not.toMatch(/\.navFinal/);
        expect(carouselCss).toMatch(/\.nav\s*\{[^}]*flex:\s*0 0 auto;/s);
        expect(carouselCss).toMatch(/\.actionsRow\s*\{[^}]*flex:\s*0 0 auto;/s);
        expect(lockedSource).toContain('<FormPage');
    });

    it('keeps the license gate full-width with one compact acknowledgement row', () => {
        expect(onboardingCss).toMatch(/\.licenseParagraph\s*\{[^}]*composes:\s*paragraph from '\.\.\/components\/WarningCard\.module\.css';/s);
        expect(warningCardCss).toMatch(/\.paragraph\s*\{[^}]*max-width:\s*none;/s);
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
        // Below 834px Accept spans the full width (G50); from 834px it keeps
        // its natural width at the end of the shared row (U68).
        expect(onboardingCss).toMatch(
            /\.licenseActions > button\s*\{[^}]*width:\s*100%;/s,
        );
        expect(onboardingCss).toMatch(
            /\.licenseActions > button\s*\{[^}]*width:\s*auto;/s,
        );
        expect(onboardingCss).toMatch(
            /\.licenseActions\s*\{[^}]*justify-content:\s*flex-end;/s,
        );
        expect(onboardingCss).toMatch(
            /\.licenseControls\s*\{[^}]*flex-direction:\s*row;[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;/s,
        );
    });

    it('uses theme tokens for assigned badges and icon overlays', () => {
        expect(balanceSource).not.toContain("color: '#FFFFFF'");
        expect(homeTabsSource).not.toContain("color: '#FFFFFF'");
        expect(balanceCss).toContain('background: var(--xc-surface);');
        // The unread badge left the Home tiles with the alerts overlay; Home keeps no raw white.
        expect(homeSource).not.toContain("color: '#FFFFFF'");
        expect(portfolioCss).toContain('color: var(--xc-hero-chip-text);');
        expect(portfolioCss).toContain('color: var(--xc-hero-chip-selected-text);');
        // Hero colors are scheme-owned tokens, so the component sheet carries
        // no raw color literals of its own.
        const heroLiterals = new Set((totalBalanceCss.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [])
            .map((literal) => literal.toLowerCase()));
        expect([...heroLiterals]).toEqual([]);
        expect(homeTabsCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    });

    it('ends create and import on the same donation notice page', () => {
        const adsNoticeCss = readFileSync(
            'packages/core/src/shared/components/AdsNotice.module.css',
            'utf8',
        );
        // The explanation is the static info Notice inside this FormPage.
        expect(adsNoticeSource).not.toMatch(/border|background|borderRadius/);
        expect(adsNoticeSource).toMatch(/<Notice[\s\S]*tone="info"[\s\S]*role=\{null\}[\s\S]*title=\{t\('adsNotice\.subtitle'\)\}/);
        expect(adsNoticeSource).not.toMatch(/WarningCard|WarningLine|<ul\b/);
        expect(adsNoticeCss).not.toMatch(/composes:\s*card/);
        expect(adsNoticeCss).toMatch(/\.form\s*\{[^}]*--xc-form-gap:\s*var\(--xc-space-2\)/s);
        expect(adsNoticeSource).toContain('className={styles.form}');
        expect(adsNoticeSource).toMatch(/<Button[^>]*\bblock\b/s);
        // The donation notice is FormPage body content and Continue is its
        // action row, so both share the wide form card and its 8px gap.
        expect(adsNoticeSource).toMatch(/<FormPage[\s\S]*actions=\{\([\s\S]*<Button[\s\S]*\)\}[\s\S]*<Notice[\s\S]*<\/FormPage>/);
        expect(adsNoticeSource).not.toMatch(/margin|styles\.actions/);
        const importAds = importWalletSource.slice(importWalletSource.indexOf('if (adsNotice) {'));
        expect(importAds.slice(0, importAds.indexOf('</Screen>'))).not.toContain('ListPage');
        expect(importAds.slice(0, importAds.indexOf('</Screen>'))).toContain('<AdsNotice');
        expect(createWalletSource).toMatch(/<AdsNotice[^>]*onContinue=\{onCreated\}/s);
    });
});
