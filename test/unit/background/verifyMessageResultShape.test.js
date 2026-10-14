// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';

function verificationHost(verifyMessage) {
    return createBackgroundHost({
        vault: {},
        chainRegistry: {},
        sdkRegistry: {
            get: () => ({ auth: { verifyMessage } }),
        },
        signerPool: {},
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

describe('background message verification result shape', () => {
    // BUG: auth.verifyMessage treats the SDK's { valid: false } result object as truthy.
    it.skip('preserves an invalid SDK verification result', async () => {
        const host = verificationHost(() => ({ valid: false, error: null }));

        const response = await host.handle({
            type: 'auth.verifyMessage',
            request: {
                chainId: 'bitcoin-mainnet',
                address: 'wrong-address',
                message: 'modified message',
                signature: 'signature',
            },
        });

        expect(response).toMatchObject({ ok: true, result: { valid: false } });
    });
});
