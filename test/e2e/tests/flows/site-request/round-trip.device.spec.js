// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';

import { requestLink } from '../../../fixtures/siteRequest.js';
import { androidViewArgs, iosOpenUrlArgs, parseAmStart } from '../../../fixtures/siteRequestLaunch.js';
import {
    androidSerial,
    expect,
    iosUdid,
    loginEnvelope,
    test,
    tool,
    until,
} from './round-trip.helpers.js';

test.describe('phone launch on device', () => {
    test('the Android device opens the wallet on the request link and the wallet stays up', async ({ dapp }) => {
        test.setTimeout(90_000);
        const serial = androidSerial();
        const installed = tool('adb', ['-s', serial, 'shell', 'pm', 'list', 'packages', 'io.xchain.wallet.android']);
        const packageName = process.env.XCHAIN_ANDROID_PACKAGE
            ?? ['io.xchain.wallet.android.debug', 'io.xchain.wallet.android'].find((name) => installed.split('\n').some((line) => line.trim() === `package:${name}`));
        expect(packageName, 'no XChain wallet package is installed on the device').toBeTruthy();

        const link = requestLink(loginEnvelope({ dappOrigin: dapp.origin }));
        tool('adb', ['-s', serial, 'logcat', '-c']);
        const run = spawnSync('adb', androidViewArgs(link, { packageName, serial, stopFirst: true }), {
            encoding: 'utf8',
            timeout: 60_000,
        });
        const started = parseAmStart(`${run.stdout}${run.stderr}`);
        expect(started.error).toBeNull();
        expect(started.ok).toBe(true);

        const resumed = await until(() => tool('adb', ['-s', serial, 'shell', 'dumpsys', 'activity', 'activities'])
            .split('\n').find((line) => line.includes('ResumedActivity') && line.includes(`${packageName}/`)));
        expect(resumed, 'the wallet activity is not the resumed one').toBeTruthy();

        await new Promise((done) => { setTimeout(done, 3000); });
        expect(tool('adb', ['-s', serial, 'shell', 'pidof', packageName]).trim(), 'the wallet process is gone').not.toBe('');
        const crash = tool('adb', ['-s', serial, 'logcat', '-d', '-b', 'crash']);
        expect(crash).not.toContain(packageName);
    });

    test('the iOS simulator opens the wallet on the request link and the wallet runs', async ({ dapp }) => {
        test.setTimeout(90_000);
        const udid = iosUdid();
        const bundle = process.env.XCHAIN_IOS_BUNDLE ?? 'io.xchain.wallet.ios';

        const link = requestLink(loginEnvelope({ dappOrigin: dapp.origin }));
        const isRunning = () => tool('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'])
            .split('\n').find((line) => line.includes(`UIKitApplication:${bundle}`));
        spawnSync('xcrun', ['simctl', 'terminate', udid, bundle], { encoding: 'utf8', timeout: 30_000 });
        const launch = spawnSync('xcrun', ['simctl', 'launch', udid, bundle], { encoding: 'utf8', timeout: 60_000 });
        expect(launch.status, `${launch.stdout}${launch.stderr}`).toBe(0);
        expect(await until(isRunning), `${bundle} did not launch`).toBeTruthy();

        const pidBefore = isRunning().trim().split(/\s+/)[0];
        const run = spawnSync('xcrun', iosOpenUrlArgs(link, { udid }), { encoding: 'utf8', timeout: 60_000 });
        expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

        const delivered = await until(() => tool('xcrun', [
            'simctl', 'spawn', udid, 'log', 'show', '--last', '90s', '--style', 'compact',
            '--predicate', 'eventMessage CONTAINS "Opening URL" AND eventMessage CONTAINS "' + bundle + '"',
        ]).split('\n').find((line) => line.includes(link.slice(0, 80))));
        expect(delivered, `the simulator never reported opening the request link with ${bundle}`).toBeTruthy();

        await new Promise((done) => { setTimeout(done, 3000); });
        const after = isRunning();
        expect(after, `${bundle} is not running after openurl`).toBeTruthy();
        expect(after.trim().split(/\s+/)[0], 'the wallet process was replaced while handling the link').toBe(pidBefore);
    });
});
