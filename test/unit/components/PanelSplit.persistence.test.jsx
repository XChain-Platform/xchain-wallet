// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PanelSplitDivider,
    usePanelSplit,
} from '../../../packages/core/src/shared/components/PanelSplit.jsx';
import {
    cacheDisplayPrefs,
    DISPLAY_PREFS_CACHE_KEY,
} from '../../../packages/core/src/shared/hooks/useSettingsRootAttributes.js';

let layoutWidth = 800;

function SplitHarness({ storageKey }) {
    const split = usePanelSplit({
        storageKey,
        min: 200,
        max: 500,
        minOther: 300,
        defaultShare: 0.4,
    });
    return (
        <div ref={split.layoutRef} data-panel-split-test="">
            <PanelSplitDivider split={split} label="Resize test panel" />
        </div>
    );
}

function pointer(target, type, clientX) {
    act(() => {
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX,
        }));
    });
}

function savedWidths() {
    return JSON.parse(localStorage.getItem(DISPLAY_PREFS_CACHE_KEY) || '{}').panelSplits || {};
}

beforeEach(() => {
    localStorage.clear();
    layoutWidth = 800;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        const width = this.hasAttribute('data-panel-split-test') ? layoutWidth : 0;
        return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} };
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('PanelSplit per-page display preferences', () => {
    it('restores a dragged width after unmounting and remounting', () => {
        const first = render(<SplitHarness storageKey="home" />);
        const divider = screen.getByRole('separator', { name: 'Resize test panel' });
        expect(divider).toHaveAttribute('aria-valuenow', '320');

        pointer(divider, 'pointerdown', 100);
        pointer(window, 'pointermove', 180);
        pointer(window, 'pointerup', 180);
        expect(divider).toHaveAttribute('aria-valuenow', '400');
        expect(savedWidths().home).toBe(400);

        first.unmount();
        render(<SplitHarness storageKey="home" />);
        expect(screen.getByRole('separator', { name: 'Resize test panel' }))
            .toHaveAttribute('aria-valuenow', '400');
    });

    it('keeps page keys independent', () => {
        const home = render(<SplitHarness storageKey="home" />);
        fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
        expect(savedWidths().home).toBe(328);
        home.unmount();

        render(<SplitHarness storageKey="markets" />);
        const marketsDivider = screen.getByRole('separator');
        expect(marketsDivider).toHaveAttribute('aria-valuenow', '320');
        fireEvent.keyDown(marketsDivider, { key: 'ArrowLeft' });
        expect(savedWidths()).toEqual({ home: 328, markets: 312 });
    });

    it('clamps restored widths to the current panel room', () => {
        localStorage.setItem(DISPLAY_PREFS_CACHE_KEY, JSON.stringify({
            panelSplits: { home: 999, markets: 1 },
        }));
        layoutWidth = 700;
        const home = render(<SplitHarness storageKey="home" />);
        // 700 - 300 detail - 17 gutter leaves 383 for the first panel.
        expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '383');
        home.unmount();

        render(<SplitHarness storageKey="markets" />);
        expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '200');
    });

    it('saves keyboard resizing, survives settings refreshes, and resets on double-click', () => {
        render(<SplitHarness storageKey="markets" />);
        const divider = screen.getByRole('separator');
        fireEvent.keyDown(divider, { key: 'ArrowRight', shiftKey: true });
        expect(divider).toHaveAttribute('aria-valuenow', '352');
        expect(savedWidths().markets).toBe(352);

        cacheDisplayPrefs({ theme: 'dark', reducedMotion: 'always', learnMode: true });
        expect(savedWidths().markets).toBe(352);

        fireEvent.doubleClick(divider);
        expect(divider).toHaveAttribute('aria-valuenow', '320');
        expect(savedWidths().markets).toBeUndefined();
    });
});
