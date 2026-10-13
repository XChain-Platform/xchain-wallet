// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The web shell and the desktop shell must route an `xchain:` link through
// the same mapping. Both are pinned here: the web source must call the shared
// function and carry no mapping of its own, and the shared function must keep
// producing the route each view expects.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import {
    deepLinkRoute,
    INVALID_DEEP_LINK_MESSAGE,
    useDeepLinks,
} from '../../packages/desktop/renderer/deepLinkRoute.js';

const webApp = readFileSync(resolve(process.cwd(), 'packages/web/src/App.jsx'), 'utf8');
const applyBody = webApp.slice(webApp.indexOf('const applyUriIntent'), webApp.indexOf('// §47 / Cluster L', webApp.indexOf('const applyUriIntent')));

const registry = registryLib.defaultRegistry();

afterEach(cleanup);

describe('shared URI to view mapping', () => {
    it('web applyUriIntent delegates to deepLinkRoute', () => {
        expect(webApp).toMatch(/import \{ deepLinkRoute \} from '\.\.\/\.\.\/desktop\/renderer\/deepLinkRoute\.js'/);
        expect(applyBody).toContain('deepLinkRoute(raw');
    });

    it('web applyUriIntent holds no second mapping of its own', () => {
        expect(applyBody).not.toMatch(/parseXchainUri|hardenUriIntentText|intent\.kind/);
    });

    it('routes a receive link to the receive view', () => {
        expect(deepLinkRoute('xchain:BTC/receive', registry)).toEqual({ view: 'receive' });
    });

    it.each([
        ['bitcoin', 'bitcoin-mainnet', 'BTC', 'bc1qrecipient'],
        ['litecoin', 'litecoin-mainnet', 'LTC', 'ltc1qrecipient'],
        ['dogecoin', 'dogecoin-mainnet', 'DOGE', 'DRecipient'],
    ])('routes %s payment links to Send with every supported field', (scheme, chainId, tick, address) => {
        expect(deepLinkRoute(
            `${scheme}:${address}?amount=1.25&message=Coffee%20%E2%80%AEshop`,
            registry,
        )).toEqual({
            view: 'send',
            sendPrefill: {
                address,
                amount: '1.25',
                tick,
                chainId,
                memo: 'Coffee ␦shop',
            },
        });
    });

    it('unwraps full and shorthand web+xchain protocol-handler links', () => {
        expect(deepLinkRoute('web+xchain:xchain:BTC/receive', registry)).toEqual({ view: 'receive' });
        expect(deepLinkRoute('web+xchain:BTC/send?to=bc1qrecipient&amount=2', registry)).toMatchObject({
            view: 'send',
            sendPrefill: { address: 'bc1qrecipient', amount: '2', chainId: 'bitcoin-mainnet' },
        });
    });

    it('routes an execute link with its prefill and drops one without a contract', () => {
        const route = deepLinkRoute('xchain:BTC/execute?contract=12&method=foo', registry);
        expect(route?.view).toBe('contract-execute');
        expect(route?.contractRef?.contractActionIndex).toBe('12');
        expect(route?.executePrefill?.method).toBe('foo');
        expect(deepLinkRoute('xchain:BTC/execute?method=foo', registry)).toEqual({
            view: 'deep-link-error',
            message: INVALID_DEEP_LINK_MESSAGE,
        });
    });

    it('routes nothing for non-strings and foreign schemes', () => {
        expect(deepLinkRoute(undefined, registry)).toBe(null);
        expect(deepLinkRoute('https://example.com', registry)).toBe(null);
    });

    it('returns a plain error message for malformed claimed links', () => {
        for (const raw of [
            'bitcoin:?amount=1',
            'litecoin:Labc?amount=not-a-number',
            'dogecoin:Dabc?req-unknown=1',
            'xchain:',
            'xchain:BTC/send?to=bc1qrecipient&amount=not-a-number',
            'xchain:BTC/send?to=bc1qrecipient&amount=0.000000001',
            'web+xchain:',
        ]) {
            expect(deepLinkRoute(raw, registry), raw).toEqual({
                view: 'deep-link-error',
                message: INVALID_DEEP_LINK_MESSAGE,
            });
        }
    });

    it('holds a payment link while locked and applies it after unlock', async () => {
        const bridge = {
            takePending: vi.fn(async () => ({ raw: 'dogecoin:DRecipient?amount=3' })),
            onUri: vi.fn(() => vi.fn()),
            sendMessage: vi.fn(),
        };
        const apply = vi.fn();
        const { rerender } = renderHook(
            ({ unlocked, walletId }) => useDeepLinks({
                bridge,
                detached: false,
                chainRegistry: registry,
                unlocked,
                walletId,
                apply,
            }),
            { initialProps: { unlocked: false, walletId: null } },
        );

        await waitFor(() => expect(bridge.takePending).toHaveBeenCalledOnce());
        expect(apply).not.toHaveBeenCalled();

        rerender({ unlocked: true, walletId: 'wallet-1' });
        await waitFor(() => expect(apply).toHaveBeenCalledWith(expect.objectContaining({
            view: 'send',
            sendPrefill: expect.objectContaining({ tick: 'DOGE', amount: '3' }),
        })));
        expect(apply).toHaveBeenCalledOnce();
        expect(apply.mock.calls[0][0]).toEqual({
            view: 'send',
            sendPrefill: {
                address: 'DRecipient',
                amount: '3',
                tick: 'DOGE',
                chainId: 'dogecoin-mainnet',
                memo: undefined,
            },
        });
        expect(bridge.sendMessage).not.toHaveBeenCalled();
    });
});
