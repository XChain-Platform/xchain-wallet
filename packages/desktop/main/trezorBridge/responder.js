// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Trezor Connect bridge responder. A classic script in connect.html,
// never bundled or imported: it runs in the bridge window's page world next
// to the hosted window.TrezorConnect. It takes each request the bridge
// preload hands it, calls that Connect method, and replies with the result
// or the failure text. The preload has already checked the method name, and
// main checks every reply again before the app renderer sees it.

(function bridgeResponder() {
    'use strict';
    var bridge = window.xchainTrezorConnectBridge;
    if (!bridge) return;

    function failureText(err) {
        var text = String((err && err.message) || err || '');
        return text || 'Trezor Connect call failed';
    }

    bridge.onRequest(function onRequest(request) {
        Promise.resolve().then(function callConnect() {
            if (!window.TrezorConnect) throw new Error('TrezorConnect not loaded');
            return window.TrezorConnect[request.method](request.args);
        }).then(function answer(result) {
            bridge.reply({ id: request.id, ok: true, result: result });
        }, function refuse(err) {
            bridge.reply({ id: request.id, ok: false, error: failureText(err) });
        }).catch(function unsendable(err) {
            // A result the IPC clone refuses still settles the call.
            bridge.reply({ id: request.id, ok: false, error: failureText(err) });
        });
    });
    bridge.ready();
}());
