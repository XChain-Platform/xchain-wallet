// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import {
    encodeBip21Uri,
    parseBip21Uri,
} from '../../../packages/core/src/uri/bip21.js';
import { detectQrContent } from '../../../packages/core/src/uri/detectQrContent.js';

const registry = defaultRegistry();
const CHAINS = registry.supportedChains().filter((descriptor) => (
    ['bitcoin', 'litecoin', 'dogecoin'].includes(descriptor.coin)
    && ['mainnet', 'testnet', 'regtest'].includes(descriptor.networkKind)
));

describe('BIP21-style Receive payment requests', () => {
    it('covers BTC, LTC, and DOGE on every bundled network', () => {
        expect(CHAINS.map(({ id }) => id).sort()).toEqual([
            'bitcoin-mainnet',
            'bitcoin-regtest',
            'bitcoin-testnet',
            'dogecoin-mainnet',
            'dogecoin-regtest',
            'dogecoin-testnet',
            'litecoin-mainnet',
            'litecoin-regtest',
            'litecoin-testnet',
        ]);
    });

    it.each(CHAINS.flatMap((descriptor) => [
        [descriptor, '0.00000001', '0.00000001'],
        [descriptor, '21000000', '21000000'],
        [descriptor, '', undefined],
        [descriptor, '21000000.00000000', '21000000'],
    ]))(
        '%s round-trips amount %s through the Scan/Send classifier',
        (descriptor, amount, expectedAmount) => {
            const address = `address-for-${descriptor.id}`;
            const uri = encodeBip21Uri({
                scheme: descriptor.uriScheme,
                address,
                amount,
                label: "Alice & Bob's wallet",
                message: 'Invoice #1 / lunch?',
                params: { chain: descriptor.id },
            });

            expect(uri.startsWith(`${descriptor.uriScheme}:${address}`)).toBe(true);
            expect(uri).toContain('label=Alice%20%26%20Bob%27s%20wallet');
            expect(uri).toContain('message=Invoice%20%231%20%2F%20lunch%3F');
            if (expectedAmount === undefined) expect(uri).not.toContain('amount=');
            else expect(uri).toContain(`amount=${expectedAmount}`);

            const parsed = parseBip21Uri(uri);
            expect(parsed).toMatchObject({
                scheme: descriptor.uriScheme,
                address,
                label: "Alice & Bob's wallet",
                message: 'Invoice #1 / lunch?',
            });
            expect(parsed.amount).toBe(expectedAmount);
            expect(parsed.params.chain).toBe(descriptor.id);

            const detected = detectQrContent(uri, { chainRegistry: registry });
            expect(detected.type).toBe('bip21');
            expect(detected.address).toBe(address);
            expect(detected.parts.amount).toBe(expectedAmount);
            expect(detected.parts.params.chain).toBe(descriptor.id);
        },
    );

    it.each(CHAINS)('%s rejects comma-formatted amounts', (descriptor) => {
        expect(() => encodeBip21Uri({
            scheme: descriptor.uriScheme,
            address: `address-for-${descriptor.id}`,
            amount: '21,000,000',
        })).toThrow(/plain decimal/);
    });

    it.each(['1e-8', '2.1E7', '0.000000001'])('rejects unsafe amount syntax %s', (amount) => {
        expect(() => encodeBip21Uri({
            scheme: 'bitcoin',
            address: 'bc1qexample',
            amount,
        })).toThrow();
        expect(detectQrContent(
            `bitcoin:bc1qexample?amount=${amount}`,
            { chainRegistry: registry },
        ).type).toBe('unknown');
    });

    it('surfaces required extension parameters separately', () => {
        const parsed = parseBip21Uri('bitcoin:bc1qexample?req-extra=needed&label=Invoice');

        expect(parsed.required).toEqual(['extra']);
        expect(parsed.params).toEqual({
            'req-extra': 'needed',
            label: 'Invoice',
        });
    });

    it.each([
        '1bitcoin:bc1qexample',
        'bit_coin:bc1qexample',
    ])('rejects an invalid URI scheme in %s', (uri) => {
        expect(() => parseBip21Uri(uri)).toThrow(/invalid scheme/);
    });
});
