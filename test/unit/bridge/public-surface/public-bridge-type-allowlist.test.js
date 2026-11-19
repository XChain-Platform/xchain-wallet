// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The background's web-sender gate admits an exact list of bridge types, not
// every `bridge.*` name, so a handler registered under that namespace later is
// not page-callable until it is listed on purpose.

import { describe, it, expect } from 'vitest';
import {
    PUBLIC_BRIDGE_TYPES,
    isPublicBridgeType,
    isMessageAllowedFromSender,
} from '../../../../packages/extension/src/bridge/publicSurface.js';
import { attachChromeRuntime } from '../../../../packages/extension/src/background/ChromeRuntimeAdapter.js';
import contentScriptSource from '../../../../packages/extension/src/content/contentScript.js?raw';
import handlersSource from '../../../../packages/extension/src/bridge/handlers.js?raw';

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXT_SENDER = { origin: `chrome-extension://${EXT_ID}`, id: EXT_ID };
const WEB_SENDER = { origin: 'https://evil.example', url: 'https://evil.example/', id: EXT_ID, tab: { id: 42 } };

function fakeRuntime() {
    let listener = null;
    return {
        id: EXT_ID,
        onMessage: {
            addListener: (fn) => { listener = fn; },
            removeListener: () => { listener = null; },
        },
        emit: (...args) => listener(...args),
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function quotedEntries(body) {
    return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('public bridge type allowlist', () => {
    it('lists exactly the registered bridge handlers', () => {
        const registered = [...handlersSource.matchAll(/\bregister\(\s*'(bridge\.\w+)'/g)].map((m) => m[1]);
        expect(registered.length).toBeGreaterThanOrEqual(13);
        expect([...PUBLIC_BRIDGE_TYPES].sort()).toEqual([...new Set(registered)].sort());
    });

    it('matches the content-script relay copy', () => {
        const body = contentScriptSource.match(/const PUBLIC_TYPES = new Set\(\[([\s\S]*?)\]\);/);
        expect(body, 'content script declares PUBLIC_TYPES').not.toBeNull();
        expect(quotedEntries(body[1]).sort()).toEqual([...PUBLIC_BRIDGE_TYPES].sort());
    });

    it('is frozen', () => {
        expect(Object.isFrozen(PUBLIC_BRIDGE_TYPES)).toBe(true);
    });

    it('treats an unlisted bridge.* name as private', () => {
        expect(isPublicBridgeType('bridge.connect')).toBe(true);
        expect(isPublicBridgeType('bridge.futurePrivilegedMethod')).toBe(false);
        expect(isPublicBridgeType('bridge.')).toBe(false);
        expect(isMessageAllowedFromSender('bridge.futurePrivilegedMethod', WEB_SENDER, EXT_ID)).toBe(false);
        expect(isMessageAllowedFromSender('bridge.futurePrivilegedMethod', EXT_SENDER, EXT_ID)).toBe(true);
    });

    it('refuses an unlisted bridge.* type from a web sender before the host sees it', async () => {
        const calls = [];
        const host = { handle: async (m) => { calls.push(m); return { ok: true, result: 'HANDLED' }; } };
        const runtime = fakeRuntime();
        attachChromeRuntime(host, runtime);
        const responses = [];
        runtime.emit({ type: 'bridge.futurePrivilegedMethod', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await flush();
        expect(calls).toEqual([]);
        expect(responses[0].error.code).toBe('FORBIDDEN_SENDER');
        runtime.emit({ type: 'bridge.getAccounts', request: {} }, WEB_SENDER, (r) => responses.push(r));
        await flush();
        expect(calls).toHaveLength(1);
    });
});
