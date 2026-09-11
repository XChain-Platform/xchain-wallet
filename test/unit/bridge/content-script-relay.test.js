// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The content-script relay is the page's ONLY route to the background, and
// the injected provider's send() parks a promise per request with no
// deadline. So every path through the relay has to emit exactly one
// response envelope; a path that emits none hangs window.xchain forever and
// leaks the pending entry. The path pinned here is the
// SYNCHRONOUS throw: after an extension update/reload/disable,
// chrome.runtime.sendMessage throws "Extension context invalidated." out of
// the call itself, so the callback (and its chrome.runtime.lastError
// branch) never runs.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// Swapped per case; the relay is installed once, at import.
let sendMessageImpl = () => {};

const responses = [];

function collect(event) {
    if (event.data && event.data.source === 'xchain-inject-response') {
        responses.push(event.data);
    }
}

// The relay's own reply goes out through window.postMessage, which lands on
// a later task, so give the loop a turn before reading the responses.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// Dispatched rather than posted: jsdom's window.postMessage leaves
// `event.source` null, and the relay's first guard is `event.source !==
// window`, so a posted message is dropped before any of this is exercised.
// A real page-world postMessage arrives with source === window, which is
// what this builds.
async function relay(message) {
    responses.length = 0;
    window.dispatchEvent(new MessageEvent('message', {
        data: message,
        source: window,
        origin: window.location.origin,
    }));
    await settle();
    await settle();
    return responses;
}

beforeAll(async () => {
    globalThis.chrome = {
        runtime: {
            id: 'testext',
            getURL: (p) => `chrome-extension://testext/${p}`,
            sendMessage: (...args) => sendMessageImpl(...args),
            onMessage: { addListener: () => {} },
        },
    };
    window.addEventListener('message', collect);
    await import('../../../packages/extension/src/content/contentScript.js');
});

afterEach(() => {
    sendMessageImpl = () => {};
});

describe('content-script relay always answers the page', () => {
    it('answers when the background answers', async () => {
        sendMessageImpl = (_msg, cb) => { cb({ ok: true, result: ['bitcoin-mainnet'] }); };
        const [reply] = await relay({
            source: 'xchain-inject',
            id: 'req-ok',
            type: 'bridge.getSupportedChains',
            request: {},
        });
        expect(reply).toBeDefined();
        expect(reply.id).toBe('req-ok');
        expect(reply.ok).toBe(true);
        expect(reply.result).toEqual(['bitcoin-mainnet']);
    });

    it('answers when sendMessage throws synchronously on an invalidated context', async () => {
        sendMessageImpl = () => {
            throw new Error('Extension context invalidated.');
        };
        const [reply] = await relay({
            source: 'xchain-inject',
            id: 'req-throw',
            type: 'bridge.getSupportedChains',
            request: {},
        });
        expect(reply, 'the page must get an envelope, not silence').toBeDefined();
        expect(reply.id).toBe('req-throw');
        expect(reply.ok).toBe(false);
        expect(reply.error.code).toBe('INTERNAL_ERROR');
        expect(reply.error.message).toMatch(/RUNTIME_UNAVAILABLE/);
    });

    it('answers a privileged type with the FORBIDDEN refusal, never a relay', async () => {
        let relayed = false;
        sendMessageImpl = () => { relayed = true; };
        const [reply] = await relay({
            source: 'xchain-inject',
            id: 'req-forbidden',
            type: 'wallet.unlock',
            request: {},
        });
        expect(relayed).toBe(false);
        expect(reply.ok).toBe(false);
        expect(reply.error.code).toBe('INVALID_PARAMS');
    });
});
