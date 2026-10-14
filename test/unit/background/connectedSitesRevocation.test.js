// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const liveBrokers = [];

afterEach(async () => {
    await Promise.all(liveBrokers.splice(0).map((broker) => broker.cancelAll()));
});

function makeHarness(initialSites = []) {
    const records = initialSites.map((site) => structuredClone(site));
    let settings = { id: 'settings', blockedOrigins: [] };
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
    const connectedSites = {
        get: vi.fn(async (id) => records.find((site) => site.id === id) ?? null),
        list: vi.fn(async () => records.map((site) => structuredClone(site))),
        findBy: vi.fn(async (field, value) => (
            records.filter((site) => site[field] === value).map((site) => structuredClone(site))
        )),
        delete: vi.fn(async (id) => {
            const index = records.findIndex((site) => site.id === id);
            if (index >= 0) records.splice(index, 1);
        }),
        put: vi.fn(async (site) => records.push(structuredClone(site))),
    };
    const bridgeEvents = { disconnect: vi.fn(async () => {}) };
    const host = createBackgroundHost({
        approvals,
        bridgeEvents,
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        getDiagnosticContext: () => ({}),
        vault: {
            connectedSites,
            settings: {
                get: vi.fn(async () => structuredClone(settings)),
                put: vi.fn(async (next) => { settings = structuredClone(next); }),
            },
            accounts: { list: vi.fn(async () => []) },
            wallets: { list: vi.fn(async () => []) },
        },
        chainRegistry: { get: () => null, list: () => [], supportedChains: () => [] },
        sdkRegistry: { for: () => ({}) },
    });
    return {
        approvals,
        bridgeEvents,
        connectedSites,
        host,
        records,
        settings: () => settings,
        windows,
    };
}

async function settleWindowCreation() {
    await Promise.resolve();
    await Promise.resolve();
}

describe('connected-site revocation', () => {
    it('deletes permissions, rejects matching approvals, closes their windows, and disconnects tabs', async () => {
        const site = { id: 'site-one', origin: 'https://one.test', permissions: {} };
        const harness = makeHarness([site, {
            id: 'site-two', origin: 'https://two.test', permissions: {},
        }]);
        const revokedApproval = harness.approvals.signAction({ origin: site.origin });
        const retainedApproval = harness.approvals.signAction({ origin: 'https://two.test' });
        await settleWindowCreation();

        const response = await harness.host.handle({
            type: 'sites.delete',
            request: { id: site.id },
        });

        expect(response).toEqual({ ok: true, result: { ok: true } });
        expect(harness.records.map(({ id }) => id)).toEqual(['site-two']);
        await expect(revokedApproval).resolves.toEqual({ approved: false });
        expect(harness.approvals.fetch('request-1')).toBeNull();
        expect(harness.approvals.fetch('request-2')).not.toBeNull();
        expect(harness.windows.remove).toHaveBeenCalledWith(1);
        expect(harness.bridgeEvents.disconnect).toHaveBeenCalledWith(
            site.origin,
            'user-revoked',
        );

        await harness.approvals.cancelAll();
        await expect(retainedApproval).resolves.toEqual({ approved: false });
    });

    it('blocks before rejecting a later connect without opening another prompt', async () => {
        const site = { id: 'site-one', origin: 'https://one.test', permissions: {} };
        const harness = makeHarness([site]);
        const pendingConnect = harness.approvals.connect({ origin: site.origin });
        await settleWindowCreation();

        const blocked = await harness.host.handle({
            type: 'sites.block',
            request: { origin: site.origin },
        });
        const reconnect = await harness.host.handle({
            type: 'bridge.connect',
            request: { origin: site.origin, appName: 'Blocked app' },
        });
        const undo = await harness.host.handle({
            type: 'sites.restore',
            request: { site },
        });

        expect(blocked.ok).toBe(true);
        expect(blocked.result.evictedSiteIds).toEqual([site.id]);
        expect(harness.settings().blockedOrigins).toEqual([site.origin]);
        await expect(pendingConnect).resolves.toEqual({ approved: false });
        expect(harness.windows.create).toHaveBeenCalledTimes(1);
        expect(reconnect).toEqual(expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ code: 'BLOCKED_BY_USER' }),
        }));
        expect(undo).toEqual(expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ message: 'sites.restore: origin is blocked' }),
        }));
        expect(harness.records).toEqual([]);
        expect(harness.bridgeEvents.disconnect).toHaveBeenCalledWith(
            site.origin,
            'blocked-by-user',
        );
    });

    it('invalidates every matching pending approval when a wildcard is blocked', async () => {
        const site = { id: 'site-app', origin: 'https://app.example.com', permissions: {} };
        const harness = makeHarness([site]);
        const connectedApproval = harness.approvals.signMessage({ origin: site.origin });
        const connectApproval = harness.approvals.connect({ origin: 'https://new.example.com' });
        const unrelatedApproval = harness.approvals.connect({ origin: 'https://example.net' });
        await settleWindowCreation();

        const response = await harness.host.handle({
            type: 'sites.block',
            request: { origin: '*.example.com' },
        });

        expect(response.ok).toBe(true);
        await expect(connectedApproval).resolves.toEqual({ approved: false });
        await expect(connectApproval).resolves.toEqual({ approved: false });
        expect(harness.approvals.fetch('request-3')).not.toBeNull();
        expect(harness.windows.remove).toHaveBeenCalledWith(1);
        expect(harness.windows.remove).toHaveBeenCalledWith(2);
        expect(harness.bridgeEvents.disconnect).toHaveBeenCalledWith(
            site.origin,
            'blocked-by-user',
        );

        await harness.approvals.cancelAll();
        await expect(unrelatedApproval).resolves.toEqual({ approved: false });
    });
});
