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
import { addCustomChain } from '../../../packages/core/src/flows/customChains.js';
import { BUNDLED_DESCRIPTORS, ChainRegistry } from '../../../packages/core/src/registry/index.js';

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

describe('validateChainDescriptor: endpoint credentials, length and icon URLs', () => {
    const custom = {
        ...regtestBase,
        id: 'forkcoin-regtest',
        coin: 'forkcoin',
        wifVersionByte: 0xef,
        derivationPaths: { p2pkh: "m/44'/9'/A'/C/I" },
        addressTypes: ['p2pkh'],
        defaultAddressType: 'p2pkh',
    };

    it('accepts the custom baseline', () => {
        expect(validateChainDescriptor(custom).ok).toBe(true);
    });

    it('rejects userinfo in an endpoint URL', () => {
        const res = validateChainDescriptor(withEndpoint(custom, 'explorer', 'https://user:pw@node.example/'));
        expect(res.ok).toBe(false);
        expect(validateChainDescriptor(withEndpoint(custom, 'encoder', 'https://user@node.example/')).ok).toBe(false);
        expect(validateChainDescriptor(withEndpoint(custom, 'hub', 'http://u:p@localhost:8080/')).ok).toBe(false);
    });

    it('rejects an endpoint URL over 2048 characters', () => {
        const long = `https://node.example/${'a'.repeat(2100)}`;
        expect(validateChainDescriptor(withEndpoint(custom, 'explorer', long)).ok).toBe(false);
    });

    it('rejects userinfo in a transaction explorer URL', () => {
        const res = validateChainDescriptor({
            ...custom,
            transactionExplorers: [{ id: 'x', label: 'X', url: 'https://u:p@x.example/tx/{txid}' }],
        });
        expect(res.ok).toBe(false);
    });

    it('accepts only an https iconImg on a transaction explorer', () => {
        const entry = (iconImg) => ({
            ...custom,
            transactionExplorers: [{ id: 'x', label: 'X', url: 'https://x.example/tx/{txid}', iconImg }],
        });
        expect(validateChainDescriptor(entry('https://x.example/favicon.ico')).ok).toBe(true);
        expect(validateChainDescriptor(entry('javascript:alert(1)')).ok).toBe(false);
        expect(validateChainDescriptor(entry('data:image/png;base64,AAAA')).ok).toBe(false);
        expect(validateChainDescriptor(entry('http://evil.example/p.png')).ok).toBe(false);
        expect(validateChainDescriptor(entry('file:///etc/passwd')).ok).toBe(false);
    });
});

describe('custom chains: known-family mainnet is reserved to its own id', () => {
    it('the registry rejects a user-added bitcoin mainnet clone under another id', () => {
        const reg = new ChainRegistry();
        expect(() => reg.addCustom({ ...mainnetBase, id: 'mybtc-mainnet' })).toThrow(/bitcoin-mainnet/);
    });

    it('addCustomChain rejects litecoin and dogecoin mainnet clones under another id', async () => {
        for (const id of ['litecoin-mainnet', 'dogecoin-mainnet']) {
            const base = BUNDLED_DESCRIPTORS.find((d) => d.id === id);
            const vault = { settings: { get: async () => ({}), put: async () => {} } };
            await expect(addCustomChain({
                vault, chainRegistry: new ChainRegistry(), descriptor: { ...base, id: 'x' + id },
            })).rejects.toThrow(id);
        }
    });

    it('a signed registry descriptor with another id stays valid', () => {
        expect(validateChainDescriptor({ ...mainnetBase, id: 'bitcoin-mainnet-2' }).ok).toBe(true);
    });
});

describe('validateChainDescriptor: identifier and display fields', () => {
    const custom = {
        ...regtestBase,
        id: 'forkcoin-regtest',
        coin: 'forkcoin',
        wifVersionByte: 0xef,
        derivationPaths: { p2pkh: "m/44'/9'/A'/C/I" },
        addressTypes: ['p2pkh'],
        defaultAddressType: 'p2pkh',
        icon: '',
    };
    const bad = (patch) => validateChainDescriptor({ ...custom, ...patch }).ok;

    it('accepts the baseline', () => {
        expect(bad({})).toBe(true);
    });

    it('rejects ids that are not lowercase slugs or exceed 64 characters', () => {
        for (const id of ['<script>-regtest', 'a b/../c', 'Fork-regtest', `${'a'.repeat(70)}-regtest`]) {
            expect(bad({ id }), id).toBe(false);
        }
    });

    it('rejects a 1 MB display name and a long ticker', () => {
        expect(bad({ displayName: 'x'.repeat(1e6) })).toBe(false);
        expect(bad({ nativeTicker: 'T'.repeat(40) })).toBe(false);
    });

    it('rejects a color that is not a hex value', () => {
        expect(bad({ color: 'red;background:url(http://evil.example/x)' })).toBe(false);
    });

    it('rejects an icon path with separators or traversal', () => {
        expect(bad({ icon: '../../etc/passwd' })).toBe(false);
        expect(bad({ icon: 'a/b.png' })).toBe(false);
        expect(bad({ icon: 'fork-icon.png' })).toBe(true);
    });

    it('rejects web, script and file URI schemes', () => {
        for (const uriScheme of ['javascript', 'data', 'file', 'https', 'Bitcoin ']) {
            expect(bad({ uriScheme }), uriScheme).toBe(false);
        }
        expect(bad({ uriScheme: 'forkcoin' })).toBe(true);
    });
});
