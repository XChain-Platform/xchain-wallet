// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The desktop update banner ( row 142).
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

/** Install a fake preload bridge and return a handle to drive it. */
function installBridge({ install = vi.fn(async () => ({ ok: true })) } = {}) {
    let listener = null;
    window.xchainWalletUpdater = {
        onEvent(cb) { listener = cb; return () => { listener = null; }; },
        install,
    };
    return {
        install,
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

    it('offers the update, and the offer calls the verified install path', async () => {
        const bridge = installBridge();
        render(React.createElement(DesktopUpdateBanner));

        bridge.emit({ type: 'available', info: { version: '0.339.0' } });
        expect(screen.getByRole('status').textContent).toContain('0.339.0');

        const button = screen.getByRole('button', { name: /install and restart/i });
        await act(async () => { button.click(); });
        // The whole point of the row: a user action reaches
        // downloadAndInstall(), which is what runs the S5 manifest gate
        // and then quitAndInstall().
        expect(bridge.install).toHaveBeenCalledTimes(1);
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

        await act(async () => { screen.getByRole('button', { name: /install and restart/i }).click(); });

        const text = screen.getByRole('status').textContent;
        expect(text).toContain('could not be verified');
        expect(text).toContain('wallet is untouched');
        expect(text).not.toContain('manifest says');
    });

    it('subscribes only when the preload bridge exists, so web and extension are unaffected', () => {
        delete window.xchainWalletUpdater;
        const { container } = render(React.createElement(DesktopUpdateBanner));
        expect(container.textContent).toBe('');
    });
});
