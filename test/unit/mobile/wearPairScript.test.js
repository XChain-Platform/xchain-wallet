// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync('packages/mobile/scripts/wear-pair.sh', 'utf8');
const androidTest = readFileSync(
    'packages/mobile/android/app/src/androidTest/java/io/xchain/wallet/android/watch/WatchPairedTest.java',
    'utf8',
);

describe('wear-pair.sh', () => {
    it('pins its device, AVD, image, forwarding, UI, and lifecycle contracts', () => {
        for (const value of [
            '--device',
            '--stop',
            'LG K500',
            'xc-phone-play',
            'xc-wear-large-round',
            'system-images;android-36;google_apis_playstore;arm64-v8a',
            'pixel_6',
            'forward tcp:5601 tcp:5601',
            'com.google.android.wearable.app',
            'uiautomator dump',
            "tap_text 'Pair with emulator'",
            "tap_text 'Pair'",
            'tmp/watch-sim',
            'wear-pair-$avd.pid',
            'missing Wear OS companion app',
            'missing Google sign-in',
            'io.xchain.wallet.android.watch.WatchPairedTest',
            "grep -Eq '^OK \\(1 test\\)$'",
        ]) expect(script).toContain(value);
        expect(script).toContain('ps -p "$pid" -o command=');
        expect(script).toContain('kill "$pid"');
        expect(script).not.toMatch(/pkill|killall|adb kill-server/);
    });

    it('proves a nearby connected node advertises the Wear capability', () => {
        for (const value of [
            'getConnectedNodes()',
            'node.isNearby()',
            'getCapability(',
            'CapabilityClient.FILTER_REACHABLE',
            '"xchain_wear"',
        ]) expect(androidTest).toContain(value);
    });
});
