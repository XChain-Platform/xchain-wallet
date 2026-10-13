// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the update notice puts on screen, and what it must not (§6, D4).
//
// The lane gate has its own tests; this is the other half of the same rule.
// Both mobile shells and the web shell mount `UpdateNoticeBanner` from the one
// shared bundle, so "renders nothing without a lane" has to be true of the
// COMPONENT and not only of the module that installs the provider - a mounted
// component that fetched first and checked afterwards would still be a store
// build reaching a download feed.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { UpdateNoticeBanner } from '../../../packages/core/src/shared/components/UpdateNoticeBanner.jsx';
import { AboutSection } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { setDirectUpdateProvider } from '../../../packages/core/src/flows/directUpdate.js';

function lane({ notice = null, version = '9.9.9', enabled = true, onEnable = () => {} } = {}) {
    const check = vi.fn(async () => (notice ? { version, notice } : null));
    setDirectUpdateProvider({
        check,
        isEnabled: () => enabled,
        setEnabled: onEnable,
        feedUrl: 'https://downloads.xchain.io/wallet/android/latest.json',
    });
    return check;
}

beforeEach(() => {
    setDirectUpdateProvider(null);
    sessionStorage.clear();
});
afterEach(() => {
    cleanup();
    setDirectUpdateProvider(null);
    sessionStorage.clear();
});

describe('UpdateNoticeBanner', () => {
    it('renders nothing, and asks nothing, with no lane installed', async () => {
        const { container } = render(<UpdateNoticeBanner />);
        await waitFor(() => expect(container.firstChild).toBeNull());
    });

    it('renders the app-composed sentence when the lane reports a newer version', async () => {
        lane({ notice: 'XChain Wallet 9.9.9 is available. You installed this app directly.' });
        render(<UpdateNoticeBanner />);
        expect(await screen.findByText(/XChain Wallet 9\.9\.9 is available/)).toBeTruthy();
    });

    it('offers no link and no download, only a dismiss', async () => {
        lane({ notice: 'XChain Wallet 9.9.9 is available.' });
        const { container } = render(<UpdateNoticeBanner />);
        await screen.findByText(/9\.9\.9/);
        // The feed carries one semver field and nothing rendered comes from it.
        // An anchor here would be a remote-controlled destination inside a
        // wallet, which is the phishing surface the whole design refuses.
        expect(container.querySelectorAll('a').length).toBe(0);
        const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent);
        expect(buttons).toEqual(['Dismiss']);
    });

    it('stays dismissed across remounts for the same session and version', async () => {
        const check = lane({ notice: 'XChain Wallet 9.9.9 is available.' });
        const view = render(<UpdateNoticeBanner />);
        (await screen.findByLabelText('Dismiss update notice')).click();
        await waitFor(() => expect(view.container.firstChild).toBeNull());
        expect(sessionStorage.getItem('xc:update-notice:dismissed-version')).toBe('9.9.9');

        view.unmount();
        const remount = render(<UpdateNoticeBanner />);
        await waitFor(() => expect(check).toHaveBeenCalledTimes(2));
        expect(remount.container.firstChild).toBeNull();
    });

    it('shows a later version after an earlier version was dismissed', async () => {
        sessionStorage.setItem('xc:update-notice:dismissed-version', '9.9.9');
        lane({
            version: '10.0.0',
            notice: 'XChain Wallet 10.0.0 is available.',
        });

        render(<UpdateNoticeBanner />);

        expect(await screen.findByText(/10\.0\.0/)).toBeTruthy();
    });

    it('does not move focus when an asynchronous notice appears', async () => {
        lane({ notice: 'XChain Wallet 9.9.9 is available.' });
        render(
            <>
                <button type="button">Primary action</button>
                <UpdateNoticeBanner />
            </>,
        );
        const primary = screen.getByRole('button', { name: 'Primary action' });
        primary.focus();

        await screen.findByText(/9\.9\.9/);

        expect(primary).toHaveFocus();
    });

    it('says nothing when the lane has nothing to say', async () => {
        const check = lane({ notice: null });
        const { container } = render(<UpdateNoticeBanner />);
        await waitFor(() => expect(check).toHaveBeenCalled());
        expect(container.firstChild).toBeNull();
    });
});

describe('AboutSection: the switch exists only where the lane does', () => {
    const about = () => render(
        <MessagingProvider><AboutSection /></MessagingProvider>,
    );

    it('shows no update setting on a shell something else updates', () => {
        about();
        expect(screen.queryByLabelText('Check for new versions')).toBeNull();
    });

    it('shows the switch on a direct install, reflecting the stored preference', () => {
        lane({ enabled: false });
        about();
        const toggle = screen.getByLabelText('Check for new versions');
        expect(toggle.checked).toBe(false);
    });

    it('drives the preference through the provider', () => {
        const onEnable = vi.fn();
        lane({ enabled: true, onEnable });
        about();
        screen.getByLabelText('Check for new versions').click();
        expect(onEnable).toHaveBeenCalledWith(false);
    });

    it('explains the request in plain language, naming no API and no vendor', () => {
        lane();
        about();
        const hint = screen.getByText(/Checks our download site once a day/i).textContent;
        expect(hint).toMatch(/does not download or install them or send wallet data/i);
        expect(hint).not.toMatch(/Play|Google|API|endpoint|JSON|semver/i);
    });
});
