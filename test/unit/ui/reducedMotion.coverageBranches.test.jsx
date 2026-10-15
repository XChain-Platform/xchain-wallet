// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
    REDUCED_MOTION_ATTR,
    resolveReducedMotion,
    useReducedMotion,
} from '../../../packages/core/src/ui/reducedMotion.js';

const originalMatchMedia = window.matchMedia;
const originalMutationObserver = globalThis.MutationObserver;

function MotionProbe() {
    return <output>{String(useReducedMotion())}</output>;
}

afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    globalThis.MutationObserver = originalMutationObserver;
    document.documentElement.removeAttribute(REDUCED_MOTION_ATTR);
});

describe('reduced motion fallback branches', () => {
    it('subscribes through the legacy media-query listener API and removes it', () => {
        let matches = false;
        let listener;
        const mq = {
            get matches() { return matches; },
            addListener: vi.fn((next) => { listener = next; }),
            removeListener: vi.fn(),
        };
        window.matchMedia = vi.fn(() => mq);

        const view = render(<MotionProbe />);
        expect(screen.getByText('false')).toBeInTheDocument();
        expect(mq.addListener).toHaveBeenCalledOnce();

        matches = true;
        act(() => listener());
        expect(screen.getByText('true')).toBeInTheDocument();

        view.unmount();
        expect(mq.removeListener).toHaveBeenCalledWith(listener);
    });

    it('falls back safely when matchMedia throws and observers are unavailable', () => {
        window.matchMedia = vi.fn(() => { throw new Error('media query unavailable'); });
        globalThis.MutationObserver = undefined;

        expect(resolveReducedMotion()).toBe(false);
        const view = render(<MotionProbe />);
        expect(screen.getByText('false')).toBeInTheDocument();
        view.unmount();
    });
});
