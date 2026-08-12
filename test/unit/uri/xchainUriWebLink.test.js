// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the web-link envelope (§3).
//
// THE DEFECT THIS FILE EXISTS FOR was invisible at every layer taken on its
// own. iOS Universal Links and Android App Links both deliver the ORIGINAL
// https URL the user tapped, not an `xchain:` URI, and this parser understood
// only the scheme forms - so a tapped link travelled correctly through the
// association file, the entitlement, the scene delegate, the native plugin and
// the SPA's own intake, reached the parser, and came back `{ kind: 'unknown' }`.
// The app surfaced on its default view with the payload discarded and nothing
// logged. Both mobile shells, identically.
//
// So these cases are about the ENVELOPE and about what it refuses to carry.
// The refusals matter as much as the happy path: a wallet's link handler is
// reachable by anyone who can get a URL in front of a user, and `uri` is a
// parameter an attacker writes.

import { describe, it, expect } from 'vitest';
import { parseXchainUri } from '../../../packages/core/src/uri/xchainUri.js';

const chainRegistry = { chainIdFor: (coin, networkKind) => `${coin}-${networkKind}` };

/** The canonical link an explorer, a poster or a store listing would publish. */
const webLink = (uri, path = '/wallet/link/') =>
    `https://xchain.io${path}?uri=${encodeURIComponent(uri)}`;

describe('web-link envelope', () => {
    it('carries a send intent through to the same result the bare URI gives', () => {
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress&amount=1.25&memo=rent';
        const direct = parseXchainUri(inner, { chainRegistry });
        const viaLink = parseXchainUri(webLink(inner), { chainRegistry });

        // Deep-equal rather than spot-checking `kind`: the whole point of an
        // envelope is that nothing downstream can tell the difference, and a
        // field silently lost in transit would be the next silent failure.
        expect(viaLink).toEqual(direct);
        expect(viaLink.kind).toBe('send');
        expect(viaLink.amount).toBe('1.25');
    });

    it('carries receive and execute intents too, not just send', () => {
        expect(parseXchainUri(webLink('xchain:TBTC/receive'), { chainRegistry }).kind).toBe('receive');
        const execute = parseXchainUri(
            webLink('xchain:TBTC/execute?contract=42&method=transfer'), { chainRegistry },
        );
        expect(execute.kind).toBe('execute');
        expect(execute.contractActionIndex).toBe('42');
    });

    it('accepts any path under the claimed prefix, because the association claims a wildcard', () => {
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress';
        // `/wallet/link/*` is what apple-app-site-association claims and what
        // the AASA test pins, so a campaign URL with its own path segments has
        // to work. Pinning the parser to one exact path would make a link the
        // OS routes to us a link we then drop.
        expect(parseXchainUri(webLink(inner, '/wallet/link/v1/invoice/9'), { chainRegistry }).kind).toBe('send');
    });

    it('refuses a link outside the claimed prefix', () => {
        // Android's manifest claims the whole of `/wallet`, so the privacy page
        // and the support page reach this parser on that shell. Neither is a
        // link intent and neither may prefill anything.
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress';
        expect(parseXchainUri(webLink(inner, '/wallet/privacy/'), { chainRegistry }).kind).toBe('unknown');
        expect(parseXchainUri(webLink(inner, '/wallet/support/'), { chainRegistry }).kind).toBe('unknown');
    });

    it('refuses hosts that only look like ours', () => {
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress';
        for (const host of ['xchain.io.evil.com', 'xchain.io@evil.com', 'notxchain.io', 'evil.com']) {
            const url = `https://${host}/wallet/link/?uri=${encodeURIComponent(inner)}`;
            expect(parseXchainUri(url, { chainRegistry }).kind, host).toBe('unknown');
        }
    });

    it('refuses http, so a downgrade cannot carry an intent', () => {
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress';
        expect(
            parseXchainUri(`http://xchain.io/wallet/link/?uri=${encodeURIComponent(inner)}`, { chainRegistry }).kind,
        ).toBe('unknown');
    });

    it('refuses a payload that is not an xchain: URI', () => {
        // `uri` is attacker-written. The envelope carries exactly one scheme;
        // anything else is refused here rather than being handed on to a
        // downstream reader that might treat it as a URL.
        for (const payload of [
            'javascript:alert(1)',
            'file:///etc/passwd',
            'https://evil.com/',
            'data:text/html,<script>',
            'bitcoin:bc1qexample',
            '',
        ]) {
            expect(parseXchainUri(webLink(payload), { chainRegistry }).kind, payload).toBe('unknown');
        }
    });

    it('refuses an envelope inside an envelope, so unwrapping cannot recurse', () => {
        const inner = 'xchain:TBTC/send?address=tb1qexampleaddress';
        expect(parseXchainUri(webLink(webLink(inner)), { chainRegistry }).kind).toBe('unknown');
    });

    it('refuses a link with no payload at all', () => {
        expect(parseXchainUri('https://xchain.io/wallet/link/', { chainRegistry }).kind).toBe('unknown');
        expect(parseXchainUri('https://xchain.io/wallet/link/?uri=', { chainRegistry }).kind).toBe('unknown');
        expect(parseXchainUri('https://xchain.io/wallet/link/?other=1', { chainRegistry }).kind).toBe('unknown');
    });

    it('still hardens what it carries, because the envelope is not a trust boundary', async () => {
        const { hardenUriIntentText } = await import('../../../packages/core/src/uri/xchainUri.js');
        const { BIDI_PLACEHOLDER } = await import(
            '../../../packages/core/src/shared/utils/textHardening.js'
        );
        const RLO = String.fromCharCode(0x202E);
        const intent = hardenUriIntentText(
            parseXchainUri(webLink(`xchain:TBTC/send?address=tb1qexampleaddress&memo=a${RLO}b`), { chainRegistry }),
        );
        expect(intent.memo).toContain(BIDI_PLACEHOLDER);
        expect(intent.memo).not.toContain(RLO);
    });
});
