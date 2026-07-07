// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the §46 GovernancePollWatcher. The SDK is a stub whose
// getPolls/getBalances return mutable fixtures; notify is a spy. pollOnce()
// is driven directly so no real timers.

import { describe, it, expect, vi } from 'vitest';
import { GovernancePollWatcher } from '../../../packages/core/src/notifications/GovernancePollWatcher.js';

function openPoll(over = {}) {
    return {
        action_index: over.action_index ?? 501,
        tick: over.tick ?? 'GOVTOKEN',
        question: 'Fund the grants round?',
        poll_status: 'open',
        end_block: over.end_block ?? 900,
        callback_contract_index: over.callback_contract_index ?? null,
        ...over,
    };
}

function makeWatcher(over = {}) {
    // Mutable fixtures the tests reshape between ticks.
    const state = {
        polls: over.polls || [],
        balances: over.balances || [{ tick: 'GOVTOKEN', quantity: '250' }],
    };
    const sdk = {
        getPolls: vi.fn(async (query, type) => {
            expect(query).toBe('open');
            expect(type).toBe('status');
            return state.polls.map((p) => ({ ...p }));
        }),
        getBalances: vi.fn(async () => state.balances.map((b) => ({ ...b }))),
    };
    const notify = vi.fn(async () => {});
    const settings = over.settings === undefined
        ? { notifications: { governancePolls: true } }
        : over.settings;
    const watcher = new GovernancePollWatcher({
        getActiveAddresses: over.getActiveAddresses
            || vi.fn(async () => [{ address: 'addr1', chainId: 'bitcoin-mainnet', label: 'Bitcoin', network: 'mainnet' }]),
        getSdkForChain: vi.fn(() => sdk),
        getSettings: vi.fn(async () => settings),
        notify,
        loadSeen: over.loadSeen,
        saveSeen: over.saveSeen,
    });
    return { watcher, sdk, notify, state };
}

describe('GovernancePollWatcher', () => {
    it('baselines silently on the first tick, then announces a new poll for a held token', async () => {
        const { watcher, notify, state } = makeWatcher({ polls: [openPoll({ action_index: 400 })] });

        await watcher.pollOnce();          // baseline: existing poll never announces
        expect(notify).not.toHaveBeenCalled();

        state.polls.push(openPoll({ action_index: 501 }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        const n = notify.mock.calls[0][0];
        expect(n.kind).toBe('governance-poll');
        expect(n.title).toBe('Governance poll');
        expect(n.body).toContain('GOVTOKEN');
        expect(n.body).toContain('Bitcoin');
        expect(n.data).toMatchObject({ tick: 'GOVTOKEN', pollIndex: 501, binding: false });
    });

    it('flags a binding poll (callback contract set) in title, body, and data', async () => {
        const { watcher, notify, state } = makeWatcher();
        await watcher.pollOnce();          // baseline (no polls)
        state.polls.push(openPoll({ action_index: 502, callback_contract_index: 42 }));
        await watcher.pollOnce();
        const n = notify.mock.calls[0][0];
        expect(n.title).toBe('Binding governance poll');
        expect(n.body).toContain('binding');
        expect(n.data.binding).toBe(true);
    });

    it('never announces the same poll twice', async () => {
        const { watcher, notify, state } = makeWatcher();
        await watcher.pollOnce();
        state.polls.push(openPoll({ action_index: 501 }));
        await watcher.pollOnce();
        await watcher.pollOnce();
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('stays silent for polls over tokens the wallet does not hold', async () => {
        const { watcher, notify, state } = makeWatcher({ balances: [{ tick: 'OTHER', quantity: '5' }] });
        await watcher.pollOnce();
        state.polls.push(openPoll({ action_index: 501 }));   // GOVTOKEN, not held
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('a zero balance does not count as holding', async () => {
        const { watcher, notify, state } = makeWatcher({ balances: [{ tick: 'GOVTOKEN', quantity: '0' }] });
        await watcher.pollOnce();
        state.polls.push(openPoll({ action_index: 501 }));
        await watcher.pollOnce();
        expect(notify).not.toHaveBeenCalled();
    });

    it('makes no network calls while the feature toggle is off, and defaults ON when absent', async () => {
        const off = makeWatcher({ settings: { notifications: { governancePolls: false } } });
        await off.watcher.pollOnce();
        expect(off.sdk.getPolls).not.toHaveBeenCalled();

        const absent = makeWatcher({ settings: { notifications: {} } });
        await absent.watcher.pollOnce();
        expect(absent.sdk.getPolls).toHaveBeenCalledTimes(1); // v2-tolerant default ON
    });

    it('does not query balances on an idle tick (no fresh polls)', async () => {
        const { watcher, sdk, state } = makeWatcher({ polls: [openPoll({ action_index: 400 })] });
        await watcher.pollOnce();          // baseline
        await watcher.pollOnce();          // idle
        expect(sdk.getBalances).not.toHaveBeenCalled();
        state.polls.push(openPoll({ action_index: 501 }));
        await watcher.pollOnce();          // fresh poll → now balances are needed
        expect(sdk.getBalances).toHaveBeenCalled();
    });

    it('restores persisted seen-state so a restart does not re-baseline', async () => {
        const notifyLog = [];
        const seenStore = { 'bitcoin-mainnet': ['400'] };
        const { watcher, notify, state } = makeWatcher({
            polls: [openPoll({ action_index: 400 }), openPoll({ action_index: 501 })],
            loadSeen: vi.fn(async () => seenStore),
            saveSeen: vi.fn(async (s) => { notifyLog.push(s); }),
        });
        await watcher.pollOnce();
        // 400 was seen before the "restart"; 501 appeared while offline → announce it.
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.pollIndex).toBe(501);
        // The updated seen-set was persisted.
        expect(notifyLog.length).toBeGreaterThan(0);
        expect(notifyLog[notifyLog.length - 1]['bitcoin-mainnet']).toContain('501');
    });

    it('prunes closed polls from the seen-set', async () => {
        const saved = [];
        const { watcher, state } = makeWatcher({
            polls: [openPoll({ action_index: 400 })],
            saveSeen: vi.fn(async (s) => { saved.push(s); }),
        });
        await watcher.pollOnce();          // baseline: 400 seen
        state.polls.length = 0;            // 400 finalized (left the open list)
        state.polls.push(openPoll({ action_index: 501 }));
        await watcher.pollOnce();
        const last = saved[saved.length - 1]['bitcoin-mainnet'];
        expect(last).toContain('501');
        expect(last).not.toContain('400');
    });

    it('accepts a { data: [...] } payload shape from the explorer', async () => {
        const rows = [];
        const sdkOverride = {
            getPolls: vi.fn(async () => ({ data: rows.map((p) => ({ ...p })) })),
            getBalances: vi.fn(async () => ({ data: [{ tick: 'GOVTOKEN', quantity: '9' }] })),
        };
        const notify = vi.fn(async () => {});
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(async () => [{ address: 'a', chainId: 'c', label: 'Chain', network: 'mainnet' }]),
            getSdkForChain: () => sdkOverride,
            getSettings: vi.fn(async () => ({})),
            notify,
        });
        await watcher.pollOnce();
        rows.push(openPoll({ action_index: 7 }));
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('one failing chain does not block the others', async () => {
        const goodSdk = {
            getPolls: vi.fn(async () => [openPoll({ action_index: 9 })]),
            getBalances: vi.fn(async () => [{ tick: 'GOVTOKEN', quantity: '1' }]),
        };
        const badSdk = { getPolls: vi.fn(async () => { throw new Error('explorer down'); }) };
        const notify = vi.fn(async () => {});
        const watcher = new GovernancePollWatcher({
            getActiveAddresses: vi.fn(async () => [
                { address: 'a1', chainId: 'bad-chain', label: 'Bad', network: 'mainnet' },
                { address: 'a2', chainId: 'good-chain', label: 'Good', network: 'mainnet' },
            ]),
            getSdkForChain: (chainId) => (chainId === 'bad-chain' ? badSdk : goodSdk),
            getSettings: vi.fn(async () => ({})),
            notify,
        });
        await watcher.pollOnce();          // baseline for good-chain; bad-chain throws
        goodSdk.getPolls = vi.fn(async () => [openPoll({ action_index: 9 }), openPoll({ action_index: 10 })]);
        await watcher.pollOnce();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify.mock.calls[0][0].data.pollIndex).toBe(10);
    });

    it('start() is idempotent and stop() clears session state', () => {
        const { watcher } = makeWatcher();
        watcher.start();
        const timer = watcher._timer;
        watcher.start();
        expect(watcher._timer).toBe(timer);
        watcher.stop();
        expect(watcher._timer).toBe(null);
    });
});
