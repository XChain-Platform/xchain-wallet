// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression (xchain-wallet#57): the Token picker opened with nothing
// focused, so typing a ticker straight away went to the page, and the
// global `g`-leader shortcuts read "MGRTEST" as `g r` and navigated to
// Receive, abandoning the form. The picker now opens with the caret in its
// search box, where the dispatcher's editable-target guard keeps the keys.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';
import { useKeyboardShortcuts } from '../../../packages/core/src/shared/keyboard/useKeyboardShortcuts.js';

function ShortcutHost({ navigate }) {
    useKeyboardShortcuts({ handlers: { navigate } });
    return null;
}

function renderPicker(navigate) {
    const messaging = { getSettings: vi.fn(async () => ({})) };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ShortcutHost navigate={navigate} />
            <TokenPicker purpose="send" walletId="w1" onSelect={() => {}} onBack={() => {}} />
        </MessagingProvider>,
    );
}

function stubPointer(coarse) {
    vi.stubGlobal('matchMedia', (q) => ({
        matches: coarse && q === '(pointer: coarse)',
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
    }));
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('Token picker search focus', () => {
    it('opens with the caret in the search box, so typed ticker letters never fire g-leader navigation', () => {
        stubPointer(false);
        const navigate = vi.fn();
        renderPicker(navigate);
        const search = screen.getByLabelText('Search coins or tokens');
        expect(document.activeElement).toBe(search);

        for (const key of ['m', 'g', 'r']) fireEvent.keyDown(document.activeElement, { key });
        expect(navigate).not.toHaveBeenCalled();
    });

    it('leaves focus alone on a touch screen, where it would raise the keyboard over the list', () => {
        stubPointer(true);
        renderPicker(vi.fn());
        expect(document.activeElement).not.toBe(screen.getByLabelText('Search coins or tokens'));
    });
});
