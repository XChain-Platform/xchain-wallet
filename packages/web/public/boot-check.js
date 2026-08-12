// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PRE-BUNDLE capability floor (§3).
//
// WHY THIS FILE EXISTS, since it duplicates part of
// src/platform/webviewFloor.js and that duplication is deliberate:
//
// The floor in webviewFloor.js runs from main.jsx, which ships inside the
// single `<script type="module">` bundle. An engine too old to PARSE that
// bundle never runs a line of it - and an engine too old to understand
// `type="module"` at all does not even fetch it. Chrome <61 ignores module
// scripts silently: no error, no console entry, nothing. So the floor that
// exists to refuse old engines was unreachable on exactly the old engines it
// was written for, and what those users got instead was a WHITE SCREEN where
// their wallet used to be. Measured on an API 26 emulator, 2026-08-01
// (Android 8 stock WebView, Chromium 58): module support absent, BigInt
// absent, `#xchain-web-root` empty, zero console output.
//
// This file is a CLASSIC script in ES5 syntax, so every engine that can parse
// anything at all can parse it, and it is loaded from `<head>` ahead of the
// bundle. It is the only code in the app that is allowed to assume nothing.
//
// It is EXTERNAL rather than inline because the shipped CSP is
// `script-src 'self'` with no `unsafe-inline` and no nonce: an inline
// bootstrap would be blocked by our own policy, which is the same silent
// blank screen with a different cause.
//
// RULES FOR EDITING THIS FILE
//   1. ES5 only. No arrow functions, no `const`/`let`, no template literals,
//      no classes, no shorthand properties, no spread. Pinned by
//      test/unit/web/bootCheck.test.js, which walks the AST and fails on any
//      post-ES5 node type. A modern-syntax "tidy-up" here would make this
//      file unparseable by the engines it exists to catch, and it would fail
//      the same silent way it is meant to prevent.
//   2. No imports, no bundler features. It is copied verbatim from public/.
//   3. Keep the message in step with `floorFailureMessage()` in
//      src/platform/webviewFloor.js. The two cannot share code across the
//      module boundary; the test asserts they agree on substance.

(function () {
    'use strict';

    var missing = [];

    // Can this engine run the bundle AT ALL? Two independent ways it cannot:
    //
    //   (a) `type="module"` unsupported (Chrome <61): the script is ignored.
    //   (b) module scripts supported, but the bundle's syntax is newer than
    //       the parser (vite `build.target: 'es2022'`): the module throws a
    //       SyntaxError before its first statement, so nothing inside it -
    //       including the other floor - can report it.
    //
    // (b) has no direct syntax probe available: `eval` would be the usual
    // trick and the CSP forbids it, correctly. So we use two ES2022 LIBRARY
    // methods as proxies for an ES2022-era parser. Every engine that shipped
    // the syntax shipped these in the same release train (V8 93, JSC 15.4,
    // SpiderMonkey 92). If `build.target` is ever lowered, these come down
    // with it; the test pins the two together so the change cannot be made
    // in one place only.
    if (!('noModule' in document.createElement('script'))) {
        missing.push('JavaScript modules');
    } else if (typeof Object.hasOwn !== 'function' || typeof Array.prototype.at !== 'function') {
        missing.push('modern JavaScript (ES2022)');
    }

    // The primitives the wallet cannot fake, in the same order and with the
    // same names webviewFloor.js reports them.
    var subtle = window.crypto ? window.crypto.subtle : null;
    if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.encrypt !== 'function') {
        missing.push('crypto.subtle');
    }
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
        missing.push('crypto.getRandomValues');
    }
    if (!window.indexedDB || typeof window.indexedDB.open !== 'function') {
        missing.push('indexedDB');
    }
    if (typeof window.TextEncoder !== 'function' || typeof window.TextDecoder !== 'function') {
        missing.push('TextEncoder/TextDecoder');
    }
    if (typeof window.BigInt !== 'function') {
        missing.push('BigInt');
    }

    // Nothing missing: leave the page exactly as it was and let the bundle
    // boot. The in-bundle floor still runs and still owns the soft
    // out-of-date advice, which needs no help from here.
    if (missing.length === 0) return;

    // Recorded before the panel is drawn, so main.jsx can see it even in the
    // mixed case where modules DO work but a primitive is absent: without
    // this the two floors would both render and the second would wipe the
    // first mid-paint.
    window.__xchainBootFloor = { blocked: true, missing: missing };

    function message() {
        return 'XChain Wallet cannot run safely on this device.'
            + ' The browser engine here is missing: ' + missing.join(', ') + '.'
            + ' These are the parts that encrypt your wallet and generate your keys.'
            + ' Updating Android System WebView (or your system browser) usually fixes it.'
            + ' Your recovery phrase is unaffected: it can be imported on any device'
            + ' that does support them.';
    }

    // Plain DOM and inline styles on purpose: the stylesheet may not have
    // arrived, and this screen must render on an engine we have just decided
    // is not fit to run the app.
    function render() {
        var container = document.getElementById('xchain-web-root') || document.body;
        if (!container) return;
        container.textContent = '';

        var panel = document.createElement('div');
        panel.setAttribute('role', 'alert');
        panel.style.cssText = 'max-width:42rem;margin:3rem auto;padding:1.5rem;'
            + 'font:16px/1.6 system-ui,sans-serif';

        var title = document.createElement('h1');
        title.textContent = 'This device cannot run XChain Wallet safely';
        title.style.cssText = 'font-size:1.25rem;margin:0 0 1rem';

        var body = document.createElement('p');
        body.textContent = message();

        panel.appendChild(title);
        panel.appendChild(body);
        container.appendChild(panel);
    }

    // This script runs from <head>, so the root element does not exist yet.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
