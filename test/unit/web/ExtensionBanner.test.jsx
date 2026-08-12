// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §43.5 / Cluster F FOLLOWUP 2: ExtensionBanner accept affordance.
// Drives the banner through its states with a fake window.xchain:
// hidden with no extension, offer + accept -> active, dismiss, reject,
// and switch-back.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ExtensionBanner } from '../../../packages/web/src/components/ExtensionBanner.jsx';
import { EXT_WALLET_PREF_KEY } from '../../../packages/web/src/extensionWallet.js';

// CSS modules resolve to an empty object under the unit config's
// transform, so `styles.x` is undefined; assertions target roles + text,
// not class names.

function makeProvider(overrides = {}) {
    return {
        isXChainWallet: true,
        // A bridge-spec ConnectSuccess. The banner reads the `ok` flag now,
        // because a refusal resolves rather than throws ().
        connect: vi.fn().mockResolvedValue({
            ok: true,
            version: '0.1.0',
            accounts: [],
            chains: [],
            permissions: { chains: [], accounts: [], canSignMessage: false, canSignAction: {} },
        }),
        ...overrides,
    };
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.xchain;
});
afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    delete window.xchain;
    vi.restoreAllMocks();
});

describe('<ExtensionBanner>', () => {
    it('renders nothing when no extension is present', () => {
        const { container } = render(<ExtensionBanner />);
        expect(container.firstChild).toBeNull();
    });

    it('offers "Use extension wallet" when the extension is detected', () => {
        window.xchain = makeProvider();
        render(<ExtensionBanner />);
        expect(screen.getByText(/XChain Wallet extension detected/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Use extension wallet' })).toBeTruthy();
    });

    it('detects an extension injected after mount via the init event', () => {
        render(<ExtensionBanner />);
        expect(screen.queryByText(/extension detected/i)).toBeNull();
        window.xchain = makeProvider();
        fireEvent(window, new Event('xchain#initialized'));
        expect(screen.getByRole('button', { name: 'Use extension wallet' })).toBeTruthy();
    });

    it('connects, persists the preference, and flips to the active state on accept', async () => {
        const provider = makeProvider();
        window.xchain = provider;
        render(<ExtensionBanner />);

        fireEvent.click(screen.getByRole('button', { name: 'Use extension wallet' }));

        await waitFor(() =>
            expect(screen.getByText(/Using your extension wallet/i)).toBeTruthy(),
        );
        expect(provider.connect).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBe('1');
        expect(screen.getByRole('button', { name: 'Switch back' })).toBeTruthy();
    });

    it('shows an error and stays on the web app when the connect is rejected', async () => {
        const provider = makeProvider({
            connect: vi.fn().mockRejectedValue(new Error('User rejected the request')),
        });
        window.xchain = provider;
        render(<ExtensionBanner />);

        fireEvent.click(screen.getByRole('button', { name: 'Use extension wallet' }));

        await waitFor(() =>
            expect(screen.getByRole('alert').textContent).toMatch(/User rejected/i),
        );
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBeNull();
        // Still on the offer state, not active.
        expect(screen.getByRole('button', { name: 'Use extension wallet' })).toBeTruthy();
        expect(screen.queryByText(/Using your extension wallet/i)).toBeNull();
    });

    // The shape a real refusal actually arrives in (): the promise
    // RESOLVES with `ok: false`. Read as "did not throw", this flipped the
    // banner into its active state with no session behind it.
    it('shows an error and stays on the web app when the connect RESOLVES ok:false', async () => {
        const provider = makeProvider({
            connect: vi.fn().mockResolvedValue({ ok: false, error: 'USER_REJECTED' }),
        });
        window.xchain = provider;
        render(<ExtensionBanner />);

        fireEvent.click(screen.getByRole('button', { name: 'Use extension wallet' }));

        await waitFor(() =>
            expect(screen.getByRole('alert').textContent).toMatch(/declined/i),
        );
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: 'Use extension wallet' })).toBeTruthy();
        expect(screen.queryByText(/Using your extension wallet/i)).toBeNull();
    });

    it('hides the offer after "Not now" and records it in sessionStorage', () => {
        window.xchain = makeProvider();
        const { container } = render(<ExtensionBanner />);
        fireEvent.click(screen.getByRole('button', { name: /Dismiss extension notice/i }));
        expect(container.firstChild).toBeNull();
        expect(sessionStorage.getItem('xc:ext-banner:dismissed')).toBe('1');
    });

    it('starts in the active state when the preference was already persisted', () => {
        window.xchain = makeProvider();
        localStorage.setItem(EXT_WALLET_PREF_KEY, '1');
        render(<ExtensionBanner />);
        expect(screen.getByText(/Using your extension wallet/i)).toBeTruthy();
    });

    it('switches back to the web app, clearing the preference', () => {
        window.xchain = makeProvider();
        localStorage.setItem(EXT_WALLET_PREF_KEY, '1');
        render(<ExtensionBanner />);
        fireEvent.click(screen.getByRole('button', { name: 'Switch back' }));
        expect(localStorage.getItem(EXT_WALLET_PREF_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: 'Use extension wallet' })).toBeTruthy();
    });
});
