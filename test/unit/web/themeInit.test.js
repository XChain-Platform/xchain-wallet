// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const webScript = readFileSync(resolve('packages/web/public/theme-init.js'), 'utf8');
const desktopScript = readFileSync(resolve('packages/desktop/renderer/public/theme-init.js'), 'utf8');

function runStartupTheme({ storedTheme, osDark = false, storageError = false } = {}) {
    const attrs = new Map([['data-xc-theme', 'stale']]);
    const themeColor = { setAttribute: vi.fn() };
    const setStyle = vi.fn(() => Promise.resolve());
    const mediaListeners = new Set();
    const pageListeners = new Map();
    let savedTheme = storedTheme;
    let systemDark = osDark;
    const mediaQuery = {
        get matches() { return systemDark; },
        addEventListener: vi.fn((type, listener) => {
            if (type === 'change') mediaListeners.add(listener);
        }),
        removeEventListener: vi.fn((type, listener) => {
            if (type === 'change') mediaListeners.delete(listener);
        }),
    };
    const context = {
        document: {
            documentElement: {
                setAttribute: (name, value) => attrs.set(name, value),
                removeAttribute: (name) => attrs.delete(name),
            },
            querySelector: () => themeColor,
        },
        localStorage: {
            getItem() {
                if (storageError) throw new Error('blocked');
                return savedTheme === undefined
                    ? null
                    : JSON.stringify({ theme: savedTheme });
            },
        },
        matchMedia: vi.fn(() => mediaQuery),
        addEventListener: vi.fn((type, listener) => pageListeners.set(type, listener)),
        removeEventListener: vi.fn((type, listener) => {
            if (pageListeners.get(type) === listener) pageListeners.delete(type);
        }),
        Capacitor: { Plugins: { SystemBars: { setStyle } } },
    };
    context.window = context;
    vm.runInNewContext(webScript, context);
    return {
        attrs,
        mediaQuery,
        setStyle,
        themeColor,
        setStoredTheme(theme) { savedTheme = theme; },
        setSystemDark(matches) {
            systemDark = matches;
            for (const listener of [...mediaListeners]) listener({ matches });
        },
        pagehide() { pageListeners.get('pagehide')?.(); },
    };
}

describe('startup theme', () => {
    it('keeps the web and desktop parser-blocking scripts identical', () => {
        expect(desktopScript).toBe(webScript);
    });

    it.each([
        ['dark', false, '#0B0F17', 'DARK'],
        ['light', true, '#FFFFFF', 'LIGHT'],
    ])('applies a saved %s choice before the OS theme', (theme, osDark, color, barStyle) => {
        const result = runStartupTheme({ storedTheme: theme, osDark });
        expect(result.attrs.get('data-xc-theme')).toBe(theme);
        expect(result.themeColor.setAttribute).toHaveBeenCalledWith('content', color);
        expect(result.setStyle).toHaveBeenCalledWith({ style: barStyle });
    });

    it('falls back to the OS palette when the cache is unavailable', () => {
        const result = runStartupTheme({ osDark: true, storageError: true });
        expect(result.attrs.has('data-xc-theme')).toBe(false);
        expect(result.themeColor.setAttribute).toHaveBeenCalledWith('content', '#0B0F17');
        expect(result.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    });

    it('follows system theme changes live, re-reads preference changes, and cleans up', () => {
        const result = runStartupTheme({ storedTheme: 'system', osDark: false });

        result.setSystemDark(true);
        expect(result.attrs.has('data-xc-theme')).toBe(false);
        expect(result.themeColor.setAttribute).toHaveBeenLastCalledWith('content', '#0B0F17');
        expect(result.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });

        result.setStoredTheme('light');
        result.setSystemDark(true);
        expect(result.attrs.get('data-xc-theme')).toBe('light');
        expect(result.themeColor.setAttribute).toHaveBeenLastCalledWith('content', '#FFFFFF');

        const callsBeforeCleanup = result.themeColor.setAttribute.mock.calls.length;
        result.pagehide();
        expect(result.mediaQuery.removeEventListener).toHaveBeenCalledWith(
            'change',
            expect.any(Function),
        );
        result.setSystemDark(false);
        expect(result.themeColor.setAttribute).toHaveBeenCalledTimes(callsBeforeCleanup);
    });

    it('injects the startup theme before every extension surface module', async () => {
        const { default: config } = await import('../../../packages/extension/vite.config.js');
        const plugin = config.plugins.find(({ name }) => name === 'xchain-startup-theme');
        expect(plugin).toBeTruthy();

        const tags = plugin.transformIndexHtml.handler();
        const startupScript = tags.find(({ tag }) => tag === 'script');
        const startupStyle = tags.find(({ tag }) => tag === 'style');
        expect(startupScript).toEqual({
            tag: 'script',
            attrs: { src: '/theme-init.js' },
            injectTo: 'head-prepend',
        });
        expect(startupStyle.children).toContain('html[data-xc-theme="dark"]');

        expect(Object.keys(config.build.rollupOptions.input)).toEqual(
            expect.arrayContaining(['popup', 'approval', 'sidepanel']),
        );
        const emitted = [];
        await plugin.buildStart.call({ emitFile: (asset) => emitted.push(asset) });
        expect(emitted).toEqual([{
            type: 'asset',
            fileName: 'theme-init.js',
            source: webScript,
        }]);
    });

    it('declares install metadata and theme colors for both browser palettes', () => {
        const html = readFileSync(resolve('packages/web/index.html'), 'utf8');
        const manifest = JSON.parse(
            readFileSync(resolve('packages/web/public/manifest.webmanifest'), 'utf8'),
        );

        expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
        expect(html).toContain('content="#FFFFFF" media="(prefers-color-scheme: light)"');
        expect(html).toContain('content="#0B0F17" media="(prefers-color-scheme: dark)"');
        expect(html).toContain('rel="apple-touch-icon"');
        expect(manifest).toMatchObject({
            name: 'XChain Wallet',
            short_name: 'XChain',
            display: 'standalone',
            theme_color: '#FFFFFF',
        });
        expect(manifest.icons.map(({ sizes }) => sizes)).toEqual(['192x192', '512x512']);
    });

    it.each([
        ['packages/web/index.html', '/theme-init.js', '/src/main.jsx'],
        ['packages/desktop/renderer/index.html', './theme-init.js', './main.jsx'],
    ])('loads the startup theme before the app entry in %s', (file, startupSrc, entrySrc) => {
        const html = readFileSync(resolve(file), 'utf8');
        expect(html.indexOf(`src="${startupSrc}"`)).toBeGreaterThan(-1);
        expect(html.indexOf(`src="${startupSrc}"`)).toBeLessThan(html.indexOf(`src="${entrySrc}"`));
        expect(html).toContain('html[data-xc-theme="dark"] body');
        expect(html).toContain('html[data-xc-theme="light"] body');
    });

    it('keeps native system bars legible through launch and per-screen iOS presentation', () => {
        const config = JSON.parse(readFileSync(resolve('packages/mobile/capacitor.config.json'), 'utf8'));
        const androidLightStyles = readFileSync(
            resolve('packages/mobile/android/app/src/main/res/values/styles.xml'),
            'utf8',
        );
        const androidDarkStyles = readFileSync(
            resolve('packages/mobile/android/app/src/main/res/values-night/styles.xml'),
            'utf8',
        );
        const iosInfo = readFileSync(resolve('packages/mobile/ios/App/App/Info.plist'), 'utf8');
        const iosQrScanner = readFileSync(
            resolve('packages/mobile/ios/App/App/vault/VaultQrScannerViewController.swift'),
            'utf8',
        );

        expect(config.plugins.SystemBars.style).toBe('DEFAULT');
        for (const [styles, color, lightContent] of [
            [androidLightStyles, '#FFFFFF', 'true'],
            [androidDarkStyles, '#0B0F17', 'false'],
        ]) {
            expect(styles).toContain(`<item name="android:statusBarColor">${color}</item>`);
            expect(styles).toContain(`<item name="android:navigationBarColor">${color}</item>`);
            expect(styles).toContain(`<item name="android:windowLightStatusBar">${lightContent}</item>`);
            expect(styles).toContain(`<item name="android:windowLightNavigationBar">${lightContent}</item>`);
        }
        expect(iosInfo).toMatch(/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDefault<\/string>/);
        expect(iosQrScanner).toMatch(
            /override var preferredStatusBarStyle: UIStatusBarStyle \{ \.lightContent \}/,
        );
    });

    it('keeps native launch screens bounded, theme-aware, and tied to shell readiness', () => {
        const lightStyles = readFileSync(
            resolve('packages/mobile/android/app/src/main/res/values/styles.xml'),
            'utf8',
        );
        const darkStyles = readFileSync(
            resolve('packages/mobile/android/app/src/main/res/values-night/styles.xml'),
            'utf8',
        );
        const iosLaunch = readFileSync(
            resolve('packages/mobile/ios/App/App/Base.lproj/LaunchScreen.storyboard'),
            'utf8',
        );

        expect(lightStyles).toContain('<item name="windowSplashScreenBackground">#FFFFFF</item>');
        expect(darkStyles).toContain('<item name="windowSplashScreenBackground">#0B0F17</item>');
        for (const styles of [lightStyles, darkStyles]) {
            expect(styles).toContain(
                '<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>',
            );
            expect(styles).toContain(
                '<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>',
            );
            expect(styles).not.toContain('<item name="android:background">@drawable/splash</item>');
        }
        expect(iosLaunch).toContain('<color key="backgroundColor" systemColor="systemBackgroundColor"/>');
        expect(iosLaunch).toContain('<color key="textColor" systemColor="labelColor"/>');
        expect(iosLaunch).not.toContain('image="Splash"');
        expect(iosLaunch).not.toContain('contentMode="scaleAspectFill"');
    });
});
