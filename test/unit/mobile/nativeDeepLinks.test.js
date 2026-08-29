// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native deep-link intake (S3).
//
// Two things are being protected here. The first is the acceptance boundary:
// a URL that is not one we claim must never reach the parser, and the
// lookalike hosts below are the ones a `startsWith` check waves through. The
// second is the cold-start path: a tap that LAUNCHES the app delivers its
// intent long before any JS listener exists, so an event-only design drops
// precisely the link the user cared about most.

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    isAcceptableDeepLink,
    subscribeToNativeDeepLinks,
    __setLinksPluginForTests,
} from '../../../packages/web/src/deeplinks/nativeDeepLinks.js';

function fakeLinks({ pending = null, overrides = {} } = {}) {
    const listeners = new Map();
    return {
        listeners,
        takePendingLink: vi.fn(async () => {
            const url = pending;
            pending = null;
            return { url };
        }),
        addListener: vi.fn(async (event, cb) => {
            listeners.set(event, cb);
            return { remove: vi.fn(async () => listeners.delete(event)) };
        }),
        emit(url) {
            listeners.get('xchainUrlOpen')?.({ url });
        },
        ...overrides,
    };
}

afterEach(() => __setLinksPluginForTests(undefined));

// The canonical web link, spelled the way both manifests claim it:
// `/wallet/link/`, carrying an `xchain:` URI in `uri`.
const CLAIMED_LINK = `https://xchain.io/wallet/link/?uri=${encodeURIComponent('xchain:TBTC/receive')}`;

describe('isAcceptableDeepLink', () => {
    it('accepts the two shapes the manifest claims', () => {
        expect(isAcceptableDeepLink(CLAIMED_LINK)).toBe(true);
        // The claim is a wildcard, so deeper paths under it travel too.
        expect(isAcceptableDeepLink('https://xchain.io/wallet/link/v1/invoice/9')).toBe(true);
        expect(isAcceptableDeepLink('xchain:BTC/send?address=abc')).toBe(true);
        expect(isAcceptableDeepLink('XCHAIN:BTC/send')).toBe(true);
    });

    it('rejects the lookalikes a prefix check would accept', () => {
        for (const url of [
            'https://xchain.io.evil.com/wallet/send',
            'https://xchain.io@evil.com/wallet/send',
            'https://evil.com/https://xchain.io/wallet/send',
            'https://xchain.io.evil.com/wallet',
            'https://sub.xchain.io/wallet/send',
        ]) {
            expect(isAcceptableDeepLink(url), url).toBe(false);
        }
    });

    it('rejects other schemes, including the downgrade', () => {
        for (const url of [
            'http://xchain.io/wallet/send',
            'javascript:alert(1)',
            'file:///etc/passwd',
            'data:text/html,<script>',
            'bitcoin:bc1qexample',
        ]) {
            expect(isAcceptableDeepLink(url), url).toBe(false);
        }
    });

    it('rejects https paths outside the claimed prefix', () => {
        expect(isAcceptableDeepLink('https://xchain.io/')).toBe(false);
        expect(isAcceptableDeepLink('https://xchain.io/docs/send')).toBe(false);
        // The pages the pre-narrowing `/wallet` gate swallowed. Both store
        // listings publish them, and neither manifest claims them.
        expect(isAcceptableDeepLink('https://xchain.io/wallet/privacy/')).toBe(false);
        expect(isAcceptableDeepLink('https://xchain.io/wallet/support/')).toBe(false);
        expect(isAcceptableDeepLink('https://xchain.io/wallet/send?to=abc')).toBe(false);
        // The adjacent-name trap a `/wallet/link` prefix would swallow.
        expect(isAcceptableDeepLink('https://xchain.io/wallet/linkage/x')).toBe(false);
    });

    it('rejects non-strings, empties, and absurd lengths', () => {
        for (const bad of [undefined, null, 42, {}, '', `xchain:${'a'.repeat(5000)}`]) {
            expect(isAcceptableDeepLink(bad)).toBe(false);
        }
    });
});

describe('subscribeToNativeDeepLinks', () => {
    it('does nothing in a browser and still returns an unsubscribe', () => {
        __setLinksPluginForTests(null);
        const onLink = vi.fn();
        const off = subscribeToNativeDeepLinks(onLink);
        expect(typeof off).toBe('function');
        off();
        expect(onLink).not.toHaveBeenCalled();
    });

    it('collects the link that launched the app', async () => {
        // The cold-start case: the intent was delivered before this JS
        // existed, so it can only come from the native queue.
        const plugin = fakeLinks({ pending: CLAIMED_LINK });
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        subscribeToNativeDeepLinks(onLink);
        await vi.waitFor(() => expect(onLink).toHaveBeenCalledWith(CLAIMED_LINK));
    });

    it('delivers taps that arrive while the app is running', async () => {
        const plugin = fakeLinks();
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        subscribeToNativeDeepLinks(onLink);
        await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
        plugin.emit('xchain:BTC/send?address=abc');
        expect(onLink).toHaveBeenCalledWith('xchain:BTC/send?address=abc');
    });

    it('filters a hostile URL even when the native side forwards one', async () => {
        // Native validates too. This is the half that still runs if the
        // plugin is ever replaced or an event is spoofed from inside the
        // WebView.
        const plugin = fakeLinks();
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        subscribeToNativeDeepLinks(onLink);
        await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
        plugin.emit('https://xchain.io.evil.com/wallet/send');
        plugin.emit('javascript:alert(1)');
        plugin.emit(undefined);
        expect(onLink).not.toHaveBeenCalled();
    });

    it('stops delivering after unsubscribe', async () => {
        const plugin = fakeLinks();
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        const off = subscribeToNativeDeepLinks(onLink);
        await vi.waitFor(() => expect(plugin.addListener).toHaveBeenCalled());
        off();
        plugin.emit('xchain:BTC/send');
        expect(onLink).not.toHaveBeenCalled();
    });

    it('survives a shell build whose plugin has no listener API', async () => {
        const plugin = fakeLinks({ pending: 'xchain:BTC/send' });
        delete plugin.addListener;
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        expect(() => subscribeToNativeDeepLinks(onLink)).not.toThrow();
        await vi.waitFor(() => expect(onLink).toHaveBeenCalled());
    });

    it('does not blow up when the pending fetch rejects', async () => {
        const plugin = fakeLinks({
            overrides: { takePendingLink: vi.fn(async () => { throw new Error('older shell'); }) },
        });
        __setLinksPluginForTests(plugin);
        const onLink = vi.fn();
        expect(() => subscribeToNativeDeepLinks(onLink)).not.toThrow();
        await Promise.resolve();
        expect(onLink).not.toHaveBeenCalled();
    });
});
