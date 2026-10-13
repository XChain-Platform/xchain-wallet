// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    ApprovalBroker,
    approvalBadgeText,
} from '../../../packages/extension/src/background/approvalBroker.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function harness() {
    let nextWindowId = 1;
    const removed = [];
    const action = { setBadgeText: vi.fn(async () => {}) };
    const windows = {
        create: vi.fn(async () => ({ id: nextWindowId++ })),
        remove: vi.fn(async () => {}),
        onRemoved: { addListener: (fn) => removed.push(fn) },
    };
    let nextRequestId = 1;
    const broker = new ApprovalBroker({
        action,
        windows,
        newId: () => `request-${nextRequestId++}`,
        getUrl: (path) => path,
    });
    const flushBadge = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };
    return { action, broker, flushBadge, removed, windows };
}

function failureHarness({ timeoutMs = 60_000 } = {}) {
    const tabRemoved = [];
    const suspended = [];
    const remove = vi.fn(async () => {});
    vi.stubGlobal('chrome', {
        action: { setBadgeText: vi.fn(async () => {}) },
        runtime: {
            getURL: (path) => `chrome-extension://wallet/${path}`,
            onSuspend: { addListener: (fn) => suspended.push(fn) },
        },
        tabs: { onRemoved: { addListener: (fn) => tabRemoved.push(fn) } },
        windows: {
            create: vi.fn(async () => ({ id: 41 })),
            remove,
            onRemoved: { addListener: vi.fn() },
        },
    });
    const broker = new ApprovalBroker({
        newId: () => 'failure-request',
        timeoutMs,
    });
    return { broker, remove, suspended, tabRemoved };
}

describe('ApprovalBroker action badge', () => {
    it('shows the pending count and clears it after decisions and closes', async () => {
        const { action, broker, flushBadge, removed } = harness();
        const first = broker.connect({ origin: 'https://one.test' });
        const second = broker.signMessage({ origin: 'https://two.test' });
        await flushBadge();

        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });

        await broker.resolve('request-1', { approved: false });
        await flushBadge();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });

        removed[0](2);
        await flushBadge();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
        await expect(first).resolves.toEqual({ approved: false });
        await expect(second).resolves.toEqual({ approved: false });
    });

    it('clears the badge if creating the approval window fails', async () => {
        const action = { setBadgeText: vi.fn(async () => {}) };
        const broker = new ApprovalBroker({
            action,
            windows: { create: vi.fn(async () => { throw new Error('blocked'); }) },
            newId: () => 'failed-request',
        });

        await expect(broker.connect({ origin: 'https://one.test' })).rejects.toThrow('blocked');
        await Promise.resolve();
        await Promise.resolve();
        expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    });

    it('keeps badge text within the browser action limit', () => {
        expect(approvalBadgeText(0)).toBe('');
        expect(approvalBadgeText(12)).toBe('12');
        expect(approvalBadgeText(100)).toBe('99+');
    });

    it('cancels pending Chrome approvals and clears the badge on lock', async () => {
        let resolveWindow;
        const createWindow = new Promise((resolve) => { resolveWindow = resolve; });
        const setBadgeText = vi.fn(async () => {});
        const remove = vi.fn(async () => {});
        vi.stubGlobal('chrome', {
            action: { setBadgeText },
            runtime: { getURL: (path) => `chrome-extension://wallet/${path}` },
            windows: {
                create: vi.fn(() => createWindow),
                remove,
                onRemoved: { addListener: vi.fn() },
            },
        });

        const broker = new ApprovalBroker({ newId: () => 'locked-request' });
        const pending = broker.signAction({ origin: 'https://one.test' });
        await broker.cancelAll();

        await expect(pending).resolves.toEqual({ approved: false });
        await vi.waitFor(() => {
            expect(setBadgeText).toHaveBeenLastCalledWith({ text: '' });
        });
        expect(broker._pendingSize()).toBe(0);

        resolveWindow({ id: 9 });
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(9));
    });

    it('routes lock teardown through broker cancellation', () => {
        const backgroundPath = resolve('packages/extension/src/background.js');
        const background = readFileSync(backgroundPath, 'utf8');
        const teardown = background.slice(
            background.indexOf('function tearDownHost()'),
            background.indexOf('async function sealBroadcastQueues()'),
        );

        expect(teardown).toContain('approvalBroker.cancelAll()');
    });

});

describe('ApprovalBroker failure paths', () => {
    it('binds web approval requests to the browser-derived tab id', async () => {
        let listener;
        const runtime = {
            id: 'wallet',
            onMessage: {
                addListener: vi.fn((fn) => { listener = fn; }),
                removeListener: vi.fn(),
            },
        };
        const host = { handle: vi.fn(async () => ({ ok: true, result: {} })) };
        attachChromeRuntime(host, runtime);

        listener(
            {
                type: 'bridge.connect',
                request: {
                    origin: 'https://dapp.test',
                    requesterTabId: 999,
                },
            },
            { url: 'https://dapp.test/page', tab: { id: 17 } },
            vi.fn(),
        );

        await vi.waitFor(() => expect(host.handle).toHaveBeenCalledWith({
            type: 'bridge.connect',
            request: {
                origin: 'https://dapp.test',
                requesterTabId: 17,
            },
        }));
    });

    it('rejects and drains an approval when its requesting tab closes', async () => {
        const { broker, remove, tabRemoved } = failureHarness();
        const pending = broker.signMessage({
            origin: 'https://dapp.test',
            requesterTabId: 17,
        });
        await Promise.resolve();

        expect(broker.fetch('failure-request')?.payload).toEqual({
            origin: 'https://dapp.test',
        });
        tabRemoved[0](17);

        await expect(pending).resolves.toEqual({ approved: false });
        expect(broker._pendingSize()).toBe(0);
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(41));
    });

    it('rejects and drains an approval when its deadline expires', async () => {
        vi.useFakeTimers();
        const { broker, remove } = failureHarness({ timeoutMs: 1_000 });
        const pending = broker.connect({ origin: 'https://dapp.test' });
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(1_000);

        await expect(pending).resolves.toEqual({ approved: false });
        expect(broker._pendingSize()).toBe(0);
        expect(remove).toHaveBeenCalledWith(41);
    });

    it('rejects and drains an open approval when the wallet locks', async () => {
        const { broker, remove } = failureHarness();
        const pending = broker.signAction({ origin: 'https://dapp.test' });
        await Promise.resolve();

        await broker.cancelAll();

        await expect(pending).resolves.toEqual({ approved: false });
        expect(broker._pendingSize()).toBe(0);
        expect(remove).toHaveBeenCalledWith(41);
    });

    it('rejects and drains an open approval before the background suspends', async () => {
        const { broker, remove, suspended } = failureHarness();
        const pending = broker.signPsbt({ origin: 'https://dapp.test' });
        await Promise.resolve();

        suspended[0]();

        await expect(pending).resolves.toEqual({ approved: false });
        expect(broker._pendingSize()).toBe(0);
        await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(41));
    });
});
