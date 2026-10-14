// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: compact demo banner geometry.
//
//   [P1] 2026-10-13: The demo disclosure consumes the narrow Home viewport,
//        pushing the first wallet content below the initial phone screen.

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markDemoWallet, clearDemoWalletId } from '../../packages/core/src/flows/demoMode.js';
import { DemoBanner } from '../../packages/core/src/shared/components/DemoBanner.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

const VIEWPORT = { width: 360, height: 800 };
const here = dirname(fileURLToPath(import.meta.url));
const source = (path) => readFileSync(join(here, '..', '..', path), 'utf8');
const bannerCss = source('packages/core/src/shared/components/DemoBanner.module.css');
const headerCss = source('packages/core/src/shared/components/AppHeader.module.css');
const layoutCss = source('packages/core/src/shared/components/LeftNav.module.css');
const screenCss = source('packages/core/src/ui/Screen.module.css');
const tokensCss = source('packages/core/src/ui/tokens.css');

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

function declaration(rule, property) {
    const escaped = property.replace(/-/g, '\\-');
    return rule.match(new RegExp(`^\\s*${escaped}:\\s*([^;]+)`, 'm'))?.[1].trim() ?? '';
}

function pixels(value) {
    const token = value.match(/^var\((--[\w-]+)\)$/)?.[1];
    if (token) {
        const root = ruleBody(tokensCss, ':root');
        return pixels(declaration(root, token));
    }
    const literal = value.match(/^([\d.]+)px$/)?.[1];
    if (!literal) throw new Error(`Expected a pixel value, received "${value}"`);
    return Number(literal);
}

beforeEach(() => {
    clearDemoWalletId();
    Object.defineProperties(window, {
        innerWidth: { configurable: true, value: VIEWPORT.width },
        innerHeight: { configurable: true, value: VIEWPORT.height },
    });
    vi.stubGlobal('matchMedia', vi.fn((query) => ({
        matches: query === '(max-width: 599px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })));
});

afterEach(() => {
    cleanup();
    clearDemoWalletId();
    vi.unstubAllGlobals();
});

describe('regression/demo-banner-compact', () => {
    it('[REGRESSION P1] keeps the 360x800 banner to one control row and Home content above 200px', () => {
        markDemoWallet('demo-wallet');
        render(
            <MessagingProvider shell="popup" messaging={{}}>
                <DemoBanner activeWalletId="demo-wallet" />
            </MessagingProvider>,
        );

        const banner = screen.getByRole('status', { name: 'Demo wallet' });
        const toggle = screen.getByRole('button', { name: 'Show demo details' });
        expect(window.innerWidth).toBe(VIEWPORT.width);
        expect(window.innerHeight).toBe(VIEWPORT.height);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(document.getElementById(toggle.getAttribute('aria-controls'))).toHaveAttribute('hidden');
        expect(banner.textContent).toContain('Demo mode');
        expect(screen.getByRole('button', { name: 'Exit demo and wipe' })).toBeInTheDocument();

        const phoneCss = bannerCss.slice(bannerCss.indexOf('@media (max-width: 599px)'));
        const compactBanner = ruleBody(phoneCss, '.banner');
        const collapsedBanner = ruleBody(phoneCss, '.banner:not(.expanded)');
        const summary = ruleBody(phoneCss, '.summary');
        const headline = ruleBody(phoneCss, '.headline');
        const detailsToggle = ruleBody(phoneCss, '.detailsToggle');
        expect(declaration(compactBanner, 'display')).toBe('grid');
        expect(declaration(compactBanner, 'grid-template-columns')).toBe('minmax(0, 1fr) auto');
        expect(declaration(compactBanner, 'padding')).toBe('0 var(--xc-space-2)');
        expect(declaration(summary, 'overflow')).toBe('hidden');
        expect(declaration(headline, 'display')).toBe('none');
        expect(declaration(detailsToggle, 'white-space')).toBe('nowrap');
        expect(declaration(collapsedBanner, 'overflow')).toBe('hidden');

        const controlHeight = pixels('var(--xc-control-h-sm)');
        const bannerHeight = pixels(declaration(collapsedBanner, 'height'));
        const bannerMaxHeight = pixels(declaration(collapsedBanner, 'max-height'));
        const bannerPaddingBlock = 0;
        expect(bannerHeight).toBeLessThanOrEqual(controlHeight + bannerPaddingBlock);
        expect(bannerMaxHeight).toBeLessThanOrEqual(controlHeight + bannerPaddingBlock);

        const compactHeader = ruleBody(headerCss, ":global([data-xc-tier='compact']) .bar");
        const headerBar = ruleBody(headerCss, '.bar');
        const notices = ruleBody(layoutCss, '.notices');
        const screenBody = ruleBody(screenCss, '.body');
        const headerRows = 2;
        const headerHeight = headerRows * pixels('var(--xc-control-h-md)')
            + pixels(declaration(compactHeader, 'gap') || 'var(--xc-space-3)')
            + 2 * pixels(declaration(headerBar, 'padding-block'))
            + 1;
        const noticePadding = 2 * pixels(declaration(notices, 'padding'));
        const homeTopPadding = pixels(declaration(screenBody, 'padding').split(' ')[0]);
        const firstHomeContentTop = headerHeight + noticePadding + bannerHeight + homeTopPadding;

        expect(firstHomeContentTop).toBeLessThanOrEqual(200);
        expect(firstHomeContentTop).toBeLessThanOrEqual(VIEWPORT.height / 4);
    });
});
