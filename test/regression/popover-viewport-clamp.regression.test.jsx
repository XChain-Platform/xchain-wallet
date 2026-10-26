// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: phone-width header popover placement.
//
//   [P1] 2026-10-13: Header popovers can cross a phone viewport edge when
//        their trigger sits near the opposite side of the panel.

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const reachability = vi.hoisted(() => ({
    value: { overall: 'normal', perChain: [] },
}));

vi.mock('../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => reachability.value,
}));

import { HeaderSettingsButton } from '../../packages/core/src/shared/components/HeaderSettingsButton.jsx';
import { NetworkStatusIndicator } from '../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { VIEWPORT_CLAMP_MARGIN } from '../../packages/core/src/shared/hooks/useViewportClamp.js';
import { preloadOnDemandOverlays } from '../../packages/core/src/shared/components/onDemandOverlays.js';

// The app loads these on idle after first paint; load them up front here.
beforeAll(() => preloadOnDemandOverlays());

const VIEWPORT_WIDTH = 360;
const PAGE_GUTTER = 12;

function rect({ left, top, width, height }) {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON() {},
    };
}

function mockLayout({ triggerName, trigger, popoverWidth }) {
    Object.defineProperty(document.documentElement, 'clientWidth', {
        configurable: true,
        value: VIEWPORT_WIDTH,
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function bounds() {
        const isTrigger = this.getAttribute('aria-label') === triggerName
            || this.firstElementChild?.getAttribute('aria-label') === triggerName;
        if (isTrigger) return rect({ left: trigger.left, top: 14, width: 38, height: 38 });
        if (this.getAttribute('data-overlay-surface') === 'popover') {
            return rect({
                left: Number.parseFloat(this.style.left) || 0,
                top: 58,
                width: popoverWidth,
                height: 240,
            });
        }
        return rect({ left: 0, top: 0, width: 0, height: 0 });
    });
}

function expectInsidePageGutter(panel, edge) {
    const bounds = panel.getBoundingClientRect();
    expect(VIEWPORT_CLAMP_MARGIN).toBe(PAGE_GUTTER);
    expect(bounds.left).toBeGreaterThanOrEqual(PAGE_GUTTER);
    expect(bounds.right).toBeLessThanOrEqual(VIEWPORT_WIDTH - PAGE_GUTTER);
    if (edge === 'left') expect(bounds.left).toBe(PAGE_GUTTER);
    if (edge === 'right') expect(bounds.right).toBe(VIEWPORT_WIDTH - PAGE_GUTTER);
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('regression/popover-viewport-clamp', () => {
    it.each([
        ['left', { left: 1 }],
        ['right', { left: VIEWPORT_WIDTH - 39 }],
    ])('[REGRESSION P1] keeps the network status popover inside the %s gutter', (edge, trigger) => {
        mockLayout({ triggerName: 'Mainnet. Network connected', trigger, popoverWidth: 280 });
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);

        fireEvent.click(screen.getByRole('button', { name: 'Mainnet. Network connected' }));

        expectInsidePageGutter(screen.getByRole('dialog', { name: 'Network status' }), edge);
    });

    it.each([
        ['left', { left: 1 }],
        ['right', { left: VIEWPORT_WIDTH - 39 }],
    ])('[REGRESSION P1] keeps the header settings popover inside the %s gutter', (edge, trigger) => {
        mockLayout({ triggerName: 'Settings', trigger, popoverWidth: 320 });
        render(
            <HeaderSettingsButton
                activeWallet={{ id: 'wallet-1', name: 'Main' }}
                onOpenWalletPicker={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

        expectInsidePageGutter(screen.getByRole('dialog', { name: 'Wallet settings' }), edge);
    });
});
