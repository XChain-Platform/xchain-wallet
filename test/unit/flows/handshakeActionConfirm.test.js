// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'handshake-tx' })),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || from.id || null,
    })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    buildHandshakeActionData,
    handshakeAction,
} from '../../../packages/core/src/flows/messageAction.js';

const FROM = Object.freeze({
    id: 'owner-1',
    address: 'bc1qowner',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
});
const chainRegistry = { get: () => ({ coin: 'bitcoin' }) };

beforeEach(() => {
    vi.mocked(submitAction).mockClear();
});

describe('handshakeAction confirmation contract', () => {
    it('builds the same deterministic action data used on the confirm screen', () => {
        const built = buildHandshakeActionData({
            chainRegistry,
            chainId: 'bitcoin-mainnet',
            from: FROM,
            destination: 'bc1qcounterparty',
            version: 1,
        });

        expect(built.actionData).toEqual({
            action: 'MESSAGE',
            params: {
                VERSION: '1',
                COIN: 'BTC',
                DESTINATION: 'bc1qcounterparty',
                ENCRYPTION_METHOD: '2',
                ENCRYPTION_KEY: FROM.publicKey,
            },
        });
    });

    it('forwards the confirmed PSBT without rebuilding it', async () => {
        const prebuiltPsbt = {
            psbtHex: 'aa00',
            encoding: 'psbt',
            actionString: 'MESSAGE|1|BTC|bc1qcounterparty|2|02aabbcc',
            version: 1,
        };
        await handshakeAction({
            vault: {},
            walletId: 'wallet-1',
            password: 'pw',
            chainRegistry,
            sdkRegistry: {},
            chainId: 'bitcoin-mainnet',
            from: FROM,
            destination: 'bc1qcounterparty',
            version: 1,
            prebuiltPsbt,
        });

        const submitted = vi.mocked(submitAction).mock.calls[0][0];
        expect(submitted.prebuiltPsbt).toBe(prebuiltPsbt);
        expect(submitted.actionData.params.VERSION).toBe('1');
    });
});
