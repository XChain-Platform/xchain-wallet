// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    buildXchainUri,
    describeXchainIntent,
    parseXchainUri,
} from '../../../packages/core/src/uri/xchainUri.js';

const chainRegistry = {
    chainIdFor: (coin, networkKind) => `${coin}-${networkKind}`,
    descriptorFor: (chainId) => (chainId === 'bitcoin-mainnet'
        ? { coin: 'bitcoin', networkKind: 'mainnet' }
        : null),
};

describe('XChain URI low-coverage branches', () => {
    it('refuses a coin-code URI with an empty action', () => {
        expect(parseXchainUri('xchain:BTC/?label=Invoice&message=Thanks', { chainRegistry }))
            .toEqual({ kind: 'unknown' });
    });

    it('parses every optional legacy path-style field', () => {
        expect(parseXchainUri(
            'xchain://bitcoin-mainnet?amount=2&memo=hello&label=Invoice&message=Thanks'
            + '&to=bc1qexample&kind=receive&feePriority=FAST&&',
        )).toMatchObject({
            kind: 'receive',
            chainId: 'bitcoin-mainnet',
            tick: undefined,
            amount: '2',
            memo: 'hello',
            label: 'Invoice',
            message: 'Thanks',
            address: 'bc1qexample',
            feePriority: 'fast',
        });
    });

    it('rejects malformed legacy path-style query values', () => {
        expect(parseXchainUri('xchain://bitcoin-mainnet/BTC?memo=%ZZ'))
            .toEqual({ kind: 'unknown' });
    });

    it('parses every optional BIP21-style field', () => {
        expect(parseXchainUri(
            'xchain:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=3&label=Invoice&message=Thanks&memo=hello'
            + '&tick=BTC&chain=bitcoin-mainnet&feePriority=LOW',
        )).toMatchObject({
            kind: 'send',
            amount: '3',
            label: 'Invoice',
            message: 'Thanks',
            memo: 'hello',
            tick: 'BTC',
            chainId: 'bitcoin-mainnet',
            feePriority: 'low',
        });
    });

    it('describes a short address without abbreviation', () => {
        const t = vi.fn((key, vars) => `${key}:${vars.address}`);

        expect(describeXchainIntent(
            { kind: 'send', address: 'short-address' },
            { i18n: { t } },
        )).toBe('uri.intent.sendTo:short-address');
    });

    it('defaults a built send URI action when no action is supplied', () => {
        expect(buildXchainUri({
            kind: 'send',
            chainId: 'bitcoin-mainnet',
        }, { chainRegistry })).toBe('xchain:BTC/send');
    });
});
