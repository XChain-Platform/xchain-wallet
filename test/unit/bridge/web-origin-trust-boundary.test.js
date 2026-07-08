// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (BRIDGE-1): a web page must not be able to reach the
// extension's privileged (non-`bridge.*`) handler surface.
//
// The background MessageHost registers privileged UI handlers (wallet.*,
// action.*, settings.*, sites.*, ...) on the same chrome.runtime.onMessage
// surface as the public `bridge.*` dApp handlers. A content script relays
// arbitrary page messages to the background, so without a sender/type gate a
// hostile page could invoke e.g. `action.send` and drain the pre-unlocked
// signer pool with no password/approval. These tests pin the trust boundary:
//
//   - the pure helpers classify types and senders correctly;
//   - the host listener rejects privileged types from a web-origin sender but
//     lets `bridge.*` through and lets the extension UI call anything;
//   - the pre-host (session lifecycle) listener rejects web-origin senders;
//   - the signer-bridge port disconnects web-origin connections;
//   - the content script source only relays `bridge.*` types.

import { describe, it, expect } from 'vitest';
import {
    isPublicBridgeType,
    isTrustedExtensionSender,
    isMessageAllowedFromSender,
} from '../../../packages/extension/src/bridge/publicSurface.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';
import { attachSessionMetaListener } from '../../../packages/extension/src/background/sessionMeta.js';
import { attachSignerBridgeListener } from '../../../packages/extension/src/background/signerBridgeListener.js';
import contentScriptSource from '../../../packages/extension/src/content/contentScript.js?raw';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_SENDER = { origin: `chrome-extension://${EXT_ID}`, id: EXT_ID };
const EXT_SENDER_TAB = {
    // Full-screen extension UI: runs in a TAB but still has the ext origin.
    origin: `chrome-extension://${EXT_ID}`,
    id: EXT_ID,
    tab: { id: 7 },
};
const WEB_SENDER = {
    origin: 'https://evil.example',
    url: 'https://evil.example/',
    id: EXT_ID, // content scripts carry the extension id, so id is NOT a discriminator
    tab: { id: 42 },
};

function fakeRuntime() {
    let listener = null;
    return {
        id: EXT_ID,
        onMessage: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        onConnect: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        emit: (...args) => listener(...args),
    };
}

describe('publicSurface helpers', () => {
    it('classifies only bridge.* as public', () => {
        expect(isPublicBridgeType('bridge.connect')).toBe(true);
        expect(isPublicBridgeType('bridge.signAction')).toBe(true);
        expect(isPublicBridgeType('action.send')).toBe(false);
        expect(isPublicBridgeType('wallet.remove')).toBe(false);
        expect(isPublicBridgeType('settings.update')).toBe(false);
        expect(isPublicBridgeType('bridgeXaction')).toBe(false); // no dot
        expect(isPublicBridgeType(undefined)).toBe(false);
    });

    it('trusts only extension-origin senders', () => {
        expect(isTrustedExtensionSender(EXT_SENDER, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender(EXT_SENDER_TAB, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender(WEB_SENDER, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender({ url: `chrome-extension://${EXT_ID}/popup.html` }, EXT_ID)).toBe(true);
        expect(isTrustedExtensionSender({ origin: `chrome-extension://someotherid` }, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender(null, EXT_ID)).toBe(false);
        expect(isTrustedExtensionSender(EXT_SENDER, undefined)).toBe(false);
    });

    it('gate: web senders confined to bridge.*, ext UI unrestricted', () => {
        expect(isMessageAllowedFromSender('action.send', WEB_SENDER, EXT_ID)).toBe(false);
        expect(isMessageAllowedFromSender('bridge.connect', WEB_SENDER, EXT_ID)).toBe(true);
        expect(isMessageAllowedFromSender('action.send', EXT_SENDER, EXT_ID)).toBe(true);
    });
});

describe('ChromeRuntimeAdapter sender gate', () => {
    function setup() {
        const calls = [];
        const host = { handle: async (m) => { calls.push(m); return { ok: true, result: 'HANDLED' }; } };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime);
        return { calls, runtime };
    }

    it('rejects a privileged type from a web-origin sender without hitting the host', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        const ret = runtime.emit({ type: 'action.send', request: { walletId: 'w', to: 'attacker', amount: 1 } }, WEB_SENDER, (r) => responses.push(r));
        expect(ret).toBe(true); // async-response contract still honoured
        await Promise.resolve();
        expect(calls).toHaveLength(0); // host.handle never called
        expect(responses[0].ok).toBe(false);
        expect(responses[0].error.code).toBe('FORBIDDEN_SENDER');
    });

    it('allows bridge.* from a web-origin sender (bridge handlers self-enforce origin)', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe('bridge.getAccounts');
    });

    it('allows a privileged type from the extension UI (incl. full-screen tab)', async () => {
        const { calls, runtime } = setup();
        const responses = [];
        runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER_TAB, (r) => responses.push(r));
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
        expect(calls[0].type).toBe('action.send');
    });

    it('reports activity (auto-lock) only for trusted extension senders, not web pages', async () => {
        const host = { handle: async () => ({ ok: true }) };
        const runtime = fakeRuntime();
        let activity = 0;
        attachChromeRuntime(host, runtime, { onActivity: () => { activity += 1; } });
        // Web page (bridge.* allowed through) must NOT count as user activity.
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, () => {});
        expect(activity).toBe(0);
        // Extension UI message counts as activity.
        runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER, () => {});
        expect(activity).toBe(1);
        // A blocked web page (privileged type) also does not count.
        runtime.emit({ type: 'action.send', request: {} }, WEB_SENDER, () => {});
        expect(activity).toBe(1);
    });
});

describe('sessionMeta pre-host sender gate', () => {
    it('rejects session lifecycle types from a web-origin sender', async () => {
        const runtime = fakeRuntime();
        attachSessionMetaListener({}, runtime);
        const responses = [];
        const ret = runtime.emit({ type: 'session.status', request: {} }, WEB_SENDER, (r) => responses.push(r));
        expect(ret).toBe(true);
        await Promise.resolve();
        expect(responses[0].ok).toBe(false);
        expect(responses[0].error.code).toBe('FORBIDDEN_SENDER');
    });

    it('ignores (falls through) non pre-host types regardless of sender', () => {
        const runtime = fakeRuntime();
        attachSessionMetaListener({}, runtime);
        const ret = runtime.emit({ type: 'action.send', request: {} }, EXT_SENDER, () => {});
        expect(ret).toBe(false); // not a pre-host type -> host listener handles it
    });
});

describe('signer-bridge port sender gate', () => {
    it('disconnects a web-origin port and never registers a transport', () => {
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        let disconnected = false;
        let messageListenerAdded = false;
        const port = {
            name: 'signer-bridge',
            sender: WEB_SENDER,
            disconnect: () => { disconnected = true; },
            onMessage: { addListener: () => { messageListenerAdded = true; } },
            onDisconnect: { addListener: () => {} },
        };
        runtime.emit(port);
        expect(disconnected).toBe(true);
        expect(messageListenerAdded).toBe(false);
    });

    it('accepts an extension-UI port', () => {
        const runtime = fakeRuntime();
        attachSignerBridgeListener(runtime);
        let disconnected = false;
        let messageListenerAdded = false;
        const port = {
            name: 'signer-bridge',
            sender: EXT_SENDER_TAB,
            disconnect: () => { disconnected = true; },
            onMessage: { addListener: () => { messageListenerAdded = true; } },
            onDisconnect: { addListener: () => {} },
        };
        runtime.emit(port);
        expect(disconnected).toBe(false);
        expect(messageListenerAdded).toBe(true);
    });
});

describe('content script relay allowlist', () => {
    it('only relays bridge.* types (source pins the guard)', () => {
        // The content script is an IIFE that runs on import against a live
        // chrome/document; assert on its source that the guard is present and
        // rejects non-bridge types before the chrome.runtime.sendMessage relay.
        expect(contentScriptSource).toMatch(/startsWith\('bridge\.'\)/);
        // The guard must sit before the actual relay call (not the mention
        // of chrome.runtime.sendMessage in the header comment).
        const guardIdx = contentScriptSource.indexOf("startsWith('bridge.')");
        const relayIdx = contentScriptSource.indexOf('chrome.runtime.sendMessage({ type: data.type');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(relayIdx).toBeGreaterThan(guardIdx);
    });
});
