// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const mainnet = new XChainSDK({ network: 'bitcoin-mainnet' });
const testnet = new XChainSDK({ network: 'bitcoin-testnet' });

function host() {
    return createBackgroundHost({
        vault: {},
        chainRegistry: {},
        sdkRegistry: { get: () => mainnet },
        signerPool: {},
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

function verify(address, message, signature) {
    return host().handle({
        type: 'auth.verifyMessage',
        request: { chainId: 'bitcoin-mainnet', address, message, signature },
    });
}

describe('background message verification network check', () => {
    const key = mainnet.wallet.generateKeyPair();
    const signed = mainnet.auth.signMessage('network check', key.wif, {});

    it('accepts the signer address on the chosen network', async () => {
        expect(await verify(signed.address, 'network check', signed.signature))
            .toMatchObject({ ok: true, result: { valid: true } });
    });

    it('refuses the same key hash written as a testnet address', async () => {
        const testnetAddress = testnet.wallet.deriveAddress(key.publicKey, { type: 'p2pkh' });
        expect(await verify(testnetAddress, 'network check', signed.signature))
            .toMatchObject({ ok: true, result: { valid: false } });
    });
});
