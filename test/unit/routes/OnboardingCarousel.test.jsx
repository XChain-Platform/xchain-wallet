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
//   - paginated frames advance via Next / Back / dots
//   - the last frame's "Get started" completes; "Skip" dismisses early
//   - both call onDone (with completed = true / false)
//   - reduced-motion drops stepping and stacks every frame
// plus the Onboarding gating: the carousel shows once on the fresh path,
// is skipped for the unlocked-vault Add-Wallet lane (onBack) and once the
// seen-flag is set.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { OnboardingCarousel } from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

const carouselCss = readFileSync(
    join(process.cwd(), 'packages/core/src/shared/routes/OnboardingCarousel.module.css'),
    'utf8',
);

const FRAMES = [
    { id: 'a', title: 'Frame A title', body: 'Body A' },
    { id: 'b', title: 'Frame B title', body: 'Body B' },
    { id: 'c', title: 'Frame C title', body: 'Body C' },
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

    it('shows the first frame and steps forward through Next to Get started', () => {
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

        // Back is disabled on the first frame.
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

        // Next -> frame B, then C.
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        expectSinglePageHeading('Frame B title');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame C title')).toBeInTheDocument();
        expectSinglePageHeading('Frame C title');

        // Last frame: Next is replaced by Get started; there is no Next.
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
        const getStarted = screen.getByRole('button', { name: 'Get started' });
        fireEvent.click(getStarted);
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith(true);
    });

    it('Back steps to the previous frame', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Frame A title')).toBeInTheDocument();
    });

    it('a dot jumps directly to that frame', () => {
        stubMatchMedia(false);
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone: vi.fn() }));
        const dots = screen.getAllByRole('tab');
        expect(dots).toHaveLength(3);
        fireEvent.click(dots[2]);
        expect(screen.getByText('Frame C title')).toBeInTheDocument();
        // The third dot reflects selection.
        expect(screen.getAllByRole('tab')[2]).toHaveAttribute('aria-selected', 'true');
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
        expect(screen.getAllByRole('tab')[2]).toHaveFocus();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame C title');

        fireEvent.keyDown(screen.getAllByRole('tab')[2], { key: 'ArrowRight' });
        expect(screen.getAllByRole('tab')[0]).toHaveFocus();
        expect(screen.getByRole('tabpanel')).toHaveTextContent('Frame A title');
    });

    it('Skip dismisses early with completed = false', () => {
        stubMatchMedia(false);
        const onDone = vi.fn();
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));
        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone).toHaveBeenCalledWith(false);
    });

    it('auto-advances when enabled, then stops the moment the user interacts', () => {
        vi.useFakeTimers();
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
            fireEvent.click(screen.getByRole('button', { name: 'Back' }));
            expect(screen.getByText('Frame A title')).toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(10000); });
            expect(screen.getByText('Frame A title')).toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('OnboardingCarousel: reduced motion', () => {
    it('stacks every frame with a single Get started and no stepping controls', () => {
        stubMatchMedia(true);
        const onDone = vi.fn();
        const { container } = render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));

        // All frames rendered at once.
        expect(screen.getByText('Frame A title')).toBeInTheDocument();
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        expect(screen.getByText('Frame C title')).toBeInTheDocument();
        expect(container.querySelectorAll('h1')).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Frame A title');
        expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);

        // No stepping affordances.
        expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
        expect(screen.queryByRole('tab')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
        expect(onDone).toHaveBeenCalledWith(true);

        const root = screen.getByTestId('onboarding-carousel');
        expect(root).toHaveAttribute('data-reduced-motion', 'true');
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

    it('shows the carousel on the fresh path, then the welcome screen after it is finished', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding();
        // Carousel is up (first explainer frame + Skip), welcome buttons hidden.
        expect(screen.getByTestId('onboarding-carousel')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create new wallet/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

        // Now the welcome screen with the create/import fork.
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create new wallet/ })).toBeInTheDocument();
    });

    it('introduces the XChain Platform before naming current chain support', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding();

        const tabs = screen.getAllByRole('tab');
        fireEvent.click(tabs[tabs.length - 1]);

        expect(screen.getByRole('heading', { name: 'Built for the XChain Platform' }))
            .toBeInTheDocument();
        expect(screen.getByText(/XChain Platform on Bitcoin, Litecoin, and Dogecoin/))
            .toBeInTheDocument();
    });

    it('skips the carousel for the unlocked-vault Add-Wallet lane (onBack)', () => {
        stubMatchMedia(false);
        acceptLicense();
        mountOnboarding({ onBack() {} });
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create new wallet/ })).toBeInTheDocument();
    });

    it('skips the carousel once the seen-flag is set', () => {
        stubMatchMedia(false);
        acceptLicense();
        globalThis.localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
        mountOnboarding();
        expect(screen.queryByTestId('onboarding-carousel')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create new wallet/ })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole('button', { name: 'Create new wallet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back from create' }));
        fireEvent.click(screen.getByRole('button', { name: 'Import wallet' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back from import' }));

        expect(screen.getByRole('button', { name: 'Create new wallet' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import wallet' })).toBeInTheDocument();
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

    async function withElementDimensions({ scrollHeight, clientHeight }, run) {
        const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
        const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
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
            if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollDescriptor);
            else delete HTMLElement.prototype.scrollHeight;
            if (clientDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientDescriptor);
            else delete HTMLElement.prototype.clientHeight;
        }
    }

    it('enables acknowledgement when all terms fit without scrolling', async () => {
        await withElementDimensions({ scrollHeight: 180, clientHeight: 240 }, async () => {
            mountLicenseGate();
            await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
            fireEvent.click(screen.getByRole('checkbox'));
            expect(screen.getByRole('button', { name: 'Accept and continue' })).toBeEnabled();
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
            expect(checkbox).toBeDisabled();

            const terms = screen.getByLabelText('License terms');
            terms.scrollTop = 400;
            fireEvent.scroll(terms);
            expect(checkbox).toBeEnabled();
        });
    });
});

describe('Onboarding: demo entry', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Try in demo mode' }));
        await waitFor(() => expect(onDemoEntered).toHaveBeenCalledTimes(1));

        expect(importMnemonic).toHaveBeenCalledTimes(1);
        expect(importMnemonic.mock.calls[0][0]).toMatchObject({
            name: 'Demo Wallet',
            activeNetwork: 'regtest',
        });
        expect(importMnemonic.mock.calls[0][0].password).toMatch(/^[0-9a-f]{64}$/);
        expect(globalThis.localStorage.getItem('xc:demoWalletId')).toBe('demo-wallet');
        expect(globalThis.localStorage.getItem('xc:demoWalletPassword')).toBe(importMnemonic.mock.calls[0][0].password);
    });
});
