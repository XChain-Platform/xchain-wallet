// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop update banner (row 142).
//
// THE DEFECT THIS PINS is not a rendering bug, it is an absence: for as long
// as the desktop shell has had an updater, main broadcast `xchain:updater`
// into a channel no renderer could subscribe to, and `downloadAndInstall()`
// had no caller anywhere in the repo. The wallet checked for updates on
// launch, showed nothing, and could install nothing. So the assertions that
// matter here are that an `available` event REACHES a user as an offer, and
// that pressing the offer CALLS the install path - the two halves that were
// missing - plus the two refusals that keep the banner from becoming a
// phishing surface.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { DesktopUpdateBanner } from '../../../packages/desktop/renderer/DesktopUpdateBanner.jsx';

/**
 * Install a fake preload bridge and return a handle to drive it.
 *
 * `retained` is what main answers on the state channel: the last event it
 * saw, which on a locked install is an offer made long before this component
 * mounted (row 148). Pass `omitGetState` to model an older preload.
 */
function installBridge({
    install = vi.fn(async () => ({ ok: true })),
    retained = null,
    omitGetState = false,
} = {}) {
    let listener = null;
    const getState = vi.fn(async () => retained);
    window.xchainWalletUpdater = {
        onEvent(cb) { listener = cb; return () => { listener = null; }; },
        install,
        ...(omitGetState ? {} : { getState }),
    };
    return {
        install,
        getState,
        emit(event) { act(() => { listener?.(event); }); },
        get subscribed() { return listener !== null; },
    };
}

afterEach(() => { delete window.xchainWalletUpdater; });

describe('DesktopUpdateBanner', () => {
    it('renders nothing until main says an update exists', () => {
        installBridge();
        const { container } = render(React.createElement(DesktopUpdateBanner));
        expect(container.textContent).toBe('');
    });

    it('offers the update and starts the verified download without restarting', async () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'available', info: { version: '0.339.0' } });
        expect(screen.getByRole('status').textContent).toContain('0.339.0');

        const button = screen.getByRole('button', { name: /download update/i });
        await act(async () => { button.click(); });
        expect(bridge.install).toHaveBeenCalledWith('download');
        expect(screen.queryByRole('button', { name: /restart to update/i })).toBeNull();
    });

    it('floats over the page with side margins instead of spanning the full width', () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));
        bridge.emit({ type: 'available', info: { version: '0.339.0' } });

        const card = screen.getByRole('status');
        expect(card.style.position).toBe('fixed');
        expect(card.style.left).not.toBe('');
        expect(card.style.right).not.toBe('');
        expect(card.style.maxWidth).not.toBe('');
    });

    it('keeps the floating card inside the device safe-area insets', () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));
        bridge.emit({ type: 'available', info: { version: '0.339.0' } });

        const card = screen.getByRole('status');
        expect(card.style.top).toContain('env(safe-area-inset-top');
        expect(card.style.left).toContain('env(safe-area-inset-left');
        expect(card.style.right).toContain('env(safe-area-inset-right');
    });

    it('shows no version at all rather than a version the feed made up', () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        // A feed is the one input here an attacker could control, so the
        // version is printed only if it parses as a plain semver. Anything
        // else degrades to the constant sentence rather than rendering
        // remote text inside the wallet.
        bridge.emit({ type: 'available', info: { version: '9.9.9 <b>click here</b>' } });
        const text = screen.getByRole('status').textContent;
        expect(text).toContain('A newer version is available');
        expect(text).not.toContain('click here');
    });

    it('reports a refusal without quoting the reason, and says the wallet is untouched', async () => {
        const bridge = installBridge({ install: vi.fn(async () => ({ ok: false, reason: 'manifest says 0.1.2 not 0.339.0' })) });
        render(React.createElement(DesktopUpdateBanner));
        bridge.emit({ type: 'available', info: { version: '0.339.0' } });

        await act(async () => { screen.getByRole('button', { name: /download update/i }).click(); });

        const text = screen.getByRole('status').textContent;
        expect(text).toContain("couldn't be downloaded or verified");
        expect(text).toContain('wallet is untouched');
        expect(text).not.toContain('manifest says');
    });

    it('shows manual check progress and the up-to-date result', () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'checking', userInitiated: true });
        expect(screen.getByRole('status').textContent).toContain('Checking for updates');

        bridge.emit({ type: 'not-available', userInitiated: true, info: { version: '0.341.2' } });
        expect(screen.getByRole('status').textContent).toContain('XChain Wallet is up to date');
    });

    it('describes a check failure without claiming an update failed verification', () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'checking', userInitiated: true });
        bridge.emit({ type: 'error', userInitiated: true, info: { message: 'feed unavailable' } });

        const text = screen.getByRole('status').textContent;
        expect(text).toContain("Couldn't check for updates");
        expect(text).not.toContain('could not be verified');
        expect(text).not.toContain('feed unavailable');
    });

    it('retries a failed check through the updater bridge', async () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'checking', userInitiated: true });
        bridge.emit({ type: 'error', userInitiated: true, info: { message: 'offline' } });
        await act(async () => { screen.getByRole('button', { name: /retry/i }).click(); });

        expect(bridge.install).toHaveBeenCalledWith('check');
    });

    it('shows download progress, verification, and a separate ready-to-restart action', async () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));
        bridge.emit({ type: 'available', info: { version: '0.339.0' } });

        await act(async () => { screen.getByRole('button', { name: /download update/i }).click(); });
        bridge.emit({ type: 'progress', info: { percent: 42.4 } });
        expect(screen.getByRole('status').textContent).toContain('42%');

        bridge.emit({ type: 'verifying', info: { version: '0.339.0' } });
        expect(screen.getByRole('status').textContent).toContain('Verifying');

        bridge.emit({ type: 'ready', info: { version: '0.339.0' } });
        expect(screen.getByRole('status').textContent).toContain('ready to restart');
        await act(async () => { screen.getByRole('button', { name: /restart to update/i }).click(); });
        expect(bridge.install).toHaveBeenLastCalledWith('restart');
    });

    it('keeps a prepared update ready when restart is blocked by wallet work', async () => {
        const install = vi.fn(async (action) => (
            action === 'restart'
                ? { ok: false, reason: 'wallet operation in progress', retryable: true }
                : { ok: true }
        ));
        const bridge = installBridge({ install });
        render(React.createElement(DesktopUpdateBanner));
        bridge.emit({ type: 'ready', info: { version: '0.339.0' } });

        await act(async () => { screen.getByRole('button', { name: /restart to update/i }).click(); });

        expect(screen.getByRole('status').textContent).toContain('Finish the current wallet operation');
        expect(screen.getByRole('button', { name: /restart to update/i })).toBeTruthy();
    });

    it('keeps automatic checks quiet unless they find an update', () => {
        const bridge = installBridge();
        const { container } = render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'checking' });
        bridge.emit({ type: 'not-available', info: { version: '0.341.2' } });
        bridge.emit({ type: 'error', info: { message: 'feed unavailable' } });

        expect(container.textContent).toBe('');
    });

    // Main begins its launch check before it creates the renderer, so an
    // available offer must also survive an event that arrives before mount.
    it('shows an offer main made before it existed', async () => {
        const bridge = installBridge({ retained: { type: 'available', info: { version: '0.339.0' } } });
        render(React.createElement(DesktopUpdateBanner));

        await act(async () => { await Promise.resolve(); });

        expect(bridge.getState).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status').textContent).toContain('0.339.0');
    });

    it('stays silent about a stale failure it is only now hearing about', async () => {
        const bridge = installBridge({ retained: { type: 'error', info: { message: 'getaddrinfo ENOTFOUND' } } });
        const { container } = render(React.createElement(DesktopUpdateBanner));

        await act(async () => { await Promise.resolve(); });

        // A check that failed at launch is not a refused install. Telling a
        // user who just opened their wallet that an update "could not be
        // verified" would describe a download nobody attempted.
        expect(bridge.getState).toHaveBeenCalledTimes(1);
        expect(container.textContent).toBe('');
    });

    it('lets a live event overwrite what the retained state said', async () => {
        const bridge = installBridge({ retained: { type: 'available', info: { version: '0.339.0' } } });
        render(React.createElement(DesktopUpdateBanner));
        await act(async () => { await Promise.resolve(); });

        bridge.emit({ type: 'verifying' });

        expect(screen.getByRole('status').textContent).toContain('Verifying');
    });

    it('renders against a preload with no state channel rather than throwing', async () => {
        const bridge = installBridge({ omitGetState: true });
        const { container } = render(React.createElement(DesktopUpdateBanner));
        await act(async () => { await Promise.resolve(); });

        expect(container.textContent).toBe('');
        bridge.emit({ type: 'available', info: { version: '0.339.0' } });
        expect(screen.getByRole('status').textContent).toContain('0.339.0');
    });

    it('subscribes only when the preload bridge exists, so web and extension are unaffected', () => {
        delete window.xchainWalletUpdater;
        const { container } = render(React.createElement(DesktopUpdateBanner));
        expect(container.textContent).toBe('');
    });
});
