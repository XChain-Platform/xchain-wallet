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

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import contentScriptSource from '../../../packages/extension/src/content/contentScript.js?raw';

// Swapped per case; the relay is installed once, at import.
let sendMessageImpl = () => {};

const responses = [];
let runtimeMessageListener = null;
let postMessageSpy = null;

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
async function relay(message, origin = window.location.origin) {
    responses.length = 0;
    window.dispatchEvent(new MessageEvent('message', {
        data: message,
        source: window,
        origin,
    }));
    await settle();
    await settle();
    return responses;
}

beforeAll(async () => {
    postMessageSpy = vi.spyOn(window, 'postMessage');
    globalThis.chrome = {
        runtime: {
            id: 'testext',
            getURL: (p) => `chrome-extension://testext/${p}`,
            sendMessage: (...args) => sendMessageImpl(...args),
            onMessage: { addListener: (listener) => { runtimeMessageListener = listener; } },
        },
    };
    window.addEventListener('message', collect);
    await import('../../../packages/extension/src/content/contentScript.js');
});

afterEach(() => {
    sendMessageImpl = () => {};
    postMessageSpy.mockClear();
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

    it('drops a request whose MessageEvent origin is not the document origin', async () => {
        const sendMessage = vi.fn();
        sendMessageImpl = sendMessage;
        const replies = await relay({
            source: 'xchain-inject',
            id: 'req-wrong-origin',
            type: 'bridge.getAccounts',
            request: {},
        }, 'https://attacker.example');
        expect(sendMessage).not.toHaveBeenCalled();
        expect(replies).toEqual([]);
    });

    it('refuses malformed requests and unknown bridge names without relaying them', async () => {
        const sendMessage = vi.fn();
        sendMessageImpl = sendMessage;
        const [badRequest] = await relay({
            source: 'xchain-inject',
            id: 'req-array',
            type: 'bridge.signMessage',
            request: [],
        });
        expect(badRequest.error.code).toBe('INVALID_PARAMS');

        const [unknownType] = await relay({
            source: 'xchain-inject',
            id: 'req-unknown',
            type: 'bridge.futurePrivilegedMethod',
            request: {},
        });
        expect(unknownType.error.code).toBe('INVALID_PARAMS');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('stamps the document origin after the page request fields', async () => {
        let relayed = null;
        sendMessageImpl = (message, callback) => {
            relayed = message;
            callback({ ok: true, result: [] });
        };
        await relay({
            source: 'xchain-inject',
            id: 'req-stamped',
            type: 'bridge.getAccounts',
            request: { origin: 'https://victim.example' },
        });
        expect(relayed.request.origin).toBe(window.location.origin);
    });

    it('turns malformed background replies into one internal-error envelope', async () => {
        sendMessageImpl = (_message, callback) => { callback({ result: 'missing ok' }); };
        const replies = await relay({
            source: 'xchain-inject',
            id: 'req-bad-reply',
            type: 'bridge.getAccounts',
            request: {},
        });
        expect(replies).toHaveLength(1);
        expect(replies[0].ok).toBe(false);
        expect(replies[0].error.code).toBe('INTERNAL_ERROR');
    });
});

describe('content-script event and frame policy', () => {
    it('forwards only known, correctly shaped events for this document origin', () => {
        runtimeMessageListener({
            type: 'bridge.event',
            origin: window.location.origin,
            event: 'accountsChanged',
            payload: [{ id: 'account-1', name: 'Primary' }],
        });
        expect(postMessageSpy).toHaveBeenCalledOnce();
        expect(postMessageSpy).toHaveBeenCalledWith({
            source: 'xchain-inject-event',
            event: 'accountsChanged',
            payload: [{ id: 'account-1', name: 'Primary' }],
        }, window.location.origin);

        postMessageSpy.mockClear();
        runtimeMessageListener({
            type: 'bridge.event',
            origin: 'https://attacker.example',
            event: 'accountsChanged',
            payload: [{ id: 'account-1', name: 'Primary' }],
        });
        runtimeMessageListener({
            type: 'bridge.event',
            origin: window.location.origin,
            event: 'accountsChanged',
            payload: [{ name: 'missing id' }],
        });
        runtimeMessageListener({
            type: 'bridge.event',
            origin: window.location.origin,
            event: 'internalState',
            payload: {},
        });
        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('does not inject or install listeners in a subframe', () => {
        const frameWindow = {
            top: {},
            addEventListener: vi.fn(),
        };
        const frameDocument = { createElement: vi.fn() };
        const frameChrome = {
            runtime: {
                getURL: vi.fn(),
                onMessage: { addListener: vi.fn() },
            },
        };
        const run = new Function('window', 'document', 'chrome', contentScriptSource);
        run(frameWindow, frameDocument, frameChrome);
        expect(frameDocument.createElement).not.toHaveBeenCalled();
        expect(frameWindow.addEventListener).not.toHaveBeenCalled();
        expect(frameChrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
    });
});
