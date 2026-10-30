// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The SDK facade's getStatus() and getAction(index) take no options, so a
// noRetry passed to them is dropped before it reaches the explorer client. The
// wallet's best-effort status and action reads go through explorerReadOnce,
// which reads the explorer directly with noRetry, so each makes one attempt.

import { describe, it, expect, vi } from 'vitest';
import {
    HostRateLimiter,
    explorerReadOnce,
    installSdkNetworkPolicy,
} from '../../../packages/core/src/sdk/explorerRateLimit.js';
import { DEFAULT_SDK_NETWORK_OPTIONS } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { readMarketExpiryClock } from '../../../packages/core/src/flows/marketExpiry.js';
import { DeadlineWatcher } from '../../../packages/core/src/notifications/DeadlineWatcher.js';
import { DispenserEscrowWatcher } from '../../../packages/core/src/notifications/DispenserEscrowWatcher.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const T0 = 1_760_000_000_000;
const ADDRESS = 'bc1qmine';

function fakeLimiter() {
    let t = T0;
    return new HostRateLimiter({
        now: () => t,
        sleep: async (ms) => { t += ms; },
        random: () => 0.5,
    });
}

const quietLog = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

/**
 * An SDK whose explorer is the real ExplorerClient behind the shared gate, and
 * whose getStatus/getAction drop their options exactly as the SDK facade does.
 * Every send is recorded; `refuse` names the paths that fail.
 */
function walletSdk({ refuse, answer = () => ({ data: [] }) }) {
    const ExplorerClient = requireSdkDeep('explorerClient');
    const explorer = new ExplorerClient({
        network: 'bitcoin-mainnet',
        explorerUrl: 'https://explorer.example',
        retry: DEFAULT_SDK_NETWORK_OPTIONS.retry,
    });
    const sent = [];
    explorer.client.get = async (url) => {
        sent.push(url);
        if (refuse.test(url)) {
            throw Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
        }
        return { status: 200, data: answer(url), headers: {} };
    };
    const sdk = {
        explorer,
        getStatus() { return this.explorer.getStatus(); },
        getAction(actionIndex) { return this.explorer.getAction(actionIndex); },
        getOrders: (q, t, o) => explorer.getOrders(q, t, o),
        getSwaps: (q, t, o) => explorer.getSwaps(q, t, o),
        getDispensers: (q, t, o) => explorer.getDispensers(q, t, o),
        getPolls: (q, t, o) => explorer.getPolls(q, t, o),
        getVotes: (q, t, o) => explorer.getVotes(q, t, o),
    };
    installSdkNetworkPolicy(sdk, fakeLimiter());
    return { sdk, sent };
}

describe('explorerReadOnce', () => {
    it('reads the explorer once with noRetry, and falls back for a stand-in SDK', async () => {
        const get = vi.fn(async () => 'status');
        await expect(explorerReadOnce({ explorer: { get } }, '/status', () => 'fallback'))
            .resolves.toBe('status');
        expect(get).toHaveBeenCalledWith('/status', { noRetry: true });
        await expect(explorerReadOnce({ getStatus: () => 'facade' }, '/status', () => 'fallback'))
            .resolves.toBe('fallback');
    });
});

describe.skipIf(!sdkInstalled())('status and action reads that ask for noRetry', () => {
    it('readMarketExpiryClock sends /status once when the explorer is unreachable', async () => {
        const { sdk, sent } = walletSdk({ refuse: /\/status$/ });
        await expect(readMarketExpiryClock(sdk)).resolves.toMatchObject({ blockTime: null });
        expect(sent).toEqual(['/BTC/api/status']);
    });

    it('DeadlineWatcher sends /status once when the explorer is unreachable', async () => {
        const { sdk, sent } = walletSdk({ refuse: /\/status$/ });
        const watcher = new DeadlineWatcher({
            getActiveAddresses: async () => [{ chainId: 'bitcoin-mainnet', address: ADDRESS, label: 'BTC' }],
            getSdkForChain: () => sdk,
            getSettings: async () => ({ notifications: {} }),
            coinForChain: () => 'bitcoin',
            notify: vi.fn(),
            log: quietLog,
        });
        await watcher.pollOnce();
        expect(sent.filter((url) => url.endsWith('/status'))).toEqual(['/BTC/api/status']);
    });

    it('DispenserEscrowWatcher sends an action detail read once when it fails', async () => {
        const { sdk, sent } = walletSdk({
            refuse: /\/action\//,
            answer: () => ({
                data: [{ action_index: '2592', status: 'valid', give_amount: '10', give_tick: 'FOO' }],
            }),
        });
        const watcher = new DispenserEscrowWatcher({
            getActiveAddresses: async () => [{ chainId: 'bitcoin-mainnet', address: ADDRESS, label: 'BTC' }],
            getSdkForChain: () => sdk,
            getSettings: async () => ({ notifications: {} }),
            notify: vi.fn(),
            log: quietLog,
        });
        await watcher.pollOnce();
        expect(sent.filter((url) => url.includes('/action/'))).toEqual(['/BTC/api/action/2592']);
    });
});
