// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: onboarding license scroll lock.
//
//   [P1] 2026-10-13: The acknowledgement can unlock before CSS constrains
//        the terms, or remain unlocked when a responsive layout makes the
//        terms overflow before the user reviews them.

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { Onboarding } from '../../packages/core/src/shared/routes/Onboarding.jsx';

function renderLicenseGate() {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Onboarding onCreate={() => {}} onImport={() => {}} />
        </MessagingProvider>,
    );
}

async function withPanelLayout(initialLayout, run) {
    const layout = { overflowY: 'auto', ...initialLayout };
    const originalResizeObserver = globalThis.ResizeObserver;
    const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const realGetComputedStyle = window.getComputedStyle;
    let notifyResize;

    // jsdom does not apply the CSS module or calculate box metrics, so expose
    // only the browser layout signals the license gate consumes.
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const style = realGetComputedStyle.call(window, element, pseudo);
        if (element?.getAttribute?.('aria-label') !== 'License terms') return style;
        return new Proxy(style, {
            get: (target, key) => (key === 'overflowY' ? layout.overflowY : Reflect.get(target, key)),
        });
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () => layout.scrollHeight,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => layout.clientHeight,
    });
    globalThis.ResizeObserver = class {
        constructor(callback) { notifyResize = callback; }
        observe() {}
        disconnect() {}
    };

    try {
        await run({
            layout,
            remeasure() {
                act(() => notifyResize());
            },
        });
    } finally {
        cleanup();
        styleSpy.mockRestore();
        globalThis.ResizeObserver = originalResizeObserver;
        if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollDescriptor);
        else delete HTMLElement.prototype.scrollHeight;
        if (clientDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientDescriptor);
        else delete HTMLElement.prototype.clientHeight;
    }
}

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear?.();
});

describe('regression/license-scroll-lock', () => {
    it('[REGRESSION P1] stays locked while the terms panel is unstyled or overflowing', async () => {
        await withPanelLayout(
            { overflowY: 'visible', scrollHeight: 600, clientHeight: 200 },
            async ({ layout, remeasure }) => {
                renderLicenseGate();
                const acknowledgement = screen.getByRole('checkbox');

                expect(acknowledgement).toBeDisabled();
                layout.overflowY = 'auto';
                remeasure();
                expect(acknowledgement).toBeDisabled();
            },
        );
    });

    it('[REGRESSION P1] unlocks after the user scrolls overflowing terms to the end', async () => {
        await withPanelLayout({ scrollHeight: 600, clientHeight: 200 }, async () => {
            renderLicenseGate();
            const acknowledgement = screen.getByRole('checkbox');
            const terms = screen.getByLabelText('License terms');

            expect(acknowledgement).toBeDisabled();
            terms.scrollTop = 400;
            fireEvent.scroll(terms);
            expect(acknowledgement).toBeEnabled();
        });
    });

    it('[REGRESSION P1] unlocks when all terms fit inside a styled panel', async () => {
        await withPanelLayout({ scrollHeight: 180, clientHeight: 240 }, async () => {
            renderLicenseGate();

            await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
        });
    });

    it('[REGRESSION P1] locks again when terms overflow before the user scrolls', async () => {
        await withPanelLayout(
            { scrollHeight: 180, clientHeight: 240 },
            async ({ layout, remeasure }) => {
                renderLicenseGate();
                const acknowledgement = screen.getByRole('checkbox');

                await waitFor(() => expect(acknowledgement).toBeEnabled());
                layout.scrollHeight = 600;
                remeasure();
                expect(acknowledgement).toBeDisabled();
            },
        );
    });
});
