// @vitest-environment node

// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const chainRegistry = defaultRegistry();
const registry = new SDKRegistry({
    chainRegistry,
    sdkFactory: adaptXChainSDK(XChainSDK),
    rateLimiter: null,
});

const ADDRESS_CASES = chainRegistry.supportedChains().flatMap((descriptor) => (
    descriptor.addressTypes.map((addressType) => ({
        chainId: descriptor.id,
        addressType,
    }))
));

function keyExplorer(pubkey) {
    return { getPublicKey: vi.fn(async () => ({ pubkey })) };
}

describe('SDKRegistry messaging public-key binding', () => {
    it.each(ADDRESS_CASES)(
        'accepts an honest $addressType key on $chainId or fails closed when the SDK cannot derive it',
        async ({ chainId, addressType }) => {
            const sdk = registry.get(chainId);
            const key = sdk.wallet.generateKeyPair();
            let address;
            try {
                address = sdk.wallet.deriveAddress(key.publicKeyHex, { type: addressType });
            } catch (error) {
                expect(addressType).toBe('p2tr');
                expect(chainId.startsWith('bitcoin-')).toBe(true);
                expect(error.code).toBe('INVALID_ADDRESS_TYPE');
                const explorer = keyExplorer(key.publicKeyHex);
                await expect(sdk.messaging.getPublicKey('unverifiable-p2tr', explorer))
                    .resolves.toBeNull();
                expect(explorer.getPublicKey).toHaveBeenCalledOnce();
                return;
            }

            const explorer = keyExplorer(key.publicKeyHex);
            await expect(sdk.messaging.getPublicKey(address, explorer))
                .resolves.toBe(key.publicKeyHex);
            expect(explorer.getPublicKey).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['another address key', (honest, stranger) => stranger],
        ['one changed hex digit', (honest) => `${honest.slice(0, -1)}${honest.endsWith('0') ? '1' : '0'}`],
        ['empty', () => ''],
        ['non-hex', () => 'not-hex'],
        ['null', () => null],
    ])('returns null for %s after one explorer read', async (_name, explorerValue) => {
        const sdk = registry.get('bitcoin-mainnet');
        const honest = sdk.wallet.generateKeyPair();
        const stranger = sdk.wallet.generateKeyPair();
        const address = sdk.wallet.deriveAddress(honest.publicKeyHex, { type: 'p2wpkh' });
        const explorer = keyExplorer(explorerValue(honest.publicKeyHex, stranger.publicKeyHex));

        await expect(sdk.messaging.getPublicKey(address, explorer)).resolves.toBeNull();
        expect(explorer.getPublicKey).toHaveBeenCalledOnce();
    });

    it('shadows only the created instance messaging utility', () => {
        const guarded = registry.get('litecoin-mainnet');
        const unguarded = new XChainSDK({ network: 'litecoin-mainnet' });

        expect(Object.hasOwn(guarded.messaging, 'getPublicKey')).toBe(true);
        expect(Object.hasOwn(unguarded.messaging, 'getPublicKey')).toBe(false);
        expect(guarded.messaging).not.toBe(unguarded.messaging);
    });

    it('also guards the SDK convenience delegate without another read', async () => {
        const sdk = registry.get('dogecoin-mainnet');
        const key = sdk.wallet.generateKeyPair();
        const address = sdk.wallet.deriveAddress(key.publicKeyHex, { type: 'p2pkh' });
        const explorer = keyExplorer(key.publicKeyHex);
        sdk.explorer = explorer;

        await expect(sdk.getPublicKey(address)).resolves.toBe(key.publicKeyHex);
        expect(explorer.getPublicKey).toHaveBeenCalledOnce();
    });

    it('keeps a forged ECDH row encrypted and decrypts the honest sender row', async () => {
        const sdk = registry.get('bitcoin-mainnet');
        const recipient = sdk.wallet.generateKeyPair();
        const sender = sdk.wallet.generateKeyPair();
        const forger = sdk.wallet.generateKeyPair();
        const recipientAddress = sdk.wallet.deriveAddress(recipient.publicKeyHex, { type: 'p2wpkh' });
        const claimedSender = sdk.wallet.deriveAddress(sender.publicKeyHex, { type: 'p2wpkh' });
        const message = 'bound to the actual sender';

        const rowFor = (ciphertext) => ({
            source: claimedSender,
            destination: recipientAddress,
            encrypted_message: ciphertext,
            encryption_method: 1,
            tx_hash: 'message-txid',
        });
        const messagesFor = (row, pubkey) => ({
            getMessages: vi.fn(async () => [row]),
            getPublicKey: vi.fn(async () => ({ pubkey })),
        });

        const forgedSecret = sdk.messaging.deriveSharedSecret(
            forger.wif,
            recipient.publicKeyHex,
        ).sharedSecret;
        const forgedCiphertext = sdk.messaging.sessionEncrypt(message, forgedSecret).ciphertext;
        const recipientViewOfForgedSecret = sdk.messaging.deriveSharedSecret(
            recipient.wif,
            forger.publicKeyHex,
        ).sharedSecret;
        expect(sdk.messaging.sessionDecrypt(forgedCiphertext, recipientViewOfForgedSecret).plaintext)
            .toBe(message);
        const forgedExplorer = messagesFor(rowFor(forgedCiphertext), forger.publicKeyHex);
        const [forgedEntry] = await sdk.messaging.getMessages(
            recipientAddress,
            { wif: recipient.wif },
            forgedExplorer,
        );

        expect(forgedEntry).toMatchObject({
            from: claimedSender,
            to: recipientAddress,
            text: null,
            encrypted: true,
            method: 1,
        });
        expect(forgedExplorer.getPublicKey).toHaveBeenCalledOnce();

        const honestSecret = sdk.messaging.deriveSharedSecret(
            sender.wif,
            recipient.publicKeyHex,
        ).sharedSecret;
        const honestCiphertext = sdk.messaging.sessionEncrypt(message, honestSecret).ciphertext;
        const honestExplorer = messagesFor(rowFor(honestCiphertext), sender.publicKeyHex);
        const [honestEntry] = await sdk.messaging.getMessages(
            recipientAddress,
            { wif: recipient.wif },
            honestExplorer,
        );

        expect(honestEntry).toMatchObject({
            from: claimedSender,
            to: recipientAddress,
            text: message,
            encrypted: true,
            method: 2,
        });
        expect(honestExplorer.getPublicKey).toHaveBeenCalledOnce();
    });

    it('leaves ECIES decryption unchanged and performs no sender-key lookup', async () => {
        const sdk = registry.get('litecoin-testnet');
        const recipient = sdk.wallet.generateKeyPair();
        const sender = sdk.wallet.generateKeyPair();
        const recipientAddress = sdk.wallet.deriveAddress(recipient.publicKeyHex, { type: 'p2wpkh' });
        const senderAddress = sdk.wallet.deriveAddress(sender.publicKeyHex, { type: 'p2wpkh' });
        const ciphertext = sdk.messaging.eciesEncrypt(
            'standard ECIES message',
            recipient.publicKeyHex,
        ).ciphertext;
        const explorer = {
            getMessages: vi.fn(async () => [{
                source: senderAddress,
                destination: recipientAddress,
                encrypted_message: ciphertext,
                encryption_method: 1,
            }]),
            getPublicKey: vi.fn(async () => { throw new Error('unexpected lookup'); }),
        };

        const [entry] = await sdk.messaging.getMessages(
            recipientAddress,
            { wif: recipient.wif },
            explorer,
        );

        expect(entry).toMatchObject({
            text: 'standard ECIES message',
            encrypted: true,
            method: 1,
        });
        expect(explorer.getPublicKey).not.toHaveBeenCalled();
    });
});
