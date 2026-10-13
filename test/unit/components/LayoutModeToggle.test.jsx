// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LayoutModeToggle } from '../../../packages/core/src/shared/components/LayoutModeToggle.jsx';

const STORAGE_KEY = 'xchain.layoutMode';

function extensionChrome(storedMode = undefined) {
    const listeners = new Set();
    const chrome = {
        sidePanel: {},
        storage: {
            local: {
                get: vi.fn((_key, callback) => callback(
                    storedMode === undefined ? {} : { [STORAGE_KEY]: storedMode },
                )),
                set: vi.fn(),
            },
            onChanged: {
                addListener: vi.fn((listener) => listeners.add(listener)),
                removeListener: vi.fn((listener) => listeners.delete(listener)),
            },
        },
    };
    vi.stubGlobal('chrome', chrome);
    return { chrome, listeners };
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('LayoutModeToggle', () => {
    it('renders nothing outside an extension side-panel context', () => {
        vi.stubGlobal('chrome', undefined);

        const { container } = render(<LayoutModeToggle />);

        expect(container).toBeEmptyDOMElement();
    });

    it('renders the stored choice as an accessible radio group', () => {
        const { chrome } = extensionChrome('sidepanel');
        render(<LayoutModeToggle />);

        expect(chrome.storage.local.get).toHaveBeenCalledWith(STORAGE_KEY, expect.any(Function));
        expect(screen.getByRole('radiogroup', { name: 'Open as' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Popup' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('radio', { name: 'Sidebar' })).toHaveAttribute('aria-checked', 'true');
    });

    it('persists a new choice without rewriting the selected choice', () => {
        const { chrome } = extensionChrome('popup');
        render(<LayoutModeToggle />);

        const popup = screen.getByRole('radio', { name: 'Popup' });
        const sidebar = screen.getByRole('radio', { name: 'Sidebar' });
        fireEvent.click(sidebar);

        expect(sidebar).toHaveAttribute('aria-checked', 'true');
        expect(popup).toHaveAttribute('aria-checked', 'false');
        expect(chrome.storage.local.set).toHaveBeenCalledWith({ [STORAGE_KEY]: 'sidepanel' });

        fireEvent.click(sidebar);
        expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    });

    it('tracks local storage changes and removes its listener on unmount', () => {
        const { chrome, listeners } = extensionChrome('popup');
        const view = render(<LayoutModeToggle />);
        const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];

        listener({ [STORAGE_KEY]: { newValue: 'sidepanel' } }, 'sync');
        expect(screen.getByRole('radio', { name: 'Popup' })).toHaveAttribute('aria-checked', 'true');

        act(() => listener({ [STORAGE_KEY]: { newValue: 'sidepanel' } }, 'local'));
        expect(screen.getByRole('radio', { name: 'Sidebar' })).toHaveAttribute('aria-checked', 'true');

        view.unmount();
        expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener);
        expect(listeners.size).toBe(0);
    });
});
