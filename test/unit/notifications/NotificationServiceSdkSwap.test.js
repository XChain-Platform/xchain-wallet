// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An endpoint override drops the chain's cached SDK instance from the
// registry. The notification service holds its own connected socket and
// subscriptions on the old instance, so the next sync has to notice the swap
// and move them. The SDK double has the real client's shape: connectWs and
// disconnectWs, and no close().

import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from '../../../packages/core/src/notifications/NotificationService.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';

const CHAIN = 'bitcoin-mainnet';
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeHarness() {
    const made = [];
    const chainRegistry = new ChainRegistry();
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        rateLimiter: null,
        sdkFactory: (opts) => {
            const sdk = {
                explorerUrl: opts.explorerUrl,
                connectWs: vi.fn(async () => {}),
                disconnectWs: vi.fn(() => {}),
                unsubs: [],
                onAddress: vi.fn(() => {
                    const unsub = vi.fn();
                    sdk.unsubs.push(unsub);
                    return unsub;
                }),
            };
            made.push(sdk);
            return sdk;
        },
    });
    const service = new NotificationService({
        getActiveAddresses: async () => [{ address: 'addrBTC', chainId: CHAIN, label: 'Bitcoin', network: 'mainnet' }],
        getSdkForChain: (id) => sdkRegistry.get(id),
        getSettings: async () => ({ activeNetwork: 'mainnet', notifications: {} }),
        notify: vi.fn(async () => {}),
    });
    return { made, sdkRegistry, service };
}

const override = (url) => ({ sdkEndpoints: { [CHAIN]: { custom: true, explorerUrl: url } } });

describe('NotificationService follows a replaced SDK instance', () => {
    it('moves the socket and subscriptions to the new explorer on the next refresh', async () => {
        const { made, sdkRegistry, service } = makeHarness();
        await service.start();
        expect(made).toHaveLength(1);
        const [old] = made;
        expect(old.onAddress).toHaveBeenCalledTimes(1);

        const { changed } = sdkRegistry.applyEndpointOverridesFromSettings(override('https://own-explorer.example'));
        expect(changed).toEqual([CHAIN]);
        await service.refresh();
        await flush();

        expect(made).toHaveLength(2);
        const [, next] = made;
        expect(next.explorerUrl).toBe('https://own-explorer.example');
        expect(old.unsubs[0]).toHaveBeenCalledTimes(1);
        expect(old.disconnectWs).toHaveBeenCalledTimes(1);
        expect(next.connectWs).toHaveBeenCalledTimes(1);
        expect(next.onAddress).toHaveBeenCalledTimes(1);
        service.stop();
    });

    // Negative control: with the swap check disabled the same sequence stays
    // on the old instance, so the first case above can fail.
    it('stays on the old explorer when the swap check is disabled', async () => {
        const { made, sdkRegistry, service } = makeHarness();
        service._dropSwappedConnections = () => {};
        await service.start();
        sdkRegistry.applyEndpointOverridesFromSettings(override('https://own-explorer.example'));
        await service.refresh();

        expect(made).toHaveLength(1);
        expect(made[0].disconnectWs).not.toHaveBeenCalled();
        service.stop();
    });

    it('leaves a socket alone while the registry still hands back the same instance', async () => {
        const { made, service } = makeHarness();
        await service.start();
        await service.refresh();
        await service.refresh();

        expect(made).toHaveLength(1);
        expect(made[0].connectWs).toHaveBeenCalledTimes(1);
        expect(made[0].disconnectWs).not.toHaveBeenCalled();
        expect(made[0].onAddress).toHaveBeenCalledTimes(1);
        service.stop();
    });

    it('gives a chain whose old endpoint never connected a fresh attempt on the new instance', async () => {
        const made = [];
        const chainRegistry = new ChainRegistry();
        const sdkRegistry = new SDKRegistry({
            chainRegistry,
            rateLimiter: null,
            sdkFactory: () => {
                const first = made.length === 0;
                const sdk = {
                    connectWs: vi.fn(async () => { if (first) throw new Error('explorer down'); }),
                    disconnectWs: vi.fn(),
                    onAddress: vi.fn(() => vi.fn()),
                };
                made.push(sdk);
                return sdk;
            },
        });
        const service = new NotificationService({
            getActiveAddresses: async () => [{ address: 'addrBTC', chainId: CHAIN, label: 'Bitcoin', network: 'mainnet' }],
            getSdkForChain: (id) => sdkRegistry.get(id),
            getSettings: async () => ({ activeNetwork: 'mainnet', notifications: {} }),
            notify: vi.fn(async () => {}),
            logger: { warn() {}, error() {}, info() {}, debug() {} },
        });
        await service.start();
        expect(made[0].connectWs).toHaveBeenCalledTimes(1);
        expect(made[0].onAddress).not.toHaveBeenCalled();

        sdkRegistry.applyEndpointOverridesFromSettings(override('https://own-explorer.example'));
        await service.refresh();

        expect(made).toHaveLength(2);
        expect(made[1].connectWs).toHaveBeenCalledTimes(1);
        expect(made[1].onAddress).toHaveBeenCalledTimes(1);
        service.stop();
    });

    it('keeps the current socket when resolving the registry instance throws', async () => {
        const sdk = {
            connectWs: vi.fn(async () => {}),
            disconnectWs: vi.fn(),
            onAddress: vi.fn(() => vi.fn()),
        };
        let fail = false;
        const service = new NotificationService({
            getActiveAddresses: async () => [{ address: 'a', chainId: CHAIN, label: 'B', network: 'mainnet' }],
            getSdkForChain: () => { if (fail) throw new Error('unknown chain'); return sdk; },
            getSettings: async () => ({ activeNetwork: 'mainnet', notifications: {} }),
            notify: vi.fn(async () => {}),
        });
        await service.start();
        fail = true;
        await service.refresh();

        expect(sdk.disconnectWs).not.toHaveBeenCalled();
        expect(sdk.onAddress).toHaveBeenCalledTimes(1);
        service.stop();
    });
});
