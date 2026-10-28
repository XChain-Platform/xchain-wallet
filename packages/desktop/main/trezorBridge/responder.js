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
// or the failure text. With Connect's popup disabled, response-bearing UI
// events arrive here too. The wallet has no matching UI yet, so those events
// cancel and refuse the active request without inventing a response. The
// preload has already checked the method name, and main checks every reply
// again before the app renderer sees it.

(function bridgeResponder() {
    'use strict';
    var bridge = window.xchainTrezorConnectBridge;
    if (!bridge) return;

    var pending = new Map();
    var uiRequestsWithoutWalletUi = {
        'ui-request_permission': 'permission approval',
        'ui-request_confirmation': 'confirmation',
        'ui-request_pin': 'PIN entry',
        'ui-request_passphrase': 'passphrase entry',
        'ui-request_thp_pairing': 'Trezor pairing',
        'ui-select_device': 'device selection',
        'ui-select_account': 'account selection',
        'ui-select_fee': 'fee selection',
        'ui-request_word': 'recovery word entry',
        'ui-login_challenge_request': 'login challenge input',
    };

    function failureText(err) {
        var text = String((err && err.message) || err || '');
        return text || 'Trezor Connect call failed';
    }

    function settle(id, message) {
        if (!pending.has(id)) return;
        pending.delete(id);
        bridge.reply(message);
    }

    function refuseUiRequest(event) {
        var description = event && Object.hasOwn(uiRequestsWithoutWalletUi, event.type)
            ? uiRequestsWithoutWalletUi[event.type]
            : null;
        if (!description) return;
        var error = 'desktop trezorFactory: Trezor Connect requested ' + description
            + ', but this wallet has no UI for it yet. The request was refused without supplying '
            + 'a PIN, passphrase, permission grant, or other response. Nothing was signed or broadcast.';
        var refused = false;
        pending.forEach(function refusePending(request, id) {
            if (request.method === 'init') return;
            refused = true;
            settle(id, { id: id, ok: false, error: error });
        });
        if (!refused || !window.TrezorConnect || typeof window.TrezorConnect.cancel !== 'function') return;
        try {
            window.TrezorConnect.cancel(error);
        } catch (_) {
            // The bridge refusal already settles the renderer request.
        }
    }

    if (window.TrezorConnect && typeof window.TrezorConnect.on === 'function') {
        window.TrezorConnect.on('UI_EVENT', refuseUiRequest);
    }

    bridge.onRequest(function onRequest(request) {
        pending.set(request.id, { method: request.method });
        Promise.resolve().then(function callConnect() {
            if (!window.TrezorConnect) throw new Error('TrezorConnect not loaded');
            return window.TrezorConnect[request.method](request.args);
        }).then(function answer(result) {
            settle(request.id, { id: request.id, ok: true, result: result });
        }, function refuse(err) {
            settle(request.id, { id: request.id, ok: false, error: failureText(err) });
        }).catch(function unsendable(err) {
            // A result the IPC clone refuses still settles the call.
            settle(request.id, { id: request.id, ok: false, error: failureText(err) });
        });
    });
    bridge.ready();
}());
