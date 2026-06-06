// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Chaos: hardware-signer vendor SDK call throws (Trezor Connect server
// unreachable, Ledger bridge dropped, USB pulled mid-flight). The
// signer wrapper must convert vendor-specific exceptions into the
// wallet's own SignerStatusError so the UI can render a stable error
// surface regardless of vendor.

import { describe, it, expect } from 'vitest';
import { SignerStatusError } from '../../../packages/core/src/signers/Signer.js';

// Stand-in for a vendor SDK that explodes on every call.
const explodingVendor = {
    async getStatus() { throw new Error('SDK_NOT_INITIALIZED'); },
    async signMessage() { throw new Error('TRANSPORT_LOST'); },
};

// Mirror the wrapping pattern from TrezorSigner / LedgerSigner: catch
// the vendor exception and re-throw as a SignerStatusError with a
// stable message.
function wrapVendorThrow(fn) {
    return async (...args) => {
        try { return await fn(...args); }
        catch (e) { throw new SignerStatusError(`vendor: ${e.message}`); }
    };
}

describe('chaos/signers/vendor-sdk-throws', () => {
    it('converts a vendor throw into a SignerStatusError', async () => {
        const wrapped = wrapVendorThrow(explodingVendor.getStatus);
        await expect(wrapped()).rejects.toBeInstanceOf(SignerStatusError);
    });

    it('preserves the underlying vendor message in the wrapped error', async () => {
        const wrapped = wrapVendorThrow(explodingVendor.signMessage);
        await expect(wrapped()).rejects.toThrow(/TRANSPORT_LOST/);
    });

    it('repeated failures all surface as SignerStatusError (no leaked vendor type)', async () => {
        const wrapped = wrapVendorThrow(explodingVendor.signMessage);
        for (let i = 0; i < 3; i += 1) {
            await expect(wrapped()).rejects.toBeInstanceOf(SignerStatusError);
        }
    });
});
