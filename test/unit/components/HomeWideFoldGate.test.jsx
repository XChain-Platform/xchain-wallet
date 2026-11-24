// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHomeWide } from '../../../packages/core/src/shared/components/HomeWideLayout.jsx';

const MIN_WIDTH = 1060;
let homeWidth = 879;
let originalResizeObserver;

function rect() {
    return {
        width: homeWidth,
        height: 600,
        top: 0,
        left: 0,
        right: homeWidth,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON() {},
    };
}

function publishFold(division) {
    globalThis.__xchainNativeFold = { division };
    globalThis.dispatchEvent(new Event('xchain:native-fold'));
}

function FoldProbe({ enabled = true }) {
    const [ref, wide] = useHomeWide(MIN_WIDTH, enabled, { fold: true });
    return <div ref={ref} data-testid="home" data-wide={wide ? 'true' : 'false'} />;
}

function DefaultProbe() {
    const [ref, wide] = useHomeWide(MIN_WIDTH, true);
    return <div ref={ref} data-testid="home" data-wide={wide ? 'true' : 'false'} />;
}

beforeEach(() => {
    homeWidth = 879;
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = undefined;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(rect);
});

afterEach(() => {
    cleanup();
    globalThis.ResizeObserver = originalResizeObserver;
    delete globalThis.__xchainNativeFold;
    vi.restoreAllMocks();
});

describe('Home wide fold gate', () => {
    it('is wide below the measured minimum with a finite vertical fold division', () => {
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 515.5, y: 0 },
        };
        render(<FoldProbe />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'true');
    });

    it.each([
        ['no fold', null],
        ['a horizontal fold', { orientation: 'horizontal', x: 515.5, y: 300 }],
        ['a vertical fold with no x', { orientation: 'vertical', y: 0 }],
    ])('stays narrow below the measured minimum with %s', (_label, division) => {
        globalThis.__xchainNativeFold = { division };
        render(<FoldProbe />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it('keeps the measured-width rule when the fold option is omitted', () => {
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 515.5, y: 0 },
        };
        render(<DefaultProbe />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it('responds when a fold is published and removed after mount', () => {
        render(<FoldProbe />);
        const home = screen.getByTestId('home');
        expect(home).toHaveAttribute('data-wide', 'false');

        act(() => publishFold({ orientation: 'vertical', x: 515.5, y: 0 }));
        expect(home).toHaveAttribute('data-wide', 'true');

        act(() => publishFold(null));
        expect(home).toHaveAttribute('data-wide', 'false');
    });

    it('stays narrow when disabled even with a vertical fold', () => {
        globalThis.__xchainNativeFold = {
            division: { orientation: 'vertical', x: 515.5, y: 0 },
        };
        render(<FoldProbe enabled={false} />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'false');
    });

    it('stays wide by measured width without a fold', () => {
        homeWidth = 1100;
        render(<FoldProbe />);

        expect(screen.getByTestId('home')).toHaveAttribute('data-wide', 'true');
    });
});
