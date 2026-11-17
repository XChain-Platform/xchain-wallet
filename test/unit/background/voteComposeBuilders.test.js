// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    nativeTicker: 'BTC',
};

function makeHost(sdk) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        vault: {
            settings: { get: async () => ({ activeNetwork: CHAIN.networkKind }) },
            wallets: { list: async () => [{ id: 'w1', name: 'Main' }] },
        },
        chainRegistry: { get: () => CHAIN, list: () => [CHAIN] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
    });
}

function request(builder, params) {
    return {
        walletId: 'w1',
        chainId: CHAIN.id,
        from: {
            address: 'bcrt1qsource',
            publicKey: `02${'11'.repeat(32)}`,
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        },
        builder,
        params,
    };
}

describe('vote compose builders', () => {
    it.each([
        [
            'delegateParams',
            { tick: ' JDOG ', delegateTo: ' bc1qdelegate ', memo: 'Keep voting' },
            { version: 3, tick: 'JDOG', delegateTo: 'bc1qdelegate', memo: 'Keep voting' },
        ],
        [
            'clearDelegationParams',
            { tick: ' JDOG ', memo: 'Vote directly' },
            { version: 3, tick: 'JDOG', delegateTo: '', memo: 'Vote directly' },
        ],
    ])('passes %s through the real SDK voting object', async (builder, params, expected) => {
        const realSdk = new XChainSDK({ network: CHAIN.id, preflight: false });
        let composedAction = null;
        const sdk = {
            voting: realSdk.voting,
            encoder: {},
            actions: {
                createAction(actionData) {
                    composedAction = actionData;
                    throw new Error('composition reached');
                },
            },
        };
        const response = await makeHost(sdk).handle({
            type: 'action.vote.composeForConfirm',
            request: request(builder, params),
        });

        expect(response).toMatchObject({ ok: false, error: { message: 'composition reached' } });
        expect(composedAction).toEqual({ action: 'VOTE', params: expected });
    });
});
