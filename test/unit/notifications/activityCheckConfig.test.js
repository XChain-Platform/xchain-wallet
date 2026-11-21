// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    buildActivityCheckConfig,
    HOME_BALANCES_PUBLISHED_EVENT,
    startActivityCheckSync,
} from '../../../packages/core/src/notifications/activityCheckConfig.js';

const copy = {
    'watch.newActivity.title': 'New activity',
    'watch.newActivity.body': 'Open XChain Wallet to see what changed.',
    'watch.openOnPhone': 'Open on phone',
};

function state(overrides = {}) {
    return {
        walletId: 'wallet-1',
        settings: { watch: { backgroundActivityCheck: true } },
        entries: [{
            address: 'bc1q public',
            explorerBaseUrl: 'https://explorer.example/api/',
            balances: { confirmed: '1.25', pending: '-0.5' },
            privateKey: 'must-not-cross-the-bridge',
        }],
        translate: (key) => copy[key],
        demoWallet: () => false,
        ...overrides,
    };
}

describe('buildActivityCheckConfig', () => {
    it('builds a public-only config from already-published balances', () => {
        const read = vi.fn();
        const config = buildActivityCheckConfig(state({ read }));

        expect(read).not.toHaveBeenCalled();
        expect(config).toEqual({
            enabled: true,
            targets: [{
                address: 'bc1q public',
                url: 'https://explorer.example/api/address/bc1q%20public',
                confirmedPath: 'balances.confirmed',
                pendingPath: 'balances.pending',
                confirmed: '1.25',
                pending: '-0.5',
            }],
            notice: {
                title: 'New activity',
                body: 'Open XChain Wallet to see what changed.',
            },
            openOnPhoneTitle: 'Open on phone',
        });
        expect(JSON.stringify(config)).not.toContain('privateKey');
    });

    it.each([
        ['the setting is off', { watch: { backgroundActivityCheck: false } }, () => false],
        ['Tor routing is on', {
            privacy: { torRouting: true },
            watch: { backgroundActivityCheck: true },
        }, () => false],
        ['the wallet is a demo', { watch: { backgroundActivityCheck: true } }, () => true],
    ])('disables the check when %s', (_label, settings, demoWallet) => {
        expect(buildActivityCheckConfig(state({ settings, demoWallet })).enabled).toBe(false);
    });
});

describe('startActivityCheckSync', () => {
    it('hands startup and real lifecycle events to XChainActivity, then stops', () => {
        const target = new EventTarget();
        const setActivityCheck = vi.fn(async () => {});
        const getPlugin = vi.fn(() => ({ setActivityCheck }));
        let published = state();
        const readState = vi.fn(() => published);

        const stop = startActivityCheckSync({
            target,
            getNativePlugin: getPlugin,
            readState,
        });

        target.dispatchEvent(new Event('xc:session-changed'));
        published = state({ settings: { watch: { backgroundActivityCheck: false } } });
        target.dispatchEvent(new Event('xc:settings-changed'));
        published = state({
            walletId: 'wallet-2',
            entries: [{
                address: 'account-switch',
                explorerBaseUrl: 'https://second.example',
                confirmed: '2',
                pending: '0',
            }],
        });
        target.dispatchEvent(new Event(HOME_BALANCES_PUBLISHED_EVENT));
        published.entries.push({
            address: 'added-address',
            explorerBaseUrl: 'https://second.example',
            confirmed: '3',
            pending: '0.1',
        });
        target.dispatchEvent(new Event(HOME_BALANCES_PUBLISHED_EVENT));
        target.dispatchEvent(new Event('xc:session-changed'));

        expect(readState).toHaveBeenCalledTimes(6);
        expect(getPlugin).toHaveBeenCalledTimes(6);
        expect(setActivityCheck).toHaveBeenCalledTimes(6);
        expect(getPlugin).toHaveBeenNthCalledWith(
            1,
            'XChainActivity',
            { method: 'setActivityCheck' },
        );

        const configs = setActivityCheck.mock.calls.map(([{ json }]) => JSON.parse(json));
        expect(configs[0].targets[0]).toMatchObject({ confirmed: '1.25', pending: '-0.5' });
        expect(configs[2].enabled).toBe(false);
        expect(configs[3].targets.map(({ address }) => address)).toEqual(['account-switch']);
        expect(configs[4].targets.map(({ address }) => address)).toEqual([
            'account-switch',
            'added-address',
        ]);

        stop();
        target.dispatchEvent(new Event('xc:settings-changed'));
        target.dispatchEvent(new Event(HOME_BALANCES_PUBLISHED_EVENT));
        expect(setActivityCheck).toHaveBeenCalledTimes(6);
    });

    it('contains an unavailable plugin, state read failure, and native rejection', async () => {
        const targets = [
            new EventTarget(),
            new EventTarget(),
            new EventTarget(),
            new EventTarget(),
        ];
        expect(() => startActivityCheckSync({
            target: targets[0],
            getNativePlugin: () => null,
            readState: () => state(),
        })).not.toThrow();
        expect(() => startActivityCheckSync({
            target: targets[1],
            readState: () => { throw new Error('state unavailable'); },
        })).not.toThrow();
        expect(() => startActivityCheckSync({
            target: targets[2],
            getNativePlugin: () => { throw new Error('plugin unavailable'); },
            readState: () => state(),
        })).not.toThrow();
        expect(() => startActivityCheckSync({
            target: targets[3],
            getNativePlugin: () => ({
                setActivityCheck: vi.fn(async () => { throw new Error('store unavailable'); }),
            }),
            readState: () => state(),
        })).not.toThrow();
        await Promise.resolve();
    });
});
