// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const registry = new SDKRegistry({
    chainRegistry: defaultRegistry(),
    sdkFactory: adaptXChainSDK(XChainSDK),
});

function fixture() {
    const sdk = registry.get('bitcoin-mainnet');
    return {
        sdk,
        recipient: sdk.wallet.generateKeyPair(),
        stranger: sdk.wallet.generateKeyPair(),
    };
}

describe('messaging ciphertext hostility', () => {
    it('decrypts an intact ECIES envelope and rejects malformed or truncated input', () => {
        const { sdk, recipient } = fixture();
        const { ciphertext } = sdk.messaging.eciesEncrypt('authenticated body', recipient.publicKey);

        expect(sdk.messaging.eciesDecrypt(ciphertext, recipient.wif).plaintext)
            .toBe('authenticated body');
        expect(() => sdk.messaging.eciesDecrypt('not-hex', recipient.wif)).toThrow();
        expect(() => sdk.messaging.eciesDecrypt(ciphertext.slice(0, 80), recipient.wif)).toThrow();
    });

    it('rejects ECIES ciphertext under the wrong private key', () => {
        const { sdk, recipient, stranger } = fixture();
        const { ciphertext } = sdk.messaging.eciesEncrypt('recipient only', recipient.publicKey);

        expect(() => sdk.messaging.eciesDecrypt(ciphertext, stranger.wif)).toThrow();
    });

    it('authenticates session envelopes and rejects wrong or truncated secrets', () => {
        const { sdk } = fixture();
        const sharedSecret = Buffer.alloc(32, 0x11);
        const wrongSecret = Buffer.alloc(32, 0x22);
        const { ciphertext } = sdk.messaging.sessionEncrypt('shared session', sharedSecret);

        expect(sdk.messaging.sessionDecrypt(ciphertext, sharedSecret).plaintext)
            .toBe('shared session');
        expect(() => sdk.messaging.sessionDecrypt(ciphertext, wrongSecret)).toThrow();
        expect(() => sdk.messaging.sessionDecrypt(ciphertext.slice(0, 20), sharedSecret)).toThrow();
    });
});

