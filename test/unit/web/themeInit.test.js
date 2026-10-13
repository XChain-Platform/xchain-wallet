// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

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
                return storedTheme === undefined
                    ? null
                    : JSON.stringify({ theme: storedTheme });
            },
        },
        matchMedia: vi.fn(() => ({ matches: osDark })),
        Capacitor: { Plugins: { SystemBars: { setStyle } } },
    };
    context.window = context;
    vm.runInNewContext(webScript, context);
    return { attrs, setStyle, themeColor };
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

    it('starts native status bars with contrast for the white splash', () => {
        const config = JSON.parse(readFileSync(resolve('packages/mobile/capacitor.config.json'), 'utf8'));
        const androidStyles = readFileSync(
            resolve('packages/mobile/android/app/src/main/res/values/styles.xml'),
            'utf8',
        );
        const iosInfo = readFileSync(resolve('packages/mobile/ios/App/App/Info.plist'), 'utf8');

        expect(config.plugins.SystemBars.style).toBe('LIGHT');
        expect(androidStyles).toContain('<item name="android:statusBarColor">#FFFFFF</item>');
        expect(androidStyles).toContain('<item name="android:windowLightStatusBar">true</item>');
        expect(iosInfo).toMatch(/<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleDarkContent<\/string>/);
    });
});
