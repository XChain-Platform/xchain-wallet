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

function verify(host) {
    return host.handle({
        type: 'auth.verifyMessage',
        request: {
            chainId: 'bitcoin-mainnet',
            address: 'wrong-address',
            message: 'modified message',
            signature: 'signature',
        },
    });
}

describe('background message verification result shape', () => {
    // The SDK answers an object, so a { valid: false } verdict must not read as truthy
    it('preserves an invalid SDK verification result', async () => {
        const host = verificationHost(() => ({ valid: false, error: null }));

        expect(await verify(host)).toMatchObject({ ok: true, result: { valid: false } });
    });

    it('preserves a valid SDK verification result', async () => {
        const host = verificationHost(() => ({ valid: true, error: null }));

        expect(await verify(host)).toMatchObject({ ok: true, result: { valid: true } });
    });

    it('accepts the bare boolean the demo stubs answer', async () => {
        expect(await verify(verificationHost(() => false))).toMatchObject({ ok: true, result: { valid: false } });
        expect(await verify(verificationHost(() => true))).toMatchObject({ ok: true, result: { valid: true } });
    });
});
