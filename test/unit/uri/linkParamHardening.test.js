// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Payment-link parameters that could make the prefilled form differ from what
// the link says: repeated fields and mixed-case required markers.

import { describe, expect, it } from 'vitest';
import { registry as registryLib } from '@xchain-wallet/core';
import { parseBip21Uri, InvalidBip21Error } from '../../../packages/core/src/uri/bip21.js';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';

const registry = registryLib.defaultRegistry();
const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

describe('repeated parameters', () => {
    it('refuses a BIP21 link that repeats a recognized parameter', () => {
        expect(() => parseBip21Uri(`bitcoin:${ADDR}?amount=1&amount=2`)).toThrow(InvalidBip21Error);
        expect(() => parseBip21Uri(`bitcoin:${ADDR}?amount=1&AMOUNT=2`)).toThrow(InvalidBip21Error);
        expect(() => parseBip21Uri(`bitcoin:${ADDR}?label=a&label=b`)).toThrow(InvalidBip21Error);
    });

    it('refuses an xchain link that repeats a recognized parameter', () => {
        expect(parseXchainUri(`xchain:BTC/send?to=${ADDR}&amount=1&amount=2`, { chainRegistry: registry }).kind).toBe('unknown');
        expect(parseXchainUri(`xchain:BTC/send?to=${ADDR}&to=${ADDR}x`, { chainRegistry: registry }).kind).toBe('unknown');
        expect(parseXchainUri(`xchain:${ADDR}?amount=1&amount=2`).kind).toBe('unknown');
    });

    it('still accepts repeated unknown parameters', () => {
        expect(parseBip21Uri(`bitcoin:${ADDR}?x=1&x=2&amount=1`).amount).toBe('1');
    });
});

describe('required-parameter marker case', () => {
    it('rejects an upper-case req- parameter on an xchain link', () => {
        expect(parseXchainUri(`xchain:BTC/send?to=${ADDR}&REQ-foo=1`, { chainRegistry: registry }).kind).toBe('unknown');
        expect(parseXchainUri(`xchain://bitcoin-mainnet/BTC?to=${ADDR}&Req-foo=1`).kind).toBe('unknown');
    });

    it('reads the standard field names case-insensitively on an xchain link', () => {
        const intent = parseXchainUri(`xchain:BTC/send?to=${ADDR}&Amount=2`, { chainRegistry: registry });
        expect(intent.amount).toBe('2');
    });
});
