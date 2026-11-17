// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    AboutSection,
    checkShellForUpdates,
    parseReleaseFeed,
} from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import {
    WALLET_RELEASE_FEED_URL,
    WEB_WALLET_URL,
} from '../../../packages/core/src/branding/branding.js';
import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';

afterEach(() => {
    cleanup();
    delete window.xchainWalletUpdater;
    vi.unstubAllGlobals();
});

function mount(checkForUpdates, shell = 'web') {
    return render(
        <MessagingProvider shell={shell} messaging={{}}>
            <AboutSection checkForUpdates={checkForUpdates} />
        </MessagingProvider>,
    );
}

function checkButton() {
    return screen.getByRole('button', { name: /Check for Updates/i });
}

const TARGETS = Object.freeze({
    web: 'https://wallet.xchain.io/',
    chrome: 'https://chromewebstore.google.com/detail/hpgekccmlajjbeckcjbldjinajmhchfp',
    firefox: 'https://addons.mozilla.org/firefox/addon/xchain-wallet/',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/xchain-wallet/abc',
    ios: 'https://apps.apple.com/app/xchain-wallet/id123',
    'macos-appstore': 'https://apps.apple.com/app/xchain-wallet/id123',
    'android-play': 'https://play.google.com/store/apps/details?id=io.xchain.wallet.android',
    'android-direct': 'https://downloads.xchain.io/wallet/android/xchain-wallet-v0.343.0.apk',
    'windows-store': 'https://apps.microsoft.com/detail/xchain-wallet',
    'desktop-direct': 'https://downloads.xchain.io/wallet/desktop/',
    snap: 'https://snapcraft.io/xchain-wallet',
});

function feedBody({ latest = '0.343.0', versions = {} } = {}) {
    return JSON.stringify({
        latest,
        channels: Object.fromEntries(Object.entries(TARGETS).map(([channel, url]) => [
            channel,
            { version: versions[channel] || '0.343.0', url },
        ])),
    });
}

function envFor(channel, body = feedBody()) {
    const env = {
        fetch: vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue(body) }),
        location: { reload: vi.fn() },
        navigator: { userAgent: '' },
        open: vi.fn(),
    };
    let shell = 'desktop';
    if (channel === 'web') shell = 'web';
    if (channel === 'chrome') {
        shell = 'popup';
        env.navigator.userAgent = 'Mozilla/5.0 Chrome/120.0';
    } else if (channel === 'firefox') {
        shell = 'popup';
        env.navigator.userAgent = 'Mozilla/5.0 Firefox/120.0';
    } else if (channel === 'edge') {
        shell = 'popup';
        env.navigator.userAgent = 'Mozilla/5.0 Chrome/120.0 Edg/120.0';
    } else if (channel === 'ios') {
        shell = 'web';
        env.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'ios',
            Plugins: {},
        };
    } else if (channel === 'android-play' || channel === 'android-direct') {
        shell = 'web';
        env.Capacitor = {
            isNativePlatform: () => true,
            getPlatform: () => 'android',
            Plugins: {
                XChainVault: {
                    getInstallOrigin: vi.fn().mockResolvedValue({
                        channel: channel === 'android-play' ? 'store' : 'direct',
                    }),
                },
            },
        };
    } else if (!['web', 'chrome', 'firefox', 'edge', 'ios'].includes(channel)) {
        env.xchainWalletUpdater = {
            getChannel: vi.fn().mockResolvedValue(channel),
            install: vi.fn().mockResolvedValue({ ok: true }),
        };
    }
    return { env, shell };
}

describe('AboutSection update check', () => {
    it('shows the installed version in a titled Notice Standard success result', async () => {
        const checker = vi.fn().mockResolvedValue({ status: 'latest', version: WALLET_VERSION });
        mount(checker);

        fireEvent.click(checkButton());

        const notice = await screen.findByRole('status');
        expect(notice).toHaveTextContent('Up to date');
        expect(notice).toHaveTextContent(`You're on the latest version (v${WALLET_VERSION}).`);
        expect(notice.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
        expect(checker).toHaveBeenCalledOnce();
    });

    it('shows a newer version with the Update action', async () => {
        const getUpdate = vi.fn();
        const checker = vi.fn().mockResolvedValue({
            status: 'available',
            version: '0.343.0',
            getUpdate,
        });
        mount(checker);

        fireEvent.click(checkButton());

        const notice = await screen.findByRole('status');
        expect(notice).toHaveTextContent('Update available');
        expect(notice).toHaveTextContent('Update available: v0.343.0.');
        const actions = notice.querySelectorAll('button');
        expect(actions).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Update' }));
        expect(getUpdate).toHaveBeenCalledOnce();
    });

    it('shows only the labelled error icon after failure and retries from the row', async () => {
        const checker = vi.fn()
            .mockRejectedValueOnce(new Error('private endpoint detail'))
            .mockResolvedValueOnce({ status: 'latest', version: WALLET_VERSION });
        mount(checker);

        fireEvent.click(checkButton());

        expect(await screen.findByLabelText('Update check failed')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByText('private endpoint detail')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
        expect(checkButton()).not.toHaveAttribute('aria-disabled');

        fireEvent.click(checkButton());
        expect(await screen.findByText(`You're on the latest version (v${WALLET_VERSION}).`))
            .toBeInTheDocument();
        expect(checker).toHaveBeenCalledTimes(2);
    });

    it('shows a spinner and cannot start a second check while one is pending', async () => {
        let resolveCheck;
        const checker = vi.fn(() => new Promise((resolve) => { resolveCheck = resolve; }));
        mount(checker);

        const row = checkButton();
        fireEvent.click(row);
        fireEvent.click(row);

        expect(checker).toHaveBeenCalledOnce();
        const checkingRow = checkButton();
        expect(checkingRow).not.toHaveAttribute('aria-disabled');
        expect(checkingRow).toHaveAttribute('aria-busy', 'true');
        expect(checkingRow).toHaveTextContent('Check for Updates');
        expect(checkingRow).not.toHaveTextContent('Checking for updates');
        expect(document.querySelector('[class*="updateIconSpinning"]')).not.toBeNull();
        expect(screen.queryByRole('status')).toBeNull();

        await act(async () => {
            resolveCheck({ status: 'latest', version: WALLET_VERSION });
        });
        expect(screen.getByText(`You're on the latest version (v${WALLET_VERSION}).`))
            .toBeInTheDocument();
    });

    it('uses the release feed with no credentials or referrer for the web shell', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue(feedBody({ latest: WALLET_VERSION, versions: Object.fromEntries(Object.keys(TARGETS).map((key) => [key, WALLET_VERSION])) })),
        });
        vi.stubGlobal('fetch', fetchImpl);
        mount();

        fireEvent.click(checkButton());

        expect(await screen.findByText(`You're on the latest version (v${WALLET_VERSION}).`))
            .toBeInTheDocument();
        expect(fetchImpl).toHaveBeenCalledWith(WALLET_RELEASE_FEED_URL, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        });
    });

    it('shows the store-review result and opens the web wallet', async () => {
        const getUpdate = vi.fn();
        mount(vi.fn().mockResolvedValue({
            status: 'pending',
            version: '0.344.0',
            storeName: 'Chrome Web Store',
            getUpdate,
        }));

        fireEvent.click(checkButton());

        expect(await screen.findByText(/Version v0.344.0 is out but is still waiting for Chrome Web Store review/))
            .toHaveTextContent('Your update will arrive there soon. To use the new version now, open the web wallet.');
        fireEvent.click(screen.getByRole('button', { name: 'Open web wallet' }));
        expect(getUpdate).toHaveBeenCalledOnce();
    });

    it('uses the standard spinner motion and stops it for reduced motion', () => {
        const css = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/components/settings/AboutSection.module.css'),
            'utf8',
        );
        expect(css).toMatch(/updateIconSpinning[\s\S]*animation:\s*about-update-spin 0\.7s linear infinite/);
        expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*updateIconSpinning[\s\S]*animation:\s*none/);
    });
});

describe('release channel update targets', () => {
    it.each(Object.keys(TARGETS))('uses the %s channel target', async (channel) => {
        const { env, shell } = envFor(channel);
        const result = await checkShellForUpdates(shell, env);
        expect(result).toMatchObject({ status: 'available', version: '0.343.0' });
        await result.getUpdate();

        if (channel === 'web') {
            expect(env.location.reload).toHaveBeenCalledOnce();
            expect(env.open).not.toHaveBeenCalled();
        } else if (channel === 'desktop-direct') {
            expect(env.xchainWalletUpdater.install).toHaveBeenCalledWith('download');
            expect(env.open).not.toHaveBeenCalled();
        } else {
            expect(env.open).toHaveBeenCalledWith(TARGETS[channel], '_blank', 'noopener,noreferrer');
        }
    });

    it('reports a release still waiting for the detected store', async () => {
        const versions = Object.fromEntries(Object.keys(TARGETS).map((key) => [key, WALLET_VERSION]));
        const { env, shell } = envFor('chrome', feedBody({ latest: '0.344.0', versions }));
        const result = await checkShellForUpdates(shell, env);
        expect(result).toMatchObject({
            status: 'pending',
            version: '0.344.0',
            storeName: 'Chrome Web Store',
        });
        result.getUpdate();
        expect(env.open).toHaveBeenCalledWith(WEB_WALLET_URL, '_blank', 'noopener,noreferrer');
    });

    it('falls back to latest and the web wallet for an unknown channel', async () => {
        const { env, shell } = envFor('chrome');
        env.navigator.userAgent = 'Unknown Browser';
        const result = await checkShellForUpdates(shell, env);
        expect(result).toMatchObject({ status: 'available', version: '0.343.0' });
        result.getUpdate();
        expect(env.open).toHaveBeenCalledWith(WEB_WALLET_URL, '_blank', 'noopener,noreferrer');
    });

    it('rejects malformed versions and off-store update targets', () => {
        expect(() => parseReleaseFeed({ latest: 'v1', channels: {} })).toThrow('invalid update feed');
        expect(() => parseReleaseFeed({
            latest: '1.0.0',
            channels: { chrome: { version: '1.0.0', url: 'https://example.com/wallet' } },
        })).toThrow('invalid update target');
    });
});
