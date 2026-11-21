// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const entitlementPaths = [
    'packages/mobile/ios/App/WatchApp/WatchApp.entitlements',
    'packages/mobile/ios/App/WatchWidgets/WatchWidgets.entitlements',
];
const expectedGroup = 'group.io.xchain.wallet.ios.watch';

function readPlistEntries(path) {
    const source = readFileSync(resolve(path), 'utf8');
    const dict = source.match(/<plist version="1\.0">\s*<dict>([\s\S]*?)<\/dict>\s*<\/plist>\s*$/);
    if (!dict) throw new Error(`${path} does not contain a top-level plist dict`);

    const entryPattern = /<key>([^<]+)<\/key>\s*<array>([\s\S]*?)<\/array>/g;
    const entries = [...dict[1].matchAll(entryPattern)].map(([, key, array]) => {
        const stringPattern = /<string>([^<]*)<\/string>/g;
        const values = [...array.matchAll(stringPattern)].map((match) => match[1]);
        if (array.replace(stringPattern, '').trim()) {
            throw new Error(`${path} contains an unsupported array value`);
        }
        return [key, values];
    });
    if (dict[1].replace(entryPattern, '').trim()) {
        throw new Error(`${path} contains an unsupported plist entry`);
    }
    return entries;
}

describe('watch entitlements', () => {
    it.each(entitlementPaths)('%s contains only the shared watch app group', (path) => {
        expect(readPlistEntries(path)).toEqual([
            ['com.apple.security.application-groups', [expectedGroup]],
        ]);
    });

    it('does not grant the watch app group to the phone app', () => {
        const phoneEntitlements = readFileSync(
            resolve('packages/mobile/ios/App/App/App.entitlements'),
            'utf8',
        );
        expect(phoneEntitlements).not.toContain('<key>com.apple.security.application-groups</key>');
    });

    if (process.platform === 'darwin') {
        it.each(entitlementPaths)('%s passes plutil lint', (path) => {
            execFileSync('plutil', ['-lint', resolve(path)], { stdio: 'pipe' });
        });
    } else {
        console.log('watch entitlement plutil checks skipped: plutil is macOS-only');
    }
});
