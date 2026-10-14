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

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const registry = new SDKRegistry({
    chainRegistry: defaultRegistry(),
    sdkFactory: adaptXChainSDK(XChainSDK),
});

const ADDRESS_CASES = [
    {
        name: 'Bitcoin legacy P2PKH',
        chainId: 'bitcoin-mainnet',
        addressType: 'p2pkh',
        signOptions: {},
    },
    {
        name: 'Bitcoin nested SegWit P2SH-P2WPKH',
        chainId: 'bitcoin-mainnet',
        addressType: 'p2sh-p2wpkh',
        signOptions: { segwitRedeemScript: true },
    },
    {
        name: 'Bitcoin native SegWit P2WPKH',
        chainId: 'bitcoin-mainnet',
        addressType: 'p2wpkh',
        signOptions: { segwitNative: true },
    },
    {
        name: 'Litecoin legacy P2PKH',
        chainId: 'litecoin-mainnet',
        addressType: 'p2pkh',
        signOptions: {},
    },
    {
        name: 'Litecoin nested SegWit P2SH-P2WPKH',
        chainId: 'litecoin-mainnet',
        addressType: 'p2sh-p2wpkh',
        signOptions: { segwitRedeemScript: true },
    },
    {
        name: 'Litecoin native SegWit P2WPKH',
        chainId: 'litecoin-mainnet',
        addressType: 'p2wpkh',
        signOptions: { segwitNative: true },
    },
    {
        name: 'Dogecoin legacy P2PKH',
        chainId: 'dogecoin-mainnet',
        addressType: 'p2pkh',
        signOptions: {},
    },
];

const MESSAGES = [
    ['plain text', 'Prove control of this wallet address.'],
    ['unicode and multiple lines', 'Wallet ownership\n雪と月 🚀\nLine three'],
];

describe.each(ADDRESS_CASES)('$name message signing', ({
    chainId,
    addressType,
    signOptions,
}) => {
    it.each(MESSAGES)('round trips %s and rejects altered claims', (_messageKind, message) => {
        const sdk = registry.get(chainId);
        const signer = sdk.wallet.generateKeyPair();
        const stranger = sdk.wallet.generateKeyPair();
        const signed = sdk.auth.signMessage(message, signer.wif, signOptions);
        const expectedAddress = sdk.wallet.deriveAddress(signer.publicKey, { type: addressType });
        const wrongAddress = sdk.wallet.deriveAddress(stranger.publicKey, { type: addressType });

        expect(signed.address).toBe(expectedAddress);
        expect(sdk.auth.verifyMessage(signed.address, message, signed.signature)).toEqual({
            valid: true,
            error: null,
        });
        expect(sdk.auth.verifyMessage(signed.address, `${message}!`, signed.signature)).toEqual({
            valid: false,
            error: null,
        });
        expect(sdk.auth.verifyMessage(wrongAddress, message, signed.signature)).toEqual({
            valid: false,
            error: null,
        });
    });
});
