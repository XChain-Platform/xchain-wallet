// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: an extension approval is composed for the network it was
// requested on, so switching the active network rejects every open approval,
// closes its window and leaves nothing to approve afterwards.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../packages/core/src/schemas/settings.js';
import { ApprovalBroker } from '../../packages/extension/src/background/approvalBroker.js';
import { createBackgroundHost } from '../../packages/extension/src/background/createBackgroundHost.js';

const liveBrokers = [];

afterEach(async () => {
    await Promise.all(liveBrokers.splice(0).map((broker) => broker.cancelAll()));
});

function makeHarness() {
    let settings = { ...createDefaultSettings(), activeNetwork: 'mainnet' };
    let nextRequestId = 1;
    let nextWindowId = 1;
    const windows = {
        create: vi.fn(async () => ({ id: nextWindowId++ })),
        remove: vi.fn(async () => {}),
        onRemoved: { addListener: vi.fn() },
    };
    const approvals = new ApprovalBroker({
        action: { setBadgeText: vi.fn(async () => {}) },
        windows,
        newId: () => `request-${nextRequestId++}`,
        getUrl: (path) => path,
    });
    liveBrokers.push(approvals);
    const host = createBackgroundHost({
        approvals,
        bridgeEvents: {},
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        getDiagnosticContext: () => ({}),
        vault: {
            connectedSites: { list: vi.fn(async () => []) },
            settings: {
                get: vi.fn(async () => structuredClone(settings)),
                put: vi.fn(async (next) => { settings = structuredClone(next); }),
            },
            accounts: { list: vi.fn(async () => []) },
            wallets: { list: vi.fn(async () => []) },
        },
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [], byNetworkKind: () => [] },
        sdkRegistry: { for: () => ({}) },
    });
    return { approvals, host, windows };
}

async function settleWindowCreation() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('approvals across a network switch', () => {
    it('rejects and closes every open approval when the network changes', async () => {
        const harness = makeHarness();
        const first = harness.approvals.signAction({ origin: 'https://one.test', chainId: 'bitcoin-mainnet' });
        const second = harness.approvals.signMessage({ origin: 'https://two.test', chainId: 'bitcoin-mainnet' });
        await settleWindowCreation();

        const response = await harness.host.handle({
            type: 'settings.update',
            request: { patch: { activeNetwork: 'testnet' } },
        });

        expect(response).toMatchObject({ ok: true });
        await expect(first).resolves.toMatchObject({ approved: false });
        await expect(second).resolves.toMatchObject({ approved: false });
        expect(harness.approvals.fetch('request-1')).toBeNull();
        expect(harness.approvals.fetch('request-2')).toBeNull();
        expect(harness.windows.remove).toHaveBeenCalledWith(1);
        expect(harness.windows.remove).toHaveBeenCalledWith(2);
        expect((await first).reason).toMatch(/network/i);
    });

    it('keeps open approvals when the update leaves the network unchanged', async () => {
        const harness = makeHarness();
        const pending = harness.approvals.signAction({ origin: 'https://one.test' });
        await settleWindowCreation();

        await harness.host.handle({
            type: 'settings.update',
            request: { patch: { activeNetwork: 'mainnet' } },
        });

        expect(harness.approvals.fetch('request-1')).not.toBeNull();
        await harness.approvals.cancelAll();
        await expect(pending).resolves.toEqual({ approved: false });
    });
});
