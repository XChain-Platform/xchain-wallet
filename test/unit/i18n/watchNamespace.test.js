// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { t } from '../../../packages/core/src/i18n/index.js';
import '../../../packages/core/src/i18n/locales/en/watch.js';

const expected = {
    'watch.title': 'Watch',
    'watch.showWallet': 'Show wallet on watch',
    'watch.tokens': 'Tokens on watch',
    'watch.tokens.followHome': 'Follow Home',
    'watch.tokens.pinnedOnly': 'Pinned only',
    'watch.startIn': 'Start in',
    'watch.startIn.fiat': 'Fiat',
    'watch.startIn.units': 'Units',
    'watch.showTotal': 'Show total on watch face and Tile',
    'watch.backgroundActivityCheck': 'Background activity check',
    'watch.value.on': 'On',
    'watch.value.off': 'Off',
    'watch.status.title': 'Status',
    'watch.status.paired': 'Paired',
    'watch.status.installed': 'Installed',
    'watch.status.reachable': 'Reachable',
    'watch.status.lastSync': 'Last sync',
    'watch.status.hint.pairApple': 'Pair a watch in the Apple Watch app',
    'watch.status.hint.installApple': 'Turn on XChain in the Apple Watch app',
    'watch.status.hint.installWear': 'Install XChain from Google Play on your watch',
    'watch.status.hint.unreachable': 'Bring your watch near',
    'watch.sendTestAlert': 'Send test alert',
    'watch.testAlert.title': 'Test alert',
    'watch.testAlert.body': 'Your watch is getting alerts.',
    'watch.removeData': 'Remove watch data',
    'watch.newActivity.title': 'New activity',
    'watch.newActivity.body': 'Open XChain Wallet to see what changed.',
    'watch.torUnavailable': 'Not available while Tor routing is on.',
    'watch.openOnPhone': 'Open on phone',
    'watch.mobileAutopayNotice':
        'Auto pay runs only while XChain Wallet is open on this phone. To keep auto pay running when you are away, leave the XChain Wallet desktop app or browser extension running.',
};

describe('English watch namespace', () => {
    it('resolves every phone-side watch string', () => {
        for (const [key, value] of Object.entries(expected)) {
            expect(t(key), key).toBe(value);
        }
    });
});
