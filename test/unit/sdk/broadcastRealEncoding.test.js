// @vitest-environment node

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');

const CHAIN_ID = 'bitcoin-regtest';
const PUBKEY = `02${'11'.repeat(32)}`;

function realEncoderHarness() {
    const registry = new SDKRegistry({
        chainRegistry: defaultRegistry(),
        sdkFactory: adaptXChainSDK(XChainSDK),
    });
    const sdk = registry.get(CHAIN_ID);
    const rpc = vi.spyOn(sdk.encoder, 'rpc').mockResolvedValue({
        psbt: '70736274ff',
        encoding: 'OP_RETURN',
    });
    return { sdk, rpc };
}

async function encodeBroadcast(sdk, params) {
    const action = sdk.actions.createAction({ action: 'BROADCAST', params });
    const encoded = await sdk.encoder.createTx({
        data: action.actionString,
        pubkey: PUBKEY,
        utxos: [],
        encoding: 'op_return',
    });
    return { action, encoded };
}

describe('BROADCAST v2/v3 real SDK encoding through the wallet registry', () => {
    it('serializes a v2 feed definition and forwards the exact wire string to create_tx', async () => {
        const { sdk, rpc } = realEncoderHarness();
        const params = {
            VERSION: '2',
            MESSAGE: 'price-feed',
            FEE: '1.25',
            MEMO: 'feed definition',
        };

        const { action, encoded } = await encodeBroadcast(sdk, params);

        expect(action).toMatchObject({
            action: 'BROADCAST',
            version: 2,
            actionString: 'BROADCAST|2|price-feed|1.25|feed definition',
            fields: {
                MESSAGE: params.MESSAGE,
                FEE: params.FEE,
                MEMO: params.MEMO,
            },
        });
        expect(rpc).toHaveBeenCalledOnce();
        expect(rpc).toHaveBeenCalledWith('create_tx', {
            data: action.actionString,
            pubkey: PUBKEY,
            utxos: [],
            encoding: 'OP_RETURN',
        });
        expect(encoded).toEqual({ psbt: '70736274ff', encoding: 'OP_RETURN' });
    });

    it('serializes a v3 feed result without inventing a MESSAGE or FEE field', async () => {
        const { sdk, rpc } = realEncoderHarness();
        const params = {
            VERSION: '3',
            BROADCAST_ACTION_INDEX: '42',
            VALUE: '123.5',
            MEMO: 'feed result',
        };

        const { action } = await encodeBroadcast(sdk, params);

        expect(action).toMatchObject({
            action: 'BROADCAST',
            version: 3,
            actionString: 'BROADCAST|3|42|123.5|feed result',
            fields: {
                BROADCAST_ACTION_INDEX: params.BROADCAST_ACTION_INDEX,
                VALUE: params.VALUE,
                MEMO: params.MEMO,
            },
        });
        expect(action.fields).not.toHaveProperty('MESSAGE');
        expect(action.fields).not.toHaveProperty('FEE');
        expect(rpc).toHaveBeenCalledWith('create_tx', expect.objectContaining({
            data: 'BROADCAST|3|42|123.5|feed result',
        }));
    });
});
