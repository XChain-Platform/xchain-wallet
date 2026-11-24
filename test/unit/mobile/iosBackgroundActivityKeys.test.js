// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(resolve(path), 'utf8');
const appDelegate = read('packages/mobile/ios/App/App/AppDelegate.swift');
const backgroundCheck = read(
    'packages/mobile/ios/App/App/activity/BackgroundActivityCheck.swift',
);
const infoPlist = read('packages/mobile/ios/App/App/Info.plist');

function stringArrayForKey(plist, key) {
    const match = plist.match(new RegExp(
        `<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`,
    ));
    expect(match).not.toBeNull();
    const values = [...match[1].matchAll(/<string>([^<]*)<\/string>/g)]
        .map(([, value]) => value);
    expect(match[1].replace(/<string>[^<]*<\/string>/g, '').trim()).toBe('');
    return values;
}

describe('iOS background activity launch configuration', () => {
    it('permits exactly the background activity task identifier', () => {
        const identifier = backgroundCheck.match(
            /static let taskIdentifier\s*=\s*"([^"]+)"/,
        );

        expect(identifier).not.toBeNull();
        expect(stringArrayForKey(
            infoPlist,
            'BGTaskSchedulerPermittedIdentifiers',
        )).toEqual([identifier[1]]);
    });

    it('enables only background fetch', () => {
        expect(stringArrayForKey(infoPlist, 'UIBackgroundModes')).toEqual(['fetch']);
    });

    it('registers the activity check before launch returns', () => {
        const launch = appDelegate.match(
            /didFinishLaunchingWithOptions[^\n]*\) -> Bool \{([\s\S]*?)\n    \}/,
        );

        expect(launch).not.toBeNull();
        expect(launch[1].indexOf('BackgroundActivityCheck.register()')).toBeGreaterThanOrEqual(0);
        expect(launch[1].indexOf('BackgroundActivityCheck.register()'))
            .toBeLessThan(launch[1].indexOf('return true'));
    });

    it('keeps multiple scenes disabled', () => {
        expect(infoPlist).toMatch(
            /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/,
        );
    });
});
