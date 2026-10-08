// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The extension's signer-bridge port caps the TOTAL ids one port may hold, not
// only the ids in one message, matching the desktop listener on the same registry.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as listenerModule from '../../../packages/extension/src/background/signerBridgeListener.js';
import * as signerBridge from '../../../packages/extension/src/background/signerBridge.js';
import * as desktopListener from '../../../packages/desktop/main/signerBridgeListener.js';

const { attachSignerBridgeListener, MAX_SIGNER_IDS_PER_MESSAGE } = listenerModule;
const CAP = listenerModule.MAX_SIGNER_IDS_PER_SENDER;

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_SENDER_TAB = {
    origin: `chrome-extension://${EXT_ID}`,
    id: EXT_ID,
    tab: { id: 7 },
};

function fakeRuntime() {
    let listener = null;
    return {
        id: EXT_ID,
        onConnect: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        emit: (...args) => listener(...args),
    };
}

// Record every listener: createBackgroundTransport adds its own to the port.
function connect(runtime) {
    const messageListeners = [];
    const disconnectListeners = [];
    runtime.emit({
        name: 'signer-bridge',
        sender: EXT_SENDER_TAB,
        postMessage: () => {},
        disconnect: () => {},
        onMessage: { addListener: (fn) => messageListeners.push(fn), removeListener: () => {} },
        onDisconnect: { addListener: (fn) => disconnectListeners.push(fn), removeListener: () => {} },
    });
    return {
        register: (ids) => { for (const fn of messageListeners) fn({ kind: 'register', signerIds: ids }); },
        unregister: (ids) => { for (const fn of messageListeners) fn({ kind: 'unregister', signerIds: ids }); },
        disconnect: () => { for (const fn of disconnectListeners) fn(); },
    };
}

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function fillToCap(runtime) {
    const port = connect(runtime);
    port.register(ids('held', CAP));
    expect(signerBridge.registeredIds().length).toBe(CAP);
    return port;
}

describe('signer-bridge per-port total id cap', () => {
    let runtime;
    beforeEach(() => {
        signerBridge.clearAll();
        runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
    });
    afterEach(() => signerBridge.clearAll());

    it('declares a per-port cap equal to the per-message cap and to the desktop one', () => {
        expect(CAP).toBe(MAX_SIGNER_IDS_PER_MESSAGE);
        expect(CAP).toBe(desktopListener.MAX_SIGNER_IDS_PER_SENDER);
    });

    it('stops repeated valid batches at the cap', () => {
        const port = connect(runtime);
        for (let b = 0; b < 5; b++) port.register(ids(`batch${b}`, 16));
        expect(signerBridge.registeredIds().length).toBe(CAP);
        for (const id of ids('batch4', 16)) expect(signerBridge.getTransport(id)).toBeNull();
    });

    it('lets a full port re-register ids it already owns', () => {
        const port = fillToCap(runtime);
        port.register(ids('held', 8));
        expect(signerBridge.registeredIds().length).toBe(CAP);
    });

    it('drops a batch that would cross the cap whole', () => {
        const port = connect(runtime);
        port.register(ids('held', CAP - 2));
        port.register(ids('fresh', 3));
        for (const id of ids('fresh', 3)) expect(signerBridge.getTransport(id)).toBeNull();
    });

    it('frees capacity on unregister', () => {
        const port = fillToCap(runtime);
        port.unregister(['held-0', 'held-1']);
        port.register(['fresh-a', 'fresh-b']);
        expect(signerBridge.getTransport('fresh-a')).not.toBeNull();
        expect(signerBridge.getTransport('fresh-b')).not.toBeNull();
    });

    it('applies the cap per port and frees it on disconnect', () => {
        const first = fillToCap(runtime);
        const second = connect(runtime);
        second.register(['other-port']);
        expect(signerBridge.getTransport('other-port')).not.toBeNull();
        first.disconnect();
        expect(signerBridge.getTransport('held-0')).toBeNull();
    });
});
