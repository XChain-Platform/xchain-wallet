// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// What an xchain: link may name as its target: a documented action verb
// (send, receive, execute) with valid parameters, or a real address. Anything
// else is refused by the parser and by the external-link router.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';
import { deepLinkRoute, INVALID_DEEP_LINK_MESSAGE } from '../../../packages/desktop/renderer/deepLinkRoute.js';

const registry = registryLib.defaultRegistry();
const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LTC_ADDR = 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';
const INVALID = { view: 'deep-link-error', message: INVALID_DEEP_LINK_MESSAGE };
const parse = (uri) => parseXchainUri(uri, { chainRegistry: registry });

describe('documented xchain: forms', () => {
    it('reads a coin-code send', () => {
        const intent = parse(`xchain:BTC/send?to=${ADDR}&amount=0.001`);
        expect(intent).toMatchObject({ kind: 'send', action: 'send', chainId: 'bitcoin-mainnet', address: ADDR, amount: '0.001' });
    });

    it('reads a coin-code send without a destination', () => {
        expect(parse('xchain:BTC/send')).toMatchObject({ kind: 'send', chainId: 'bitcoin-mainnet' });
    });

    it('reads a coin-code receive', () => {
        expect(parse('xchain:TBTC/receive?tick=PEPE&amount=1')).toMatchObject({
            kind: 'receive', action: 'receive', chainId: 'bitcoin-testnet', tick: 'PEPE', amount: '1',
        });
    });

    it('reads a coin-code execute', () => {
        expect(parse('xchain:RBTC/execute?contract=362&method=release&params=alice%7C42')).toMatchObject({
            kind: 'execute', chainId: 'bitcoin-regtest', contractActionIndex: '362', method: 'release', executeParams: 'alice|42',
        });
    });

    it('reads a bare verb as that action without a chain', () => {
        expect(parse('xchain:receive')).toMatchObject({ kind: 'receive', action: 'receive' });
        expect(parse('xchain:RECEIVE?tick=PEPE')).toMatchObject({ kind: 'receive', tick: 'PEPE' });
        expect(parse(`xchain:send?to=${ADDR}&amount=1`)).toMatchObject({ kind: 'send', address: ADDR, amount: '1' });
        expect(parse('xchain:execute?contract=5&method=go')).toMatchObject({ kind: 'execute', contractActionIndex: '5' });
    });

    it('reads a bare address, with and without a named chain', () => {
        expect(parse(`xchain:${ADDR}?amount=1`)).toMatchObject({ kind: 'send', address: ADDR, amount: '1' });
        expect(parse(`xchain:${LTC_ADDR}`)).toMatchObject({ kind: 'send', address: LTC_ADDR });
        expect(parse(`xchain:${ADDR}?chain=bitcoin-mainnet`)).toMatchObject({ kind: 'send', chainId: 'bitcoin-mainnet' });
    });

    it('reads the legacy path-style send and receive', () => {
        expect(parse('xchain://bitcoin-mainnet/BTC?amount=1')).toMatchObject({ kind: 'send', chainId: 'bitcoin-mainnet' });
        expect(parse('xchain://bitcoin-mainnet/BTC?kind=receive')).toMatchObject({ kind: 'receive' });
    });
});

describe('xchain: targets that are neither a documented verb nor an address', () => {
    const junk = [
        'xchain:zzzz',
        'xchain:BTC',
        'xchain:BTC/',
        'xchain:BTC/foo',
        'xchain:BTC/send/extra',
        'xchain:BTC/send?to=zzzz',
        `xchain:BTC/send?to=${LTC_ADDR}`,
        'xchain:BTC/receive?to=zzzz',
        'xchain:send?to=zzzz',
        'xchain:execute?x=1',
        'xchain:execute',
        'xchain:BTC/execute?contract=abc',
        'xchain:BTC/execute?method=go',
        `xchain:${ADDR}x`,
        `xchain:${ADDR}?chain=litecoin-mainnet`,
        'xchain:connect',
        'xchain:',
    ];

    for (const uri of junk) {
        it(`refuses ${uri}`, () => {
            expect(parse(uri)).toEqual({ kind: 'unknown' });
            expect(deepLinkRoute(uri, registry)).toEqual(INVALID);
        });
    }
});

describe('routing of documented forms', () => {
    it('opens Receive for xchain:receive', () => {
        expect(deepLinkRoute('xchain:receive', registry)).toEqual({ view: 'receive' });
    });

    it('opens Send with the destination for xchain:send?to=', () => {
        const route = deepLinkRoute(`xchain:send?to=${ADDR}`, registry);
        expect(route.view).toBe('send');
        expect(route.sendPrefill.address).toBe(ADDR);
    });
});
