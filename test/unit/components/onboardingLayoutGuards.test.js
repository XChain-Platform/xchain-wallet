// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import balanceSource from '../../../packages/core/src/shared/components/BalanceList.jsx?raw';
import homeTabsSource from '../../../packages/core/src/shared/components/HomeTabs.jsx?raw';
import homeSource from '../../../packages/core/src/shared/routes/Home.jsx?raw';
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

describe('onboarding and Home layout guards', () => {
    it('contains long balance values inside narrow rows', () => {
        expect(balanceCss).toMatch(/\.amounts\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*55%;/s);
        expect(balanceCss.match(/overflow-wrap:\s*anywhere;/g)).toHaveLength(2);
        expect(walletPickerCss).toMatch(/\.rowText\s*>\s*span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
        expect(totalBalanceCss).toMatch(/\.row\s*\{[^}]*flex-wrap:\s*wrap;/s);
    });

    it('allows a resumed transaction id to wrap', () => {
        expect(resumeSource).toContain("style={{ overflowWrap: 'anywhere' }}");
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
