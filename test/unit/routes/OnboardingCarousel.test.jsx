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
// onboarding explainer carousel . Drives the real component:
//   - paginated frames advance via Next / Back / dots
//   - the last frame's "Get started" completes; "Skip" dismisses early
//   - both call onDone (with completed = true / false)
//   - reduced-motion drops stepping and stacks every frame
// plus the Onboarding gating: the carousel shows once on the fresh path,
// is skipped for the unlocked-vault Add-Wallet lane (onBack) and once the
// seen-flag is set.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { OnboardingCarousel } from '../../../packages/core/src/shared/routes/OnboardingCarousel.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

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
    it('shows the first frame and steps forward through Next to Get started', () => {
        stubMatchMedia(false);
        const onDone = vi.fn();
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));

        // First frame only.
        expect(screen.getByText('Frame A title')).toBeInTheDocument();
        expect(screen.queryByText('Frame B title')).not.toBeInTheDocument();

        // Back is disabled on the first frame.
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

        // Next -> frame B, then C.
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Frame C title')).toBeInTheDocument();

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
        render(React.createElement(OnboardingCarousel, { frames: FRAMES, onDone }));

        // All frames rendered at once.
        expect(screen.getByText('Frame A title')).toBeInTheDocument();
        expect(screen.getByText('Frame B title')).toBeInTheDocument();
        expect(screen.getByText('Frame C title')).toBeInTheDocument();

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
});
