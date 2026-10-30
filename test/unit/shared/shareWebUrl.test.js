// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Chrome on Android rejects navigator.share({ url: 'bitcoin:...' }) with
// "Invalid URL", so the share sheet never opens for a payment link. The
// link has to travel in the text.

import { describe, expect, it, vi } from 'vitest';
import { ShareOutcome, shareContent, shareOrCopy, toWebShareData } from '../../../packages/core/src/shared/share.js';

const LINK = 'bitcoin:bc1qexample?amount=1.2&label=BTC%20Address%20%231';

function envWithShare(share) {
    return { navigator: { share }, document: undefined };
}

describe('toWebShareData', () => {
    it('moves a non-http link into the text', () => {
        expect(toWebShareData({ title: 'T', text: 'Pay me', url: LINK }))
            .toEqual({ title: 'T', text: `Pay me\n${LINK}` });
    });

    it('uses the link alone when there is no text', () => {
        expect(toWebShareData({ url: LINK })).toEqual({ text: LINK });
    });

    it('keeps an https link as the url', () => {
        const data = { text: 'Look', url: 'https://example.com/x' };
        expect(toWebShareData(data)).toBe(data);
    });

    it('keeps files and drops nothing else', () => {
        const files = [{ name: 'qr.png' }];
        expect(toWebShareData({ text: 'a', url: LINK, files }))
            .toEqual({ text: `a\n${LINK}`, files });
    });
});

describe('web share of a payment link', () => {
    it('shareContent hands the browser no non-http url', async () => {
        const share = vi.fn(async (d) => {
            if (d.url) throw new TypeError('Invalid URL');
        });
        const outcome = await shareContent(
            { title: 'T', text: 'Pay me', url: LINK },
            { env: envWithShare(share), fallbackText: LINK },
        );
        expect(outcome).toBe(ShareOutcome.SHARED);
        expect(share).toHaveBeenCalledWith({ title: 'T', text: `Pay me\n${LINK}` });
    });

    it('shareOrCopy hands the browser no non-http url', async () => {
        const share = vi.fn(async (d) => {
            if (d.url) throw new TypeError('Invalid URL');
        });
        const outcome = await shareOrCopy({ text: 'Pay me', url: LINK }, LINK, { env: envWithShare(share) });
        expect(outcome).toBe(ShareOutcome.SHARED);
        expect(share).toHaveBeenCalledWith({ text: `Pay me\n${LINK}` });
    });
});
