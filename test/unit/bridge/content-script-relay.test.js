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
import providerSource from '../../../packages/extension/src/inject/xchainProvider.js?raw';

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
async function relay(message, origin = window.location.origin, source = window) {
    responses.length = 0;
    window.dispatchEvent(new MessageEvent('message', {
        data: message,
        source,
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
    document.querySelector('script[src="chrome-extension://testext/inject/xchainProvider.js"]')
        ?.dispatchEvent(new Event('load'));
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
        expect(reply.error.message).toBe('The wallet was updated or reloaded. Reload this page and try again.');
    });

    it('answers a worker restart mid-request in plain words, never Chrome\'s channel text', async () => {
        sendMessageImpl = (_msg, cb) => {
            globalThis.chrome.runtime.lastError = {
                message: 'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
            };
            try { cb(undefined); } finally { delete globalThis.chrome.runtime.lastError; }
        };
        const [reply] = await relay({
            source: 'xchain-inject',
            id: 'req-restart',
            type: 'bridge.signMessage',
            request: {},
        });
        expect(reply.id).toBe('req-restart');
        expect(reply.ok).toBe(false);
        expect(reply.error.code).toBe('INTERNAL_ERROR');
        expect(reply.error.message).toBe('The wallet restarted before it answered. Try the request again.');
        expect(reply.error.message).not.toMatch(/channel|listener|port|RUNTIME_/i);
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

    it('drops a request whose MessageEvent source is not the current window', async () => {
        const sendMessage = vi.fn();
        sendMessageImpl = sendMessage;
        const replies = await relay({
            source: 'xchain-inject',
            id: 'req-wrong-source',
            type: 'bridge.getAccounts',
            request: {},
        }, window.location.origin, null);
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

    it.each([
        { result: 'missing ok' },
        { ok: true },
    ])('turns malformed background reply %# into one internal-error envelope', async (response) => {
        sendMessageImpl = (_message, callback) => { callback(response); };
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
    it('answers the side-panel availability probe without relaying it', () => {
        const sendResponse = vi.fn();
        runtimeMessageListener({ type: 'xchain.contentProbe' }, {}, sendResponse);
        expect(sendResponse).toHaveBeenCalledWith({ available: true });
        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('reports an unavailable provider when script injection is refused', () => {
        const runtimeListeners = [];
        const pageWindow = {
            location: {
                protocol: 'https:',
                origin: 'https://dapp.example',
                hostname: 'dapp.example',
                pathname: '/',
            },
            addEventListener: vi.fn(),
        };
        pageWindow.top = pageWindow;
        const script = {
            addEventListener: vi.fn(),
            remove: vi.fn(),
        };
        const pageDocument = {
            contentType: 'text/html',
            createElement: vi.fn(() => script),
            documentElement: {
                appendChild: vi.fn(() => { throw new Error('injection refused'); }),
            },
        };
        const pageChrome = {
            runtime: {
                getURL: vi.fn(() => 'chrome-extension://testext/inject/xchainProvider.js'),
                onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
            },
        };
        new Function('window', 'document', 'chrome', contentScriptSource)(
            pageWindow,
            pageDocument,
            pageChrome,
        );
        const respond = vi.fn();
        runtimeListeners[0]({ type: 'xchain.contentProbe' }, {}, respond);
        expect(respond).toHaveBeenCalledWith({ available: false });
        expect(pageWindow.addEventListener).toHaveBeenCalledOnce();
    });

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

    it.each([
        ['file URL', { protocol: 'file:', origin: 'null', hostname: '', pathname: '/wallet.html' }, 'text/html'],
        ['browser page', { protocol: 'chrome:', origin: 'null', hostname: 'settings', pathname: '/' }, 'text/html'],
        ['Chrome Web Store', { protocol: 'https:', origin: 'https://chromewebstore.google.com', hostname: 'chromewebstore.google.com', pathname: '/detail/wallet' }, 'text/html'],
        ['legacy Web Store', { protocol: 'https:', origin: 'https://chrome.google.com', hostname: 'chrome.google.com', pathname: '/webstore/detail/wallet' }, 'text/html'],
        ['PDF viewer', { protocol: 'https:', origin: 'https://docs.example', hostname: 'docs.example', pathname: '/manual.pdf' }, 'application/pdf'],
    ])('keeps the relay and provider inert on a %s', (_name, location, contentType) => {
        const makeWindow = () => {
            const target = {
                location,
                document: { contentType },
                addEventListener: vi.fn(),
            };
            target.top = target;
            return target;
        };
        const relayWindow = makeWindow();
        const relayDocument = {
            contentType,
            createElement: vi.fn(),
            documentElement: { appendChild: vi.fn() },
        };
        const frameChrome = {
            runtime: {
                getURL: vi.fn(),
                onMessage: { addListener: vi.fn() },
            },
        };
        new Function('window', 'document', 'chrome', contentScriptSource)(
            relayWindow,
            relayDocument,
            frameChrome,
        );
        expect(relayDocument.createElement).not.toHaveBeenCalled();
        expect(relayWindow.addEventListener).not.toHaveBeenCalled();

        const providerWindow = makeWindow();
        new Function('window', providerSource)(providerWindow);
        expect(providerWindow.xchain).toBeUndefined();
        expect(providerWindow.addEventListener).not.toHaveBeenCalled();
    });
});
