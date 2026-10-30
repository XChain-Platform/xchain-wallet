// @vitest-environment node

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer-supplied recipient key is bound to the destination address
// before encryption. Hex decoding drops a trailing odd nibble, so a key one
// character longer than a compressed key decodes to a different 33-byte key
// than the one the binding check measured. These tests drive the real SDK
// and prove such a key never reaches encryption.

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import {
    buildMessageParams,
    PubkeyMismatchError,
    recipientPubkeyMatchesAddress,
} from '../../../packages/core/src/flows/messageAction.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-mainnet';
const chainRegistry = defaultRegistry();
const registry = new SDKRegistry({ chainRegistry, sdkFactory: adaptXChainSDK(XChainSDK) });

function fixture(explorerKey) {
    const realSdk = registry.get(CHAIN_ID);
    const recipient = realSdk.wallet.generateKeyPair();
    const attacker = realSdk.wallet.generateKeyPair();
    const sender = realSdk.wallet.generateKeyPair();
    const destination = realSdk.wallet.deriveAddress(recipient.publicKeyHex, { type: 'p2wpkh' });
    const sdk = Object.create(realSdk);
    sdk.getPublicKey = async () => explorerKey(attacker.publicKeyHex, recipient.publicKeyHex);
    const opts = {
        chainRegistry,
        sdkRegistry: { get: () => sdk },
        chainId: CHAIN_ID,
        from: {
            address: realSdk.wallet.deriveAddress(sender.publicKeyHex, { type: 'p2wpkh' }),
            publicKey: sender.publicKeyHex,
            derivationPath: "m/84'/0'/0'/0/0",
        },
        signer: { exportWifForPath: async () => sender.wif },
        destination,
        message: 'for the recipient only',
    };
    return { realSdk, recipient, attacker, sender, destination, opts };
}

describe('recipient key binding with an odd-length key', () => {
    it('refuses an ECIES send when the explorer key has a trailing nibble', async () => {
        const { opts } = fixture((attackerKey) => `${attackerKey}0`);
        await expect(buildMessageParams({ ...opts, method: 1 }))
            .rejects.toBeInstanceOf(PubkeyMismatchError);
    });

    it('refuses an ECDH send when the explorer key has a trailing nibble', async () => {
        const { opts } = fixture((attackerKey) => `${attackerKey}f`);
        await expect(buildMessageParams({ ...opts, method: 2 }))
            .rejects.toBeInstanceOf(PubkeyMismatchError);
    });

    it('treats an odd-length key as a mismatch, never as unverifiable', () => {
        const { realSdk, attacker, recipient, destination } = fixture(() => null);
        const descriptor = chainRegistry.get(CHAIN_ID);
        expect(recipientPubkeyMatchesAddress(realSdk, `${attacker.publicKeyHex}0`, destination, descriptor))
            .toBe(false);
        expect(recipientPubkeyMatchesAddress(realSdk, `${recipient.publicKeyHex}0`, destination, descriptor))
            .toBe(false);
        expect(recipientPubkeyMatchesAddress(realSdk, recipient.publicKeyHex, destination, descriptor))
            .toBe(true);
    });

    it('encrypts to the recipient when the explorer key is the bound key', async () => {
        const { opts, realSdk, recipient, attacker } = fixture((_a, recipientKey) => recipientKey);
        const { params } = await buildMessageParams({ ...opts, method: 1 });
        expect(realSdk.messaging.eciesDecrypt(params.ENCRYPTED_MESSAGE, recipient.wif).plaintext)
            .toBe('for the recipient only');
        expect(() => realSdk.messaging.eciesDecrypt(params.ENCRYPTED_MESSAGE, attacker.wif)).toThrow();
    });
});
