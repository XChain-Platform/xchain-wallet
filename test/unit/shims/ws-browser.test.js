// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `ws` browser shim, DRIVEN rather than read.
//
// Every notification channel in every browser-based shell runs through this
// file: the SDK is CJS and does `require('ws')`, and the Vite configs for web
// and extension alias that specifier here. It has been covered until now only
// by `sdk-bundle.smoke.js`, which greps the SOURCE for method names - and the
// campaign's two failures in this lane were both things a grep cannot see:
//
//   - "WebSocket is not a constructor": the bundler hands a CJS consumer an
//     interop wrapper around this ESM namespace, not the class. Both export
//     shapes therefore have to be constructible on their own.
//   - : `getAugmentedNamespace()` copies namespace KEYS onto a
//     constructible function, and static class properties are not namespace
//     keys - so `WebSocket.OPEN` came out undefined, every
//     `readyState === WebSocket.OPEN` guard was permanently false, and the SDK
//     silently dropped every frame on a healthy socket. The SDK stopped
//     reading the constants off the module in 2.0.2, but the shim must still
//     carry them for anything that does.
//
// So: construct through both exports, drive each event across the
// EventEmitter translation, and check the readyState pass-through the guards
// depend on.

import { describe, it, expect, beforeEach } from 'vitest';

/** Minimal stand-in for the native browser WebSocket. */
class FakeNativeWs {
    constructor(url, protocols) {
        this.url = url;
        this.protocols = protocols;
        this.readyState = 0;
        this.protocol = '';
        this.bufferedAmount = 0;
        this.sent = [];
        this.closedWith = null;
        /** @type {Record<string, Array<(ev: any) => void>>} */
        this.listeners = {};
        FakeNativeWs.instances.push(this);
    }

    addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
    }

    /** Fire a native event at the shim. */
    fire(type, event) {
        for (const fn of this.listeners[type] || []) fn(event);
    }

    send(data) {
        if (this.readyState !== 1) throw new Error('InvalidStateError');
        this.sent.push(data);
    }

    close(code, reason) {
        this.closedWith = [code, reason];
        this.readyState = 3;
    }
}
FakeNativeWs.instances = [];

// The shim reads `globalThis.WebSocket` at MODULE LOAD and closes over it, so
// the fake has to be installed BEFORE the import or every construction goes to
// jsdom's real WebSocket and the whole file tests nothing. Swapping the global
// in a beforeEach is too late - which is worth stating, because that is
// exactly how this file failed first.
const NATIVE_OPEN = globalThis.WebSocket?.OPEN ?? 1;
globalThis.WebSocket = FakeNativeWs;
const { default: BrowserWsShimDefault, WebSocket: BrowserWsShimNamed } =
    await import('../../../packages/core/src/shims/ws-browser.js');

describe('shims/ws-browser', () => {
    beforeEach(() => {
        FakeNativeWs.instances = [];
    });

    it('both export shapes are the SAME constructible class', () => {
        // The two shapes exist because Node's `ws` sets both
        // `module.exports` and `module.exports.WebSocket`, and the SDK's
        // interop resolution tries them in order. If either stops being a
        // function, that resolution falls through to the module OBJECT and the
        // SDK's `new WebSocket(url)` throws "not a constructor" - the exact
        // failure this lane was opened for.
        expect(typeof BrowserWsShimDefault).toBe('function');
        expect(typeof BrowserWsShimNamed).toBe('function');
        expect(BrowserWsShimNamed).toBe(BrowserWsShimDefault);
    });

    it('carries the readyState constants as own static properties', () => {
        // 's other half. These are what a `readyState === WebSocket.OPEN`
        // guard compares against; when they were dropped the comparison was
        // false forever and frames vanished on an open socket.
        expect(BrowserWsShimDefault.CONNECTING).toBe(0);
        expect(BrowserWsShimDefault.OPEN).toBe(1);
        expect(BrowserWsShimDefault.CLOSING).toBe(2);
        expect(BrowserWsShimDefault.CLOSED).toBe(3);
        // And they must match the native ladder, or a guard written against
        // one and evaluated against the other silently inverts.
        expect(BrowserWsShimDefault.OPEN).toBe(NATIVE_OPEN);
    });

    it('translates native events into Node-ws `.on` callbacks', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        expect(native, 'the shim did not construct the global WebSocket it was given').toBeTruthy();

        const seen = [];
        ws.on('open', () => seen.push(['open']));
        ws.on('message', (data) => seen.push(['message', data]));
        ws.on('close', (code, reason) => seen.push(['close', code, reason]));
        ws.on('error', (err) => seen.push(['error', err?.kind]));

        native.fire('open', {});
        native.fire('message', { data: '{"id":1}' });
        native.fire('error', { kind: 'boom' });
        native.fire('close', { code: 1006, reason: 'gone' });

        expect(seen).toEqual([
            ['open'],
            ['message', '{"id":1}'],
            ['error', 'boom'],
            ['close', 1006, 'gone'],
        ]);
    });

    it('unwraps MessageEvent.data, because the SDK calls data.toString()', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        let got;
        ws.on('message', (data) => { got = data; });
        native.fire('message', { data: '{"result":"ok"}' });
        // Handing the MessageEvent through instead of its `.data` would give
        // the SDK "[object MessageEvent]" to JSON.parse.
        expect(got).toBe('{"result":"ok"}');
        expect(JSON.parse(String(got)).result).toBe('ok');
    });

    it('off() and once() behave, so a reconnect does not stack handlers', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        let sticky = 0;
        let onceCount = 0;
        const handler = () => { sticky += 1; };

        ws.on('open', handler);
        ws.once('open', () => { onceCount += 1; });
        native.fire('open', {});
        native.fire('open', {});
        expect(sticky).toBe(2);
        expect(onceCount, 'a once() handler fired more than once').toBe(1);

        ws.off('open', handler);
        native.fire('open', {});
        expect(sticky, 'off() did not detach the handler').toBe(2);
    });

    it('a throwing handler does not stop the others, matching Node ws', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        let reached = false;
        ws.on('message', () => { throw new Error('subscriber blew up'); });
        ws.on('message', () => { reached = true; });
        expect(() => native.fire('message', { data: 'x' })).not.toThrow();
        expect(reached, 'one bad subscriber silenced every later one').toBe(true);
    });

    it('passes readyState straight through from the native socket', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        native.readyState = 1;
        expect(ws.readyState).toBe(BrowserWsShimDefault.OPEN);
        native.readyState = 3;
        expect(ws.readyState).toBe(BrowserWsShimDefault.CLOSED);
    });

    it('send() reports failure through the callback instead of throwing', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);
        native.readyState = 1;

        let cbErr = 'unset';
        ws.send('{"op":"subscribe"}', (err) => { cbErr = err; });
        expect(native.sent).toEqual(['{"op":"subscribe"}']);
        expect(cbErr, 'a successful send passed an error to its callback').toBeUndefined();

        native.readyState = 0;   // the native socket now refuses
        let failed;
        ws.send('{"op":"subscribe"}', (err) => { failed = err; });
        expect(failed, 'a refused send did not reach the callback').toBeInstanceOf(Error);

        // With no callback the error propagates, so a caller that never passed
        // one still finds out.
        expect(() => ws.send('x')).toThrow();
    });

    it('close() and terminate() both reach the native socket', () => {
        const ws = new BrowserWsShimDefault('wss://example.test/ws');
        const native = FakeNativeWs.instances.at(-1);

        ws.close(1000, 'bye');
        expect(native.closedWith).toEqual([1000, 'bye']);

        const ws2 = new BrowserWsShimDefault('wss://example.test/ws');
        const native2 = FakeNativeWs.instances.at(-1);
        // Browsers have no abortive close; 1000 is the closest thing, and the
        // SDK's reconnect path calls terminate() on a stalled socket.
        ws2.terminate();
        expect(native2.closedWith[0]).toBe(1000);
    });
});
