// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { COUNTERWALLET_WORDLIST } from '../../../packages/core/src/crypto/counterwallet-wordlist.js';
import { encodeWif } from '../../../packages/core/src/crypto/wif.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { buildBackupPointer } from '../../../packages/core/src/uri/backupPointer.js';
import { encodeBip21Uri } from '../../../packages/core/src/uri/bip21.js';
import {
    detectQrContent,
    PARTNER_PAIRING_PREFIX,
} from '../../../packages/core/src/uri/detectQrContent.js';
import { encodeXcwChunks } from '../../../packages/core/src/uri/psbtQr.js';

const registry = defaultRegistry();
const RAW_TRANSACTION = '0200000001'
    + '00'.repeat(32)
    + '00000000'
    + '00'
    + 'ffffffff'
    + '01'
    + '0100000000000000'
    + '00'
    + '00000000';
const CHAINS = registry.supportedChains().filter(({ coin, networkKind }) => (
    ['bitcoin', 'litecoin', 'dogecoin'].includes(coin)
    && ['mainnet', 'testnet', 'regtest'].includes(networkKind)
));

describe('detectQrContent', () => {
    it.each(CHAINS)('classifies a payment URI for $id', (descriptor) => {
        const uri = encodeBip21Uri({
            scheme: descriptor.uriScheme,
            address: `addressFor${descriptor.id.replaceAll('-', '')}`,
            amount: '1.25',
            params: { chain: descriptor.id },
        });

        expect(detectQrContent(uri, { chainRegistry: registry })).toMatchObject({
            type: 'bip21',
            scheme: descriptor.uriScheme,
            address: `addressFor${descriptor.id.replaceAll('-', '')}`,
            parts: {
                amount: '1.25',
                params: { chain: descriptor.id },
            },
        });
    });

    it.each([
        ['xchain URI', 'xchain:bc1qexample?amount=1', 'xchain-uri'],
        ['PSBT hex', '70736274ff00', 'psbt-hex'],
        ['raw transaction hex', RAW_TRANSACTION, 'transaction-hex'],
        ['compressed WIF', encodeWif(new Uint8Array(32).fill(1), 0x80), 'wif'],
        [
            'BIP39 mnemonic',
            'ABANDON abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
            'mnemonic-bip39',
        ],
        [
            'Counterwallet mnemonic',
            COUNTERWALLET_WORDLIST.slice(0, 12).join(' '),
            'mnemonic-counterwallet',
        ],
        ['probable address', 'bc1qexampleaddress000000000000000000', 'address'],
    ])('classifies %s', (_label, input, expectedType) => {
        expect(detectQrContent(input, { chainRegistry: registry }).type).toBe(expectedType);
    });

    it('classifies a backup pointer before generic URI handling', () => {
        const input = buildBackupPointer({
            location: 'https://backups.example/wallet.json',
            name: 'Cold wallet',
        });

        expect(detectQrContent(input)).toMatchObject({
            type: 'backup-pointer',
            pointer: {
                location: 'https://backups.example/wallet.json',
                name: 'Cold wallet',
            },
        });
    });

    it('classifies a valid XCW frame and returns its decoded content', () => {
        const [frame] = encodeXcwChunks('70736274ff', { chunkBytes: 64 });

        const detected = detectQrContent(frame, { chainRegistry: registry });

        expect(detected).toMatchObject({ type: 'xcw-chunk', n: 1, total: 1 });
        expect(detected.content).toBeInstanceOf(Uint8Array);
    });

    it.each([
        `${PARTNER_PAIRING_PREFIX}ZmFrZQ`,
        `${PARTNER_PAIRING_PREFIX}!!!not-base64!!!`,
        PARTNER_PAIRING_PREFIX,
    ])('reserves prefixed pairing content for the pairing parser: %s', (pairingCode) => {
        expect(detectQrContent(pairingCode)).toEqual({
            type: 'pairing-code',
            pairingCode,
        });
    });

    it.each([
        ['non-string', null],
        ['empty text', '   '],
        ['unknown registered scheme', 'monero:44AFFq5kSiGBoZ'],
        ['malformed known payment URI', 'bitcoin:?amount=1'],
        ['unsafe payment amount', 'bitcoin:bc1qexample?amount=1e8'],
        ['malformed backup pointer', 'xchain-backup:1?name=missing-location'],
        ['malformed XCW frame', 'XCW:1/1:00000000:not-base64!'],
        ['odd PSBT hex', '70736274ff0'],
        ['arbitrary prose', 'not a supported QR payload'],
    ])('returns unknown for %s', (_label, input) => {
        expect(detectQrContent(input, { chainRegistry: registry })).toEqual({ type: 'unknown' });
    });

    it('accepts a syntactically valid URI scheme without a registry', () => {
        expect(detectQrContent('custom:recipient').type).toBe('bip21');
        expect(detectQrContent('custom:recipient', { chainRegistry: registry }).type).toBe('unknown');
    });
});
