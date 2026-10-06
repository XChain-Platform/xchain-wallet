// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Receive's Copy QR and Share QR toasts speak plain words. What the
// Clipboard and Web Share APIs throw ("Failed to execute 'write' on
// 'Clipboard': Document is not focused.") is developer text, so it goes to
// the log and the toast says what failed in the user's terms.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

const showToast = vi.fn();

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast, dismissToast: () => {}, clearToasts: () => {} }),
}));

// jsdom has no canvas, so the real encoder cannot draw the QR; a fixed PNG
// data URL lets the Copy and Share buttons enable.
vi.mock('qrcode', () => ({
    default: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};
const ADDRESS = { id: 'a1', address: 'bcrt1qexample', addressType: 'p2wpkh' };
const BROWSER_TEXT = "Failed to execute 'write' on 'Clipboard': Document is not focused.";

function renderReceive() {
    const messaging = {
        getSettings: async () => REGTEST_SETTINGS,
        getAddressesByChain: async () => ({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: async () => ADDRESS,
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="w1" accountId="acct-1" />
        </MessagingProvider>,
    );
}

/** Install the clipboard and share surfaces the screen feature-detects. */
function stubBrowser({ write, share }) {
    globalThis.ClipboardItem = class ClipboardItem {
        constructor(items) { this.items = items; }
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
}

async function clickWhenEnabled(name) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
}

let consoleError;
beforeEach(() => {
    showToast.mockClear();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    delete globalThis.ClipboardItem;
    delete navigator.clipboard;
    delete navigator.share;
    delete navigator.canShare;
});

describe('Receive QR copy and share toasts', () => {
    it('shows plain copy-failure text and logs the browser message', async () => {
        stubBrowser({
            write: vi.fn(async () => { throw new Error(BROWSER_TEXT); }),
            share: vi.fn(async () => {}),
        });
        renderReceive();

        await clickWhenEnabled(/Copy QR/);

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Copy failed: clipboard unavailable']);
        expect(messages.join(' ')).not.toContain('Document is not focused');
        expect(consoleError.mock.calls.some(([, err]) => err?.message === BROWSER_TEXT)).toBe(true);
    });

    it('shows plain share-failure text for a non-cancel share error', async () => {
        stubBrowser({
            write: vi.fn(async () => {}),
            share: vi.fn(async () => {
                throw Object.assign(new Error('NotAllowedError: Permission denied by user agent.'), {
                    name: 'NotAllowedError',
                });
            }),
        });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(showToast).toHaveBeenCalled());
        const messages = showToast.mock.calls.map(([t]) => t.message);
        expect(messages).toEqual(['Share failed: share unavailable']);
        expect(messages.join(' ')).not.toContain('Permission denied');
    });

    it('stays silent when the user closes the share sheet', async () => {
        const share = vi.fn(async () => {
            throw Object.assign(new Error('Share canceled'), { name: 'AbortError' });
        });
        stubBrowser({ write: vi.fn(async () => {}), share });
        renderReceive();

        await clickWhenEnabled(/Share QR/);

        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect(showToast).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });
});
