/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const requireCjs = createRequire(import.meta.url);
const config = requireCjs(join(desktop, 'electron-builder.config.cjs'));

function trueEntitlements(name) {
    const xml = readFileSync(join(desktop, 'build', name), 'utf8');
    return [...xml.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);
}

describe('desktop Electron fuses', () => {
    it('locks down Node entry points and protects packaged browser data', () => {
        expect(config.electronFuses).toEqual({
            runAsNode: false,
            enableNodeOptionsEnvironmentVariable: false,
            enableNodeCliInspectArguments: false,
            enableCookieEncryption: true,
            enableEmbeddedAsarIntegrityValidation: true,
        });
    });
});

describe('desktop runtime resources', () => {
    it('packages the icon used by the Windows and Linux tray', () => {
        expect(config.files).toContain('build/icon.png');
    });
});

describe('desktop macOS packaging', () => {
    it('packages the QR camera consent text and least-privilege hardened runtime entitlements', () => {
        expect(config.mac.hardenedRuntime).toBe(true);
        expect(config.mac.extendInfo.NSCameraUsageDescription).toMatch(/QR/i);
        expect(trueEntitlements('entitlements.mac.plist')).toEqual([
            'com.apple.security.cs.allow-jit',
            'com.apple.security.device.camera',
        ]);
    });

    it('grants the QR camera to the sandboxed Mac App Store app', () => {
        expect(trueEntitlements('entitlements.mas.plist')).toContain(
            'com.apple.security.device.camera',
        );
    });
});
