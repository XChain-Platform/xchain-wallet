// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';

const chainRegistry = { chainIdFor: (coin, networkKind) => `${coin}-${networkKind}` };
const canonicalLink = (uri) =>
    `https://xchain.io/wallet/link/?uri=${encodeURIComponent(uri)}`;
const walletLink = (uri, origin = 'https://wallet.xchain.io', path = '/link/') =>
    `${origin}${path}?uri=${encodeURIComponent(uri)}`;

describe('wallet-host web-link envelope', () => {
    it.each([
        ['send', 'xchain:TBTC/send?address=tb1qexampleaddress&amount=1.25&memo=rent'],
        ['receive', 'xchain:TBTC/receive'],
        ['execute', 'xchain:TBTC/execute?contract=42&method=transfer'],
    ])('parses a %s link exactly as the canonical host does', (kind, inner) => {
        const canonical = parseXchainUri(canonicalLink(inner), { chainRegistry });
        const viaWalletHost = parseXchainUri(walletLink(inner), { chainRegistry });

        expect(viaWalletHost).toEqual(canonical);
        expect(viaWalletHost.kind).toBe(kind);
    });

    it.each([
        ['lookalike subdomain', walletLink('xchain:TBTC/receive', 'https://wallet.xchain.io.evil.com')],
        ['userinfo host', walletLink('xchain:TBTC/receive', 'https://wallet.xchain.io@evil.com')],
        ['http downgrade', walletLink('xchain:TBTC/receive', 'http://wallet.xchain.io')],
        ['path outside prefix', walletLink('xchain:TBTC/receive', 'https://wallet.xchain.io', '/linkage/')],
        ['https payload', walletLink('https://xchain.io/wallet/link/?uri=xchain%3ATBTC%2Freceive')],
    ])('refuses a %s', (_case, url) => {
        expect(parseXchainUri(url, { chainRegistry })).toEqual({ kind: 'unknown' });
    });
});
