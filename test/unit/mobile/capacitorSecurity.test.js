// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(path), 'utf8');
const capacitorConfig = JSON.parse(read('packages/mobile/capacitor.config.json'));
const appGradle = read('packages/mobile/android/app/build.gradle');
const manifest = read('packages/mobile/android/app/src/main/AndroidManifest.xml');
const releaseNetwork = read(
    'packages/mobile/android/app/src/main/res/xml/network_security_config.xml',
);
const debugNetwork = read(
    'packages/mobile/android/app/src/debug/res/xml/network_security_config.xml',
);
const infoPlist = read('packages/mobile/ios/App/App/Info.plist');

function validateCapacitorConfig(config) {
    if (config.server?.androidScheme !== 'https') {
        throw new Error('Android WebView origin must use HTTPS');
    }
    if (!Array.isArray(config.server?.allowNavigation)
        || config.server.allowNavigation.length !== 0) {
        throw new Error('remote navigation must stay outside the wallet WebView');
    }
    if (config.android?.allowMixedContent !== false) {
        throw new Error('mixed content must be disabled');
    }
    if (Object.hasOwn(config.android ?? {}, 'webContentsDebuggingEnabled')) {
        throw new Error('WebView debugging must follow the native build type');
    }
}

describe('mobile transport and WebView security', () => {
    it('keeps the Capacitor origin secure and navigation local', () => {
        expect(() => validateCapacitorConfig(capacitorConfig)).not.toThrow();
    });

    it.each([
        ['an HTTP app origin', (config) => { config.server.androidScheme = 'http'; }],
        ['a remote navigation origin', (config) => { config.server.allowNavigation = ['example.com']; }],
        ['mixed content', (config) => { config.android.allowMixedContent = true; }],
        ['a build-independent debugging override', (config) => {
            config.android.webContentsDebuggingEnabled = false;
        }],
    ])('rejects %s', (_name, mutate) => {
        const candidate = structuredClone(capacitorConfig);
        mutate(candidate);
        expect(() => validateCapacitorConfig(candidate)).toThrow();
    });

    it('enables WebView debugging only for native debug builds', () => {
        expect(appGradle).toMatch(
            /release\s*\{\s*(?:\/\/[^\n]*\s*)*debuggable false/,
        );
        expect(appGradle).toMatch(/debug\s*\{\s*debuggable true/);
    });

    it('denies cleartext in release while preserving narrow debug endpoints', () => {
        expect(manifest).toContain('android:usesCleartextTraffic="false"');
        expect(manifest).toContain('android:networkSecurityConfig="@xml/network_security_config"');
        expect(releaseNetwork).toContain('cleartextTrafficPermitted="false"');
        expect(releaseNetwork).not.toContain('cleartextTrafficPermitted="true"');
        expect(debugNetwork).toMatch(/<base-config cleartextTrafficPermitted="false">/);
        expect(debugNetwork).toMatch(/<domain-config cleartextTrafficPermitted="true">/);
        expect(debugNetwork).toMatch(/<domain[^>]*>localhost<\/domain>/);
        expect(debugNetwork).toMatch(/<domain[^>]*>127\.0\.0\.1<\/domain>/);
        expect(debugNetwork).toMatch(/<domain[^>]*>10\.0\.2\.2<\/domain>/);
    });

    it('uses the default iOS App Transport Security policy', () => {
        expect(infoPlist).not.toContain('<key>NSAppTransportSecurity</key>');
        expect(infoPlist).not.toContain('<key>NSAllowsArbitraryLoads</key>');
        expect(infoPlist).not.toContain('<key>NSAllowsArbitraryLoadsInWebContent</key>');
    });
});
