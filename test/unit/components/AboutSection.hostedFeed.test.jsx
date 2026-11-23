// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The desktop renderer's CSP refuses the About panel's own feed fetch, so the
// shell installs a host-backed source. These tests make the page fetch fail the
// way the CSP does and require the check to work through the source.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkShellForUpdates } from '../../../packages/core/src/shared/components/settings/AboutSection.jsx';
import { configureReleaseFeedSource } from '../../../packages/core/src/flows/releaseFeedSource.js';
import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';
import { WALLET_RELEASE_FEED_URL } from '../../../packages/core/src/branding/branding.js';

const [MAJOR, MINOR] = WALLET_VERSION.split('.').map(Number);
const NEWER = `${MAJOR}.${MINOR + 1}.0`;
const NEWEST = `${MAJOR}.${MINOR + 2}.0`;

const TARGETS = {
    'desktop-direct': `${new URL(WALLET_RELEASE_FEED_URL).origin}/wallet/desktop/`,
    'macos-appstore': 'https://apps.apple.com/app/xchain-wallet/id123',
    'windows-store': 'https://apps.microsoft.com/detail/xchain-wallet',
    snap: 'https://snapcraft.io/xchain-wallet',
};

function feedText(versions = {}) {
    return JSON.stringify({
        latest: NEWEST,
        channels: Object.fromEntries(Object.entries(TARGETS).map(([channel, url]) => [
            channel,
            { version: versions[channel] || NEWER, url },
        ])),
    });
}

function desktopEnv(channel) {
    return {
        fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
        open: vi.fn(),
        navigator: { userAgent: '' },
        xchainWalletUpdater: {
            getChannel: vi.fn().mockResolvedValue(channel),
            install: vi.fn().mockResolvedValue({ ok: true }),
        },
    };
}

afterEach(() => {
    configureReleaseFeedSource();
});

describe('About update check through a host-backed feed source', () => {
    it.each(Object.keys(TARGETS))('reads the feed for the %s channel without a page fetch', async (channel) => {
        const env = desktopEnv(channel);
        const fetchText = vi.fn().mockResolvedValue(feedText());
        configureReleaseFeedSource({ fetchText });

        const result = await checkShellForUpdates('desktop', env);

        expect(result).toMatchObject({ status: 'available', version: NEWER });
        expect(fetchText).toHaveBeenCalledOnce();
        expect(env.fetch).not.toHaveBeenCalled();
    });

    it('reports a store build as pending while its review lags the latest release', async () => {
        const env = desktopEnv('macos-appstore');
        configureReleaseFeedSource({
            fetchText: async () => feedText({ 'macos-appstore': WALLET_VERSION }),
        });

        const result = await checkShellForUpdates('desktop', env);

        expect(result).toMatchObject({ status: 'pending', version: NEWEST, storeName: 'Mac App Store' });
    });

    it('falls back to the page fetch when no source is installed', async () => {
        const env = desktopEnv('desktop-direct');
        env.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => feedText() });

        const result = await checkShellForUpdates('desktop', env);

        expect(result).toMatchObject({ status: 'available', version: NEWER });
        expect(env.fetch).toHaveBeenCalledOnce();
    });

    it('still refuses an oversize or malformed feed from the source', async () => {
        const env = desktopEnv('desktop-direct');
        configureReleaseFeedSource({ fetchText: async () => 'x'.repeat(4097) });
        await expect(checkShellForUpdates('desktop', env)).rejects.toThrow('invalid update feed');

        configureReleaseFeedSource({ fetchText: async () => '{"latest":"nope","channels":{}}' });
        await expect(checkShellForUpdates('desktop', env)).rejects.toThrow('invalid update feed');
    });

    it('surfaces a source failure as a failed check', async () => {
        const env = desktopEnv('desktop-direct');
        configureReleaseFeedSource({ fetchText: async () => { throw new Error('update feed unavailable'); } });

        await expect(checkShellForUpdates('desktop', env)).rejects.toThrow('update feed unavailable');
    });
});

describe('desktop-direct Update action', () => {
    async function availableUpdate(env) {
        configureReleaseFeedSource({ fetchText: async () => feedText() });
        return checkShellForUpdates('desktop', env);
    }

    // Main's download step checks for the offer itself (updater.js
    // prepareUpdate), so the renderer asks for the download alone.
    it('asks the updater for one download', async () => {
        const env = desktopEnv('desktop-direct');
        const result = await availableUpdate(env);

        await result.getUpdate();

        expect(env.xchainWalletUpdater.install.mock.calls).toEqual([['download']]);
    });

    it('fails when the download is refused', async () => {
        const env = desktopEnv('desktop-direct');
        env.xchainWalletUpdater.install.mockResolvedValueOnce({ ok: false, reason: 'no update available for this install' });
        const result = await availableUpdate(env);

        await expect(result.getUpdate()).rejects.toThrow('desktop update failed');
    });
});

describe('desktop renderer CSP', () => {
    it('keeps connect-src at self in both the header policy and the page policy', () => {
        const security = readFileSync(resolve(process.cwd(), 'packages/desktop/main/security.js'), 'utf8');
        const page = readFileSync(resolve(process.cwd(), 'packages/desktop/renderer/index.html'), 'utf8');

        expect(security).toContain(`"connect-src 'self'",`);
        expect(page).toMatch(/content="[^"]*connect-src 'self';/);
        expect(security).not.toMatch(/connect-src[^\n]*https?:/);
        expect(page).not.toMatch(/connect-src[^;]*https?:/);
    });
});
