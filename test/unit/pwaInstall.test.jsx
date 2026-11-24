// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFile } from 'node:fs/promises';
import React from 'react';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    act, cleanup, fireEvent, render, screen,
} from '@testing-library/react';
import { CommandPalette } from '../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { FullLayoutWithNav } from '../../packages/core/src/shared/components/LeftNav.jsx';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { Settings } from '../../packages/core/src/shared/routes/Settings.jsx';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import { Screen } from '../../packages/core/src/ui/Screen.jsx';
import {
    IOS_INSTALL_HINT_DISMISSED_KEY,
    IosInstallHint,
    usePwaInstall,
} from '../../packages/web/src/components/PwaInstall.jsx';

const root = process.cwd();
const originalInnerWidth = window.innerWidth;
const IOS_SAFARI_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IOS_CHROME_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1';

function mockDisplayMode(matches = false) {
    const listeners = new Set();
    const media = {
        matches,
        addEventListener: vi.fn((_name, listener) => listeners.add(listener)),
        removeEventListener: vi.fn((_name, listener) => listeners.delete(listener)),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    window.matchMedia = globalThis.matchMedia;
    return media;
}

function mockUserAgent(userAgent) {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

function InstallHarness() {
    const pwa = usePwaInstall(window);
    return (
        <>
            <CommandPalette
                open
                onClose={() => {}}
                commands={[]}
                menu={{
                    gates: {},
                    onSelect: () => {},
                    onOpenSettings: () => {},
                    onInstall: pwa.install,
                }}
            />
            <IosInstallHint
                show={pwa.showIosHint}
                currentView="home"
                browser={pwa.iosBrowser}
                onDismiss={pwa.dismissIosHint}
            />
        </>
    );
}

function SettingsInstallHarness() {
    const pwa = usePwaInstall(window);
    const messaging = {
        getSettings: vi.fn(async () => createDefaultSettings()),
        updateSettings: vi.fn(async () => createDefaultSettings()),
        listConnectedSites: vi.fn(async () => []),
        listContacts: vi.fn(async () => []),
    };
    return (
        <MessagingProvider shell="web" messaging={messaging}>
            <IosInstallHint
                show={pwa.showIosHint}
                currentView="settings"
                browser={pwa.iosBrowser}
                onDismiss={pwa.dismissIosHint}
            />
            <Settings onBack={() => {}} initialSubpageId="g-advanced" pwaInstall={pwa} />
        </MessagingProvider>
    );
}

afterEach(() => {
    cleanup();
    window.innerWidth = originalInnerWidth;
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('web app install prompt', () => {
    it('shows the menu install button only after Chromium offers installation and calls prompt', async () => {
        mockDisplayMode(false);
        const prompt = vi.fn(async () => {});
        render(<InstallHarness />);

        expect(screen.queryByRole('button', { name: 'Install App' })).toBeNull();
        const offer = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperty(offer, 'prompt', { value: prompt });
        act(() => window.dispatchEvent(offer));

        const install = screen.getByRole('button', { name: 'Install App' });
        expect(offer.defaultPrevented).toBe(true);
        await act(async () => fireEvent.click(install));
        expect(prompt).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Install App' })).toBeNull();
    });

    it('never shows the install button while already running standalone', () => {
        mockDisplayMode(true);
        const prompt = vi.fn(async () => {});
        render(<InstallHarness />);
        const offer = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperty(offer, 'prompt', { value: prompt });

        act(() => window.dispatchEvent(offer));

        expect(offer.defaultPrevented).toBe(false);
        expect(screen.queryByRole('button', { name: 'Install App' })).toBeNull();
        expect(prompt).not.toHaveBeenCalled();
    });
});

describe('iPhone Home hints', () => {
    it('shows the Safari Home hint, remembers dismissal, and keeps Settings available', async () => {
        mockDisplayMode(false);
        mockUserAgent(IOS_SAFARI_USER_AGENT);
        const first = render(<InstallHarness />);

        expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss install instructions.' }));
        expect(window.localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY)).toBe('1');
        first.unmount();
        render(<InstallHarness />);
        expect(screen.queryByText('Tap Share, then Add to Home Screen.')).toBeNull();
        cleanup();
        render(<SettingsInstallHarness />);
        expect(await screen.findByRole('button', { name: /^Add to Home Screen/ })).toBeVisible();
    });

    it('shows the Chrome Home hint on iPhone and hides every hint in standalone mode', () => {
        mockDisplayMode(false);
        mockUserAgent(IOS_CHROME_USER_AGENT);
        const chrome = render(<InstallHarness />);
        expect(screen.getByText('Tap Share in the address bar, then Add to Home Screen.')).toBeVisible();
        chrome.unmount();

        mockDisplayMode(true);
        mockUserAgent(IOS_SAFARI_USER_AGENT);
        render(<InstallHarness />);
        expect(screen.queryByText('Tap Share, then Add to Home Screen.')).toBeNull();
    });
});

describe('Settings installation', () => {
    it('hides the Settings row while running standalone', async () => {
        mockDisplayMode(true);
        render(<SettingsInstallHarness />);

        expect(await screen.findByRole('heading', { level: 1, name: 'Advanced' })).toBeVisible();
        expect(screen.queryByRole('button', { name: /^Add to Home Screen/ })).toBeNull();
    });

    it('uses the captured browser prompt directly from Settings', async () => {
        mockDisplayMode(false);
        const prompt = vi.fn(async () => {});
        render(<SettingsInstallHarness />);
        const install = await screen.findByRole('button', { name: /^Add to Home Screen/ });
        const offer = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperty(offer, 'prompt', { value: prompt });
        act(() => window.dispatchEvent(offer));

        fireEvent.click(install);

        await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
        expect(screen.getByRole('heading', { level: 1, name: 'Advanced' })).toBeVisible();
        expect(screen.queryByText('Open your browser menu, then choose Install App or Add to Home Screen.')).toBeNull();
    });

    it.each([
        [IOS_SAFARI_USER_AGENT, 'Tap Share, then Add to Home Screen.'],
        [IOS_CHROME_USER_AGENT, 'Tap Share in the address bar, then Add to Home Screen.'],
    ])('opens the matching iPhone steps from Settings', async (userAgent, steps) => {
        mockDisplayMode(false);
        mockUserAgent(userAgent);
        render(<SettingsInstallHarness />);

        fireEvent.click(await screen.findByRole('button', { name: /^Add to Home Screen/ }));

        expect(await screen.findAllByText(steps)).toHaveLength(1);
        expect(screen.getByText(steps)).toBeVisible();
        expect(document.querySelector('[data-ios-install-hint]')).toBeNull();
        expect(screen.getByRole('heading', { level: 1, name: 'Add to Home Screen' })).toBeVisible();
    });
});

describe('install hint layout', () => {
    it('renders the iOS hint in the scrolling body with one 8px gap before content', async () => {
        window.innerWidth = 390;
        const [appSource, hintStyleSource, noticeHostStyleSource] = await Promise.all([
            readFile(`${root}/packages/web/src/App.jsx`, 'utf8'),
            readFile(`${root}/packages/web/src/components/PwaInstall.module.css`, 'utf8'),
            readFile(`${root}/packages/core/src/shared/components/LeftNav.module.css`, 'utf8'),
        ]);
        const shellStart = appSource.indexOf('<FullLayoutWithNav');
        const shellEnd = appSource.indexOf('</FullLayoutWithNav>', shellStart);
        const shellSource = appSource.slice(shellStart, shellEnd);

        expect(shellStart).toBeGreaterThan(-1);
        expect(shellEnd).toBeGreaterThan(shellStart);
        expect(shellSource).toContain('<IosInstallHint');
        expect(appSource.slice(0, shellStart)).not.toContain('<IosInstallHint');

        const view = render(
            <FullLayoutWithNav
                routeKey="home"
                nav={<nav />}
                bottomBar={<nav data-testid="bottom-nav" />}
                notices={<IosInstallHint show currentView="home" browser="safari" onDismiss={() => {}} />}
            >
                <Screen header={<h1>Home</h1>}>Home content</Screen>
            </FullLayoutWithNav>,
        );
        const shell = view.container.firstElementChild;
        const scrollingBody = screen.getByRole('main');
        const hint = screen.getByText('Tap Share, then Add to Home Screen.');

        expect(shell).toContainElement(hint);
        expect(scrollingBody).toContainElement(hint);
        expect(scrollingBody.firstElementChild).toContainElement(hint);
        expect(shell).toContainElement(screen.getByTestId('bottom-nav'));
        expect(hintStyleSource).not.toMatch(/(?:margin|padding)(?:-block-end|-bottom)?\s*:/);
        expect(noticeHostStyleSource).toMatch(
            /\.notices:not\(:empty\)\s*\{[^}]*margin-bottom:\s*var\(--xc-space-3\);[^}]*\}/,
        );
        expect(noticeHostStyleSource).toMatch(
            /\.notices:has\(> \[data-ios-install-hint\]:last-child\)\s*\{[^}]*margin-bottom:\s*var\(--xc-space-2\);[^}]*\}/,
        );
    });
});

describe('web app metadata', () => {
    it('keeps the web manifest installable and publishes the iOS metadata', async () => {
        const [manifestText, indexHtml, icon] = await Promise.all([
            readFile(`${root}/packages/web/public/manifest.webmanifest`, 'utf8'),
            readFile(`${root}/packages/web/index.html`, 'utf8'),
            sharp(`${root}/packages/web/public/icons/apple-touch-icon-180.png`).metadata(),
        ]);
        const manifest = JSON.parse(manifestText);
        const document = new DOMParser().parseFromString(indexHtml, 'text/html');
        const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');

        expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
        expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
        expect(document.querySelector('link[rel="manifest"]')?.getAttribute('href')).toBe('/manifest.webmanifest');
        expect(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes');
        expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('default');
        expect(touchIcon?.getAttribute('sizes')).toBe('180x180');
        expect(touchIcon?.getAttribute('href')).toBe('/icons/apple-touch-icon-180.png');
        expect(icon).toMatchObject({ width: 180, height: 180 });
    });
});
