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
    descriptorFor: (id) => (id === 'bitcoin-testnet'
        ? { coin: 'bitcoin', networkKind: 'testnet' }
        : null),
};

describe('xchain URI edge branches', () => {
    it('builds every supported optional parameter in stable order', () => {
        expect(buildXchainUri({
            kind: 'send',
            action: 'CUSTOM',
            chainId: 'bitcoin-testnet',
            address: 'tb1qexample',
            amount: '1.25',
            tick: 'PEPE',
            memo: 'hello world',
            feePriority: 'FAST',
            label: 'invoice 7',
            message: 'thank you',
        }, { chainRegistry })).toBe(
            'xchain:TBTC/custom?to=tb1qexample&amount=1.25&tick=PEPE&memo=hello%20world'
            + '&feePriority=fast&label=invoice%207&message=thank%20you',
        );
    });

    it('uses the intent kind when action and query parameters are absent', () => {
        expect(buildXchainUri({
            kind: 'receive',
            chainId: 'bitcoin-testnet',
        }, { chainRegistry })).toBe('xchain:TBTC/receive');
    });

    it.each([
        ['missing intent', undefined, { chainRegistry }, /intent is required/],
        ['missing chain id', { kind: 'send' }, { chainRegistry }, /chainId is required/],
        ['missing registry', { kind: 'send', chainId: 'bitcoin-testnet' }, undefined, /chainRegistry is required/],
        ['unmapped chain', { kind: 'send', chainId: 'litecoin-mainnet' }, { chainRegistry }, /no coin code/],
    ])('rejects %s when building', (_label, intent, deps, message) => {
        expect(() => buildXchainUri(intent, deps)).toThrow(message);
    });

    it.each([
        ['non-string input', null],
        ['empty input', '   '],
        ['empty legacy path', 'xchain://'],
        ['parameter without equals', 'xchain:TBTC/send?amount'],
        ['invalid percent-encoded value', 'xchain:TBTC/send?memo=%ZZ'],
    ])('returns unknown for %s', (_label, uri) => {
        expect(parseXchainUri(uri, { chainRegistry })).toEqual({ kind: 'unknown' });
    });

    it('ignores an undecodable unknown query key instead of carrying its raw text', () => {
        const intent = parseXchainUri('xchain:TBTC/send?%ZZ=value', { chainRegistry });

        expect(intent.kind).toBe('send');
        expect(intent.params).toEqual({});
    });

    it('normalizes valid fee priorities and drops invalid priorities', () => {
        expect(parseXchainUri(
            'xchain:TBTC/send?feePriority=FAST',
            { chainRegistry },
        ).feePriority).toBe('fast');
        expect(parseXchainUri(
            'xchain://bitcoin-testnet/BTC?feePriority=urgent',
            { chainRegistry },
        ).feePriority).toBeUndefined();
    });

    it.each([
        ['receive amount and address', { kind: 'receive', amount: '2', tick: 'BTC', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.receiveAmountAt'],
        ['receive amount', { kind: 'receive', amount: '2', tick: 'BTC' }, 'uri.intent.receiveAmount'],
        ['receive asset and address', { kind: 'receive', tick: 'BTC', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.receiveAssetAt'],
        ['receive asset', { kind: 'receive', tick: 'BTC' }, 'uri.intent.receiveAsset'],
        ['receive address', { kind: 'receive', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.receiveAt'],
        ['receive bare', { kind: 'receive' }, 'uri.intent.receive'],
        ['send amount and address', { kind: 'send', amount: '2', tick: 'BTC', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.sendAmountTo'],
        ['send amount', { kind: 'send', amount: '2', tick: 'BTC' }, 'uri.intent.sendAmount'],
        ['send asset and address', { kind: 'send', tick: 'BTC', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.sendAssetTo'],
        ['send asset', { kind: 'send', tick: 'BTC' }, 'uri.intent.sendToken'],
        ['send address', { kind: 'send', address: 'bc1qabcdefghijklmnop' }, 'uri.intent.sendTo'],
        ['send bare', { kind: 'send' }, 'uri.intent.send'],
        ['unknown', { kind: 'unknown' }, 'uri.intent.unknown'],
    ])('describes %s', (_label, intent, key) => {
        const t = vi.fn((translationKey) => translationKey);

        expect(describeXchainIntent(intent, { i18n: { t } })).toBe(key);
        expect(t).toHaveBeenCalledOnce();
    });

    it('requires a translation function', () => {
        expect(() => describeXchainIntent({ kind: 'send' })).toThrow(/deps\.i18n\.t/);
    });
});
