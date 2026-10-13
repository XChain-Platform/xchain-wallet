// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as backgroundBridge from '../../../packages/extension/src/background/signerBridge.js';
import {
    registerSigner,
    registeredIds,
    unregisterSigner,
} from '../../../packages/web/src/signerBridge.js';

beforeEach(() => {
    unregisterSigner('signer-1');
    backgroundBridge.clearAll();
});
afterEach(() => {
    unregisterSigner('signer-1');
    backgroundBridge.clearAll();
});

function fakeSigner() {
    return {
        getStatus: vi.fn(async () => ({ connected: true })),
        getAddresses: vi.fn(async () => ['bc1qaddress']),
        getPublicKey: vi.fn(async () => 'public-key'),
        signPsbt: vi.fn(async () => ({ signedPsbtHex: 'abcd' })),
        signMessage: vi.fn(async () => ({ signature: 'signature' })),
    };
}

describe('web signer bridge', () => {
    it('registers one in-process transport and routes every signer operation', async () => {
        const signer = fakeSigner();
        registerSigner('signer-1', signer);
        const transport = backgroundBridge.getTransport('signer-1');
        const payload = { signerId: 'signer-1', chainId: 'bitcoin-mainnet' };

        await expect(transport({ op: 'status', payload })).resolves.toEqual({ connected: true });
        await expect(transport({ op: 'getAddresses', payload })).resolves.toEqual(['bc1qaddress']);
        await expect(transport({ op: 'getPublicKey', payload })).resolves.toBe('public-key');
        await expect(transport({ op: 'signPsbt', payload })).resolves.toEqual({ signedPsbtHex: 'abcd' });
        await expect(transport({ op: 'signMessage', payload })).resolves.toEqual({ signature: 'signature' });

        for (const method of Object.values(signer)) {
            expect(method).toHaveBeenCalledWith(payload);
        }
        expect(registeredIds()).toEqual(['signer-1']);
    });

    it('validates registrations and rejects unknown routing requests', async () => {
        expect(() => registerSigner('', fakeSigner())).toThrow('signerId is required');
        expect(() => registerSigner('bad', {})).toThrow('must implement Signer');

        registerSigner('signer-1', fakeSigner());
        const transport = backgroundBridge.getTransport('signer-1');
        await expect(transport({ op: 'unknown', payload: { signerId: 'signer-1' } }))
            .rejects.toThrow('unknown op');
        await expect(transport({ op: 'status', payload: { signerId: 'missing' } }))
            .rejects.toMatchObject({ name: 'SignerNotRegisteredError' });
    });

    it('unregisters from both the web map and the background registry', () => {
        registerSigner('signer-1', fakeSigner());
        unregisterSigner('signer-1');
        unregisterSigner('signer-1');

        expect(registeredIds()).toEqual([]);
        expect(backgroundBridge.getTransport('signer-1')).toBeNull();
    });
});
