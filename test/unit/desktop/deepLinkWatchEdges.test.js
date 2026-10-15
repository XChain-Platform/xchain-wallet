// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    deepLinkRoute,
    INVALID_DEEP_LINK_MESSAGE,
    watchDeepLinks,
} from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();

describe('desktop deep-link claim edges', () => {
    it('does not subscribe without a bridge or from a detached window', () => {
        const detachedBridge = { takePending: vi.fn(), onUri: vi.fn() };

        expect(() => watchDeepLinks({
            bridge: undefined,
            detached: false,
            chainRegistry: registry,
            onRoute: vi.fn(),
        })()).not.toThrow();
        expect(() => watchDeepLinks({
            bridge: detachedBridge,
            detached: true,
            chainRegistry: registry,
            onRoute: vi.fn(),
        })()).not.toThrow();
        expect(detachedBridge.takePending).not.toHaveBeenCalled();
        expect(detachedBridge.onUri).not.toHaveBeenCalled();
    });

    it('drops a failed claim and retries on the next URI nudge', async () => {
        let nudge;
        const off = vi.fn();
        const bridge = {
            takePending: vi.fn()
                .mockRejectedValueOnce(new Error('main unavailable'))
                .mockResolvedValueOnce({ raw: 'xchain:BTC/receive' }),
            onUri: vi.fn((listener) => { nudge = listener; return off; }),
        };
        const onRoute = vi.fn();

        const unsubscribe = watchDeepLinks({
            bridge,
            detached: false,
            chainRegistry: registry,
            onRoute,
        });
        await vi.waitFor(() => expect(bridge.takePending).toHaveBeenCalledOnce());
        expect(onRoute).not.toHaveBeenCalled();

        nudge();
        await vi.waitFor(() => expect(onRoute).toHaveBeenCalledWith({ view: 'receive' }));
        unsubscribe();
        expect(off).toHaveBeenCalledOnce();
    });

    it('suppresses a late claim after unsubscribe', async () => {
        let resolveClaim;
        const pending = new Promise((resolve) => { resolveClaim = resolve; });
        const off = vi.fn();
        const bridge = {
            takePending: vi.fn(() => pending),
            onUri: vi.fn(() => off),
        };
        const onRoute = vi.fn();

        const unsubscribe = watchDeepLinks({
            bridge,
            detached: false,
            chainRegistry: registry,
            onRoute,
        });
        await vi.waitFor(() => expect(bridge.takePending).toHaveBeenCalledOnce());
        unsubscribe();
        resolveClaim({ raw: 'xchain:BTC/receive' });
        await Promise.resolve();
        await Promise.resolve();

        expect(off).toHaveBeenCalledOnce();
        expect(onRoute).not.toHaveBeenCalled();
    });

    it('refuses a coin link when its chain cannot be resolved', () => {
        expect(deepLinkRoute('bitcoin:bc1qrecipient?amount=1', { chainIdFor: () => null })).toEqual({
            view: 'deep-link-error',
            message: INVALID_DEEP_LINK_MESSAGE,
        });
    });
});
