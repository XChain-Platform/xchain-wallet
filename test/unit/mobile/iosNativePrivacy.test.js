// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(path), 'utf8');

describe('iOS native privacy boundaries', () => {
    it('declares only the usage descriptions exercised by native code', () => {
        const info = read('packages/mobile/ios/App/App/Info.plist');
        const entries = [...info.matchAll(
            /<key>(NS\w*UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g,
        )].map(([, key, text]) => [key, text]);

        expect(entries.map(([key]) => key).sort()).toEqual([
            'NSCameraUsageDescription',
            'NSFaceIDUsageDescription',
        ]);
        expect(Object.fromEntries(entries)).toMatchObject({
            NSCameraUsageDescription: expect.stringMatching(/camera.*scan QR codes/i),
            NSFaceIDUsageDescription: expect.stringMatching(/Face ID.*unlock.*does not approve/i),
        });
        for (const [, text] of entries) expect(text).not.toMatch(/[<$>&]|\$\(/);
    });

    it('settles scanner close only after camera shutdown and closes on background', () => {
        const view = read(
            'packages/mobile/ios/App/App/vault/VaultQrScannerViewController.swift',
        );
        const coordinator = read('packages/mobile/ios/App/App/vault/VaultQrScan.swift');

        expect(view).toMatch(
            /sessionQueue\.async \{[\s\S]*?session\.stopRunning\(\)[\s\S]*?teardown\.leave\(\)/,
        );
        expect(view).toMatch(
            /teardown\.notify\(queue: \.main\) \{[\s\S]*?waiters\.forEach \{ \$0\(\) \}/,
        );
        expect(coordinator).toMatch(
            /UIApplication\.didEnterBackgroundNotification[\s\S]*?closedItself\(open, \.interrupted\)/,
        );
    });

    it('contains root overscroll inside the themed WKWebView document', () => {
        const controller = read('packages/mobile/ios/App/App/MainViewController.swift');
        const didLoad = controller.match(
            /override func capacitorDidLoad\(\) \{([\s\S]*?)\n    \}/,
        );

        expect(didLoad).not.toBeNull();
        expect(didLoad[1]).toMatch(/webView\?\.scrollView\.bounces = false/);
        expect(didLoad[1]).toMatch(/webView\?\.scrollView\.alwaysBounceVertical = false/);
        expect(didLoad[1]).toMatch(/webView\?\.scrollView\.alwaysBounceHorizontal = false/);
    });
});
