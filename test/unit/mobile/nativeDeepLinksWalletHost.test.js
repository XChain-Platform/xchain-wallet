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
import { isAcceptableDeepLink } from '../../../packages/web/src/deeplinks/nativeDeepLinks.js';

describe('wallet host native deep links', () => {
    it('accepts the claimed link path', () => {
        expect(isAcceptableDeepLink('https://wallet.xchain.io/link/?uri=xchain%3ABTC%2Fsend'))
            .toBe(true);
    });

    it('rejects lookalike hosts, downgraded transport, and unclaimed paths', () => {
        for (const url of [
            'https://wallet.xchain.io.evil.com/link/?uri=xchain%3ABTC%2Fsend',
            'https://wallet.xchain.io@evil.com/link/?uri=xchain%3ABTC%2Fsend',
            'http://wallet.xchain.io/link/?uri=xchain%3ABTC%2Fsend',
            'https://wallet.xchain.io/link',
            'https://wallet.xchain.io/linkage/',
            'https://wallet.xchain.io/privacy/',
        ]) {
            expect(isAcceptableDeepLink(url), url).toBe(false);
        }
    });
});
