// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for Cluster J FOLLOWUP 3 (§25.2): the first-time
// onboarding explainer carousel. Drives the real component:
//   - paginated frames advance via Back, Next, dots and arrow keys
//   - the last frame's Next completes; Skip dismisses early
//   - both call onDone (with completed = true / false)
//   - reduced-motion drops stepping and stacks every frame
// plus the Onboarding gating: the carousel shows once on the fresh path,
// is skipped for the unlocked-vault Add-Wallet lane (onBack) and once the
// seen-flag is set.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { OnboardingCarousel } from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import * as branding from '../../../packages/core/src/branding/branding.js';
import { useFakeTimeouts } from '../../helpers/fakeTimeouts.js';

const carouselCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/OnboardingCarousel.module.css'),
    'utf8',
);
const buttonCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/Button.module.css'),
    'utf8',
);
const formPageCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/FormPage.module.css'),
    'utf8',
);
const tokensCss = readFileSync(
    join(process.cwd(), 'packages/core/src/ui/tokens.css'),
    'utf8',
);

const FRAMES = [
    { id: 'a', title: 'Frame A title', body: 'Body A' },
    { id: 'b', title: 'Frame B title', body: 'Body B' },
    { id: 'c', title: 'Frame C title', body: 'Body C' },
    { id: 'd', title: 'Frame D title', body: 'Body D' },
];

/**
 * Install a matchMedia stub. `reduce` decides whether the reduced-motion
 * query matches. jsdom does not implement matchMedia at all, so the
 * component's `typeof window.matchMedia !== 'function'` guard would
 * otherwise treat every run as "no reduced motion".
 */
function stubMatchMedia(reduce) {
    globalThis.matchMedia = (query) => ({
        matches: reduce && /prefers-reduced-motion/.test(query),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
}

beforeEach(() => {
    globalThis.localStorage?.clear?.();
});

afterEach(() => {
    cleanup();
    delete globalThis.matchMedia;
});

describe('OnboardingCarousel: paginated (default motion)', () => {
    it('keeps inactive panels hidden when the frame display rule applies', () => {
        expect(carouselCss).toMatch(/\.frame\[hidden\]\s*\{\s*display:\s*none;/);
    });

    it('spans the card content width with 8px edge insets and button gaps', () => {
        expect(carouselCss).toMatch(/\.column\s*\{[^}]*inline-size:\s*100%;/s);
        expect(carouselCss).not.toMatch(/\.centeredFull\s*>\s*\.column/);
        expect(carouselCss).toMatch(/\.nav\s*\{[^}]*gap:\s*var\(--xc-space-2\);/s);
        expect(formPageCss).toMatch(/@media \(min-width:\s*600px\)[\s\S]*?\.form\s*\{[^}]*padding:\s*var\(--xc-card-pad\);/);
        expect(tokensCss).toMatch(/--xc-card-pad:\s*var\(--xc-space-2\);/);
        expect(tokensCss).toMatch(/--xc-space-2:\s*8px;/);
    });

    it('shows the first frame and finishes from the last frame with Next', () => {
        stubMatchMedia(false);
        const onDone = vi.fn();
        const { container } = render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));

        function expectSinglePageHeading(name) {
            expect(container.querySelectorAll('h1')).toHaveLength(1);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name);
        }

        // Only the first frame is exposed; inactive tab panels stay hidden.
        expect(screen.getByText('Frame A title')).toBeVisible();
        expect(screen.getByText('Frame B title')).not.toBeVisible();
        expectSinglePageHeading('Frame A title');

        // Next advances through every frame.
        const next = screen.getByRole('button', { name: 'Next' });
        expect(next.className).toMatch(/success/);
        expect(next.querySelector('svg')).not.toBeNull();
        fireEvent.click(next);
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        expectSinglePageHeading('Frame B title');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame C title')).toBeInTheDocument();
        expectSinglePageHeading('Frame C title');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame D title')).toBeInTheDocument();
        expectSinglePageHeading('Frame D title');

        const finish = screen.getByRole('button', { name: 'Next' });
        expect(finish.className).toMatch(/success/);
        expect(finish.querySelector('svg')).not.toBeNull();
        fireEvent.click(finish);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith(true);
    });

    it('keeps the required button order, labels, variants and icon positions', () => {
        stubMatchMedia(false);
        const onDone = vi.fn();
        const { container } = render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));
        const nav = container.querySelector('[data-testid="onboarding-carousel"] [class*="nav"]');
        expect(nav).not.toBeNull();
        const firstButtons = within(nav).getAllByRole('button', { hidden: true });
        expect(firstButtons.map((button) => button.textContent)).toEqual(['Back', 'Skip', 'Next']);
        expect(firstButtons.map((button) => /secondary|success|primary/.exec(button.className)?.[0]))
            .toEqual(['success', 'primary', 'success']);
        const firstBack = firstButtons[0];
        const firstNext = screen.getByRole('button', { name: 'Next' });
        expect(firstBack).toHaveAttribute('aria-hidden', 'true');
        expect(firstBack).toHaveAttribute('tabindex', '-1');
        expect(firstBack.className).toMatch(/hiddenBack/);
        expect(carouselCss).toMatch(/\.hiddenBack\s*\{[^}]*visibility:\s*hidden;/s);
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
        fireEvent.click(firstBack);
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
        expect(firstBack).toHaveClass(/edgePinnedIcon/);
        expect(firstNext).toHaveClass(/edgePinnedIcon/);
        expect(firstBack.children[0]).toContainElement(firstBack.querySelector('svg'));
        expect(firstBack.children[1]).toHaveTextContent('Back');
        expect(firstBack.children[2]).toBeEmptyDOMElement();
        expect(firstNext.children[0]).toBeEmptyDOMElement();
        expect(firstNext.children[1]).toHaveTextContent('Next');
        expect(firstNext.children[2]).toContainElement(firstNext.querySelector('svg'));
        expect(buttonCss).toMatch(/\.edgePinnedIcon\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--xc-icon-size\) minmax\(0, 1fr\) var\(--xc-icon-size\);[^}]*gap:\s*0;/s);

        fireEvent.click(firstNext);
        expect(within(nav).getAllByRole('button').map((button) => button.textContent))
            .toEqual(['Back', 'Skip', 'Next']);
        expect(screen.getByRole('button', { name: 'Back' })).not.toHaveAttribute('aria-hidden');
        expect(screen.getByRole('button', { name: 'Back' })).not.toHaveAttribute('tabindex');

        fireEvent.click(screen.getAllByRole('tab')[3]);
        const finalButtons = within(nav).getAllByRole('button');
        expect(finalButtons.map((button) => button.textContent)).toEqual(['Back', 'Skip', 'Next']);
        expect(finalButtons.map((button) => /secondary|success|primary/.exec(button.className)?.[0]))
            .toEqual(['success', 'primary', 'success']);
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(onDone).toHaveBeenCalledWith(false);
        onDone.mockClear();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(onDone).toHaveBeenCalledWith(true);
    });

    it('Back steps to the previous frame', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame C title');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame B title');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
        expect(screen.getByText('Back').closest('button')).toHaveAttribute('aria-hidden', 'true');
    });

    it('steps back to the previous frame through the dots and ArrowLeft', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame B title');
        fireEvent.click(screen.getAllByRole('tab')[0]);
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');

        const next = screen.getByRole('button', { name: 'Next' });
        fireEvent.click(next);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'ArrowLeft' });
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
    });

    it('uses four same-shaped dots and marks the active one by color only', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));
        const dots = screen.getAllByRole('tab');
        expect(dots).toHaveLength(4);
        fireEvent.click(dots[2]);
        expect(screen.getByText('Frame C title')).toBeInTheDocument();
        expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Step 3 of 4: Frame C title' })).toBeInTheDocument();
        expect(carouselCss).toMatch(/\.dot::before,\s*\.dotActive::before\s*\{[^}]*width:\s*var\(--xc-space-2\);[^}]*height:\s*var\(--xc-space-2\);[^}]*border-radius:\s*var\(--xc-radius-pill\);[^}]*background:\s*var\(--xc-border-strong\);/s);
        expect(carouselCss).toMatch(/\.dotActive::before\s*\{\s*background:\s*var\(--xc-accent-primary\);\s*\}/);
    });

    it('implements keyboard tab navigation and connects each tab to its panel', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));

        const first = screen.getAllByRole('tab')[0];
        const firstPanel = screen.getByRole('tabpanel');
        expect(first).toHaveAttribute('tabindex', '0');
        expect(first).toHaveAttribute('aria-controls', firstPanel.id);
        expect(firstPanel).toHaveAttribute('aria-labelledby', first.id);

        first.focus();
        fireEvent.keyDown(first, { key: 'ArrowRight' });
        const second = screen.getAllByRole('tab')[1];
        expect(second).toHaveFocus();
        expect(second).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame B title');

        fireEvent.keyDown(second, { key: 'End' });
        expect(screen.getAllByRole('tab')[3]).toHaveFocus();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame D title');

        fireEvent.keyDown(screen.getAllByRole('tab')[3], { key: 'ArrowRight' });
        expect(screen.getAllByRole('tab')[0]).toHaveFocus();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
    });

    it('moves slides with left and right arrows from regular carousel controls', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));

        const skip = screen.getByRole('button', { name: 'Skip' });
        skip.focus();
        fireEvent.keyDown(skip, { key: 'ArrowRight' });
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame B title');

        fireEvent.keyDown(skip, { key: 'ArrowLeft' });
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
    });

    it('Skip dismisses early with completed = false', () => {
        stubMatchMedia(false);
        const onDone = vi.fn();
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));
        const skip = screen.getByRole('button', { name: 'Skip' });
        expect(skip.className).toMatch(/primary/);
        expect(skip.className).not.toMatch(/success|secondary|ghost|link/);
        fireEvent.click(skip);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith(false);
    });

    it('auto-advances when enabled, then stops the moment the user interacts', () => {
        useFakeTimeouts();
        stubMatchMedia(false);
        try {
            render(React.createElement(OnboardingCarousel, {
                frames: FRAMES,
                onDone: vi.fn(),
                autoAdvance: true,
                autoAdvanceMs: 2000,
            }));
            expect(screen.getByText('Frame A title')).toBeInTheDocument();
            // One tick -> frame B. Timer-driven state updates must flush
            // inside act() so React commits them before we assert.
            act(() => { vi.advanceTimersByTime(2000); });
            expect(screen.getByText('Frame B title')).toBeInTheDocument();
            // User takes control -> auto-advance retires; further ticks are inert.
            fireEvent.click(screen.getAllByRole('tab')[0]);
            expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
            act(() => { vi.advanceTimersByTime(10000); });
            expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('OnboardingCarousel: reduced motion', () => {
    it('stacks every frame without starting auto-advance', () => {
        useFakeTimeouts();
        stubMatchMedia(true);
        const intervalSpy = vi.spyOn(globalThis, 'setInterval');
        const onDone = vi.fn();
        try {
            const { container } = render(React.createElement(OnboardingCarousel, {
                frames: FRAMES,
                onDone,
                autoAdvance: true,
                autoAdvanceMs: 2000,
            }));

            // All frames rendered at once.
            expect(screen.getByText('Frame A title')).toBeInTheDocument();
            expect(screen.getByText('Frame B title')).toBeInTheDocument();
            expect(screen.getByText('Frame C title')).toBeInTheDocument();
            expect(screen.getByText('Frame D title')).toBeInTheDocument();
            expect(container.querySelectorAll('h1')).toHaveLength(1);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Frame A title');
            expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);

            // No stepping affordances or timer, but dismissal remains available.
            expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
            expect(screen.queryByRole('tab')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Skip' }).className).toMatch(/primary/);
            expect(intervalSpy).not.toHaveBeenCalled();

            const getStarted = screen.getByRole('button', { name: 'Get Started' });
            expect(getStarted.className).toMatch(/success/);
            expect(getStarted.querySelector('svg')).not.toBeNull();
            fireEvent.click(getStarted);
            expect(onDone).toHaveBeenCalledWith(true);

            const root = screen.getByTestId('onboarding-carousel');
            expect(root).toHaveAttribute('data-reduced-motion', 'true');
        } finally {
            intervalSpy.mockRestore();
            vi.useRealTimers();
        }
    });
});

describe('Onboarding: explainer gating', () => {
    function mountOnboarding(props = {}) {
        return render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: {} },
                React.createElement(Onboarding, {
                    onCreate() {},
                    onImport() {},
                    ...props,
                }),
            ),
        );
    }

    function acceptLicense() {
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    }

    it('keeps only the intro carousel free of app and page headers', () => {
        stubMatchMedia(false);

        const license = mountOnboarding();
        const licenseBanner = screen.getAllByRole('banner')
            .find((banner) => within(banner).queryByRole('region', { name: 'App header' }));
        expect(licenseBanner).toBeDefined();
        expect(within(licenseBanner).getByRole('region', { name: 'App header' }))
            .toBeInTheDocument();
        expect(within(licenseBanner).getByRole('heading', { name: 'License Agreement' }))
            .toBeInTheDocument();
        // The page header carries the title, so the card under the logo does
        // not repeat it (operator 2026-11-22).
        expect(screen.getAllByRole('heading', { name: 'License Agreement' })).toHaveLength(1);

        license.unmount();
        acceptLicense();
        const carousel = mountOnboarding();

        expect(screen.getByRole('group', { name: 'Onboarding steps' })).toBeInTheDocument();
        expect(screen.queryByRole('banner')).not.toBeInTheDocument();
        expect(carousel.container.querySelector('header')).toBeNull();

        carousel.unmount();
        const addWallet = mountOnboarding({ onBack() {} });
        const addWalletBanner = screen.getByRole('banner');
        expect(within(addWalletBanner).getByRole('heading', { name: 'Add Wallet' }))
            .toBeInTheDocument();
        expect(addWallet.container.querySelector('header')).not.toBeNull();
    });

    it('uses calm, platform-first copy for the license and first explainer step', () => {
        stubMatchMedia(false);
        const license = mountOnboarding();

        expect(screen.getByText(/XChain Platform keeps your recovery phrase on this device/))
            .toBeInTheDocument();
        expect(screen.queryByText(/Nobody can/)).not.toBeInTheDocument();

        license.unmount();
        acceptLicense();
        mountOnboarding();

        expect(screen.getByRole('heading', { name: 'Your Wallet' }))
            .toBeInTheDocument();
        expect(screen.getByText(/XChain Platform gives you a self-custodial wallet/))
            .toBeInTheDocument();
        expect(screen.queryByText(/no support line/i)).not.toBeInTheDocument();
    });

    it('shows the carousel on the fresh path, then the welcome screen after it is finished', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding();
        // Carousel is up (first explainer frame + Skip), welcome buttons hidden.
        expect(screen.getByTestId('onboarding-carousel')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create New Wallet/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

        // Now the welcome screen with the create/import fork.
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create New Wallet/ })).toBeInTheDocument();
    });

    it('introduces the XChain Platform before naming current chain support', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding();

        const tabs = screen.getAllByRole('tab');
        fireEvent.click(tabs[tabs.length - 1]);

        expect(screen.getByRole('heading', { name: 'Supported Networks' }))
            .toBeInTheDocument();
        expect(screen.getByText(/XChain Platform on Bitcoin, Litecoin, and Dogecoin/))
            .toBeInTheDocument();
    });

    it('persists Skip so a remount goes directly to create or import', () => {
        stubMatchMedia(false);
        acceptLicense();
        const firstMount = mountOnboarding();

        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(globalThis.localStorage.getItem('xc:onboardingExplainerSeenAt')).toBeTruthy();
        firstMount.unmount();

        mountOnboarding();
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create New Wallet' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import Wallet' })).toBeInTheDocument();
    });

    it('keeps the fresh welcome hierarchy and full-width success and primary actions', () => {
        stubMatchMedia(false);
        acceptLicense();
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        mountOnboarding();

        expect(screen.queryByRole('heading', { name: 'Wallet Setup' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(branding.PRODUCT_NAME);

        const create = screen.getByRole('button', { name: 'Create New Wallet' });
        const importWallet = screen.getByRole('button', { name: 'Import Wallet' });
        expect(create.className).toMatch(/success/);
        expect(importWallet.className).toMatch(/primary/);
        expect(create.className).toMatch(/block/);
        expect(importWallet.className).toMatch(/block/);
        expect(create.className).toMatch(/md/);
        expect(importWallet.className).toMatch(/md/);
    });

    it('skips the carousel for the unlocked-vault Add-Wallet lane (onBack)', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding({ onBack() {} });
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create New Wallet/ })).toBeInTheDocument();
    });

    it('skips the carousel once the seen-flag is set', () => {
        stubMatchMedia(false);
        acceptLicense();
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        mountOnboarding();
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create New Wallet/ })).toBeInTheDocument();
    });

    it('supports returning from create and then entering import', () => {
        stubMatchMedia(false);
        acceptLicense();
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());

        function FlowHarness() {
            const [step, setStep] = React.useState('welcome');
            if (step === 'create') {
                return <button type="button" onClick={() => setStep('welcome')}>Back from create</button>;
            }
            if (step === 'import') {
                return <button type="button" onClick={() => setStep('welcome')}>Back from import</button>;
            }
            return (
                <MessagingProvider shell="web" messaging={{}}>
                    <Onboarding
                        onCreate={() => setStep('create')}
                        onImport={() => setStep('import')}
                    />
                </MessagingProvider>
            );
        }

        render(<FlowHarness />);
        fireEvent.click(screen.getByRole('button', { name: 'Create New Wallet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back from create' }));
        fireEvent.click(screen.getByRole('button', { name: 'Import Wallet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back from import' }));

        expect(screen.getByRole('button', { name: 'Create New Wallet' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import Wallet' })).toBeInTheDocument();
    });
});

describe('Onboarding: license gate', () => {
    function mountLicenseGate() {
        return render(
            <MessagingProvider shell="web" messaging={{}}>
                <Onboarding onCreate={() => {}} onImport={() => {}} />
            </MessagingProvider>,
        );
    }

    async function withElementDimensions({ scrollHeight, clientHeight, styled = true }, run) {
        const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
        const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
        // jsdom applies no CSS modules, so the terms panel reports the scroll
        // styling its stylesheet gives it in a browser (or none, to model
        // the moment before the stylesheet applies).
        const realGetComputedStyle = window.getComputedStyle;
        const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
            const style = realGetComputedStyle.call(window, el, pseudo);
            if (el?.getAttribute?.('aria-label') !== 'License terms') return style;
            return new Proxy(style, {
                get: (target, key) => (key === 'overflowY' ? (styled ? 'auto' : 'visible') : Reflect.get(target, key)),
            });
        });
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
            configurable: true,
            get: () => typeof scrollHeight === 'function' ? scrollHeight() : scrollHeight,
        });
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => typeof clientHeight === 'function' ? clientHeight() : clientHeight,
        });
        try {
            return await run();
        } finally {
            styleSpy.mockRestore();
            if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollDescriptor);
            else delete HTMLElement.prototype.scrollHeight;
            if (clientDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientDescriptor);
            else delete HTMLElement.prototype.clientHeight;
        }
    }

    it('keeps acknowledgement locked while the terms panel is not yet styled to scroll', async () => {
        await withElementDimensions({ scrollHeight: 180, clientHeight: 240, styled: false }, async () => {
            mountLicenseGate();
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(screen.getByRole('checkbox')).toBeDisabled();
            expect(screen.getByText('Scroll to the end to review all terms.')).toBeInTheDocument();
        });
    });

    it('enables acknowledgement when all terms fit without scrolling', async () => {
        await withElementDimensions({ scrollHeight: 180, clientHeight: 240 }, async () => {
            mountLicenseGate();
            await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
            fireEvent.click(screen.getByRole('checkbox'));
            expect(screen.getByRole('button', { name: 'Accept and Continue' })).toBeEnabled();
        });
    });

    it('rechecks when a layout resize makes all terms visible', async () => {
        const OriginalResizeObserver = globalThis.ResizeObserver;
        let notifyResize;
        let contentHeight = 600;
        globalThis.ResizeObserver = class {
            constructor(callback) { notifyResize = callback; }
            observe() {}
            disconnect() {}
        };
        try {
            await withElementDimensions({ scrollHeight: () => contentHeight, clientHeight: 240 }, async () => {
                mountLicenseGate();
                expect(screen.getByRole('checkbox')).toBeDisabled();

                contentHeight = 180;
                act(() => notifyResize());
                expect(screen.getByRole('checkbox')).toBeEnabled();
            });
        } finally {
            globalThis.ResizeObserver = OriginalResizeObserver;
        }
    });

    it('keeps acknowledgement disabled until overflowing terms reach the end', async () => {
        await withElementDimensions({ scrollHeight: 600, clientHeight: 200 }, async () => {
            mountLicenseGate();
            const checkbox = screen.getByRole('checkbox');
            const accept = screen.getByRole('button', { name: 'Accept and Continue' });
            expect(checkbox).toBeDisabled();
            expect(accept).toBeEnabled();
            expect(accept).toHaveAccessibleDescription('Review all license terms to continue.');
            expect(buttonCss).not.toMatch(/\.btn:disabled[^{]*\{/);
            fireEvent.click(accept);
            expect(localStorage.getItem('xc:licenseAcceptedAt')).toBeNull();
            expect(checkbox).toHaveAttribute('aria-invalid', 'true');
            expect(screen.getAllByText('Review all license terms to continue.').length).toBeGreaterThan(0);

            const terms = screen.getByLabelText('License terms');
            terms.scrollTop = 400;
            fireEvent.scroll(terms);
            expect(checkbox).toBeEnabled();
            expect(checkbox).not.toHaveAttribute('aria-invalid', 'true');
            expect(accept).toBeEnabled();
            expect(accept).toHaveAccessibleDescription('Check "I have read and agree to these terms" to continue.');
            fireEvent.click(accept);
            expect(localStorage.getItem('xc:licenseAcceptedAt')).toBeNull();
            expect(screen.getAllByText('Check "I have read and agree to these terms" to continue.').length).toBeGreaterThan(0);

            fireEvent.click(checkbox);
            expect(accept).toBeEnabled();
            expect(accept).not.toHaveAttribute('aria-describedby');
        });
    });
});

describe('Onboarding: demo entry', () => {
    it('explains a refused concurrent demo save', async () => {
        stubMatchMedia(false);
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const refusal = Object.assign(new Error('stale write'), { name: 'VaultConflictError' });
        const importMnemonic = vi.fn(async () => { throw refusal; });

        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <Onboarding onCreate={() => {}} onImport={() => {}} onDemoEntered={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This wallet changed in another window. Nothing was lost. Reload to see the latest, then try again.',
        );
    });

    it('creates and marks a demo wallet before entering it', async () => {
        stubMatchMedia(false);
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const importMnemonic = vi.fn(async () => ({ wallet: { id: 'demo-wallet' } }));
        const onDemoEntered = vi.fn();

        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <Onboarding
                    onCreate={() => {}}
                    onImport={() => {}}
                    onDemoEntered={onDemoEntered}
                />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));
        await waitFor(() => expect(onDemoEntered).toHaveBeenCalledTimes(1));

        expect(importMnemonic).toHaveBeenCalledTimes(1);
        // xchain-wallet#78: the demo lands on mainnet, with mainnet leading
        // the chain list and testnet and regtest still registered.
        expect(importMnemonic.mock.calls[0][0]).toMatchObject({
            name: 'Demo Wallet',
            activeNetwork: 'mainnet',
        });
        const chainIds = importMnemonic.mock.calls[0][0].activeChainIds;
        expect(chainIds[0]).toBe('bitcoin-mainnet');
        expect(chainIds).toEqual(expect.arrayContaining(['bitcoin-testnet', 'bitcoin-regtest']));
        expect(importMnemonic.mock.calls[0][0].password).toMatch(/^[0-9a-f]{64}$/);
        expect(globalThis.localStorage.getItem('xc:demoWalletId')).toBe('demo-wallet');
        expect(globalThis.localStorage.getItem('xc:demoWalletPassword')).toBe(importMnemonic.mock.calls[0][0].password);
    });

    it.each([
        ['named', Object.assign(new Error('A wallet already exists. Unlock or reset first.'), { name: 'WalletExistsError' })],
        ['passed across a message boundary', new Error('A wallet already exists. Unlock or reset first.')],
    ])('offers Unlock when another tab already created a wallet (%s)', async (_label, refusal) => {
        // A Welcome tab left open while another tab made a real wallet: the
        // demo cannot start over it, and the lock screen is the way on.
        stubMatchMedia(false);
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const importMnemonic = vi.fn(async () => { throw refusal; });
        const onDemoEntered = vi.fn();
        const onWalletFound = vi.fn();

        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <Onboarding
                    onCreate={() => {}}
                    onImport={() => {}}
                    onDemoEntered={onDemoEntered}
                    onWalletFound={onWalletFound}
                />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This device already has a wallet. Unlock it to continue.');
        fireEvent.click(within(alert).getByRole('button', { name: 'Unlock' }));
        expect(onWalletFound).toHaveBeenCalledTimes(1);
        expect(onDemoEntered).not.toHaveBeenCalled();
    });

    it('keeps any other demo failure as it was, with no Unlock', async () => {
        stubMatchMedia(false);
        globalThis.localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        globalThis.localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        const importMnemonic = vi.fn(async () => { throw new Error('Storage is full.'); });

        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic }}>
                <Onboarding onCreate={() => {}} onImport={() => {}} onDemoEntered={() => {}} onWalletFound={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Try Demo' }));
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Storage is full.');
        expect(within(alert).queryByRole('button', { name: 'Unlock' })).toBeNull();
    });
});
