// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: validateChainDescriptor endpoint scheme allowlist.
//
// Endpoint URLs are consumed directly by SDKRegistry for live balance /
// PSBT / hub requests. The signed registry authenticates the descriptor
// blob once, but the API calls it configures carry no signature, so an
// http:// endpoint that validated cleanly was a standing cleartext-MITM
// primitive (hostile Developer-Mode custom chain, or a registry-key
// compromise). https/wss are required everywhere; http/ws pass only on
// regtest chains or loopback hosts.

import { describe, it, expect } from 'vitest';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const mainnetBase = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');
const regtestBase = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');

function withEndpoint(base, field, url) {
    return { ...base, [field]: { ...base[field], defaultUrl: url } };
}

describe('validateChainDescriptor: endpoint scheme allowlist', () => {
    it('accepts every bundled descriptor unchanged', () => {
        for (const d of BUNDLED_DESCRIPTORS) {
            const res = validateChainDescriptor(d);
            expect(res.ok, `${d.id}: ${res.errors?.join('; ')}`).toBe(true);
        }
    });

    it('rejects an http endpoint on a non-regtest, non-loopback chain', () => {
        for (const field of ['explorer', 'encoder', 'hub']) {
            const res = validateChainDescriptor(
                withEndpoint(mainnetBase, field, 'http://explorer.evil.example/BTC'),
            );
            expect(res.ok).toBe(false);
            expect(res.errors.join(' ')).toMatch(new RegExp(field));
        }
    });

    it('rejects a ws endpoint on a mainnet chain', () => {
        const res = validateChainDescriptor(
            withEndpoint(mainnetBase, 'hub', 'ws://hub.evil.example/BTC'),
        );
        expect(res.ok).toBe(false);
    });

    it('rejects non-http(s)/ws(s) schemes outright', () => {
        for (const url of ['ftp://x.example', 'javascript:alert(1)', 'not a url']) {
            const res = validateChainDescriptor(withEndpoint(mainnetBase, 'explorer', url));
            expect(res.ok, url).toBe(false);
        }
    });

    it('accepts https and wss everywhere', () => {
        expect(validateChainDescriptor(
            withEndpoint(mainnetBase, 'hub', 'wss://hub.xchain.io/BTC'),
        ).ok).toBe(true);
    });

    it('allows http on regtest chains (local stacks)', () => {
        const res = validateChainDescriptor(
            withEndpoint(regtestBase, 'explorer', 'http://localhost'),
        );
        expect(res.ok).toBe(true);
    });

    it('allows http to loopback hosts even on non-regtest chains', () => {
        for (const host of ['localhost', '127.0.0.1', '[::1]']) {
            const res = validateChainDescriptor(
                withEndpoint(mainnetBase, 'explorer', `http://${host}:18080`),
            );
            expect(res.ok, host).toBe(true);
        }
    });
});
