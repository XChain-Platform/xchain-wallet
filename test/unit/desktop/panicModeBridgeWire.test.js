/**
 * @vitest-environment node
 *
 * Node, not jsdom: main has no localStorage, and the bridge under test is
 * wired straight to main's real IPC entry point.
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The renderer bridge keeps its own copies of the three panic-state message
// names (the sandboxed renderer cannot import from main/). These tests run
// the real bridge against the real main IPC entry point, so a rename on one
// side fails here instead of surfacing as a freeze main never received.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flows } from '@xchain-wallet/core';
import { __resetPanicModePersistenceForTests } from '../../../packages/core/src/flows/panicMode.js';
import { PANIC_STATE_MESSAGE_TYPES } from '../../../packages/desktop/main/panicModeState.js';
import {
    createRuntime,
    handleIpcMessage,
    installPanicModePersistence,
} from '../../../packages/desktop/main/runtime.js';
import { installDesktopPanicModeBridge } from '../../../packages/desktop/renderer/panicModeBridge.js';

function memoryStore() {
    let value = null;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (state) => { value = state; }),
        clear: vi.fn(async () => { value = null; }),
        peek: () => value,
    };
}

function runtimeWith(panicModeStore) {
    const blob = { load: async () => null, save: async () => {}, clear: async () => {} };
    return createRuntime({
        storageBackend: blob,
        sessionBackend: blob,
        metaBackend: blob,
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { get: () => null },
        panicModeStore,
    });
}

/** The renderer's transport: one IPC round trip, envelope unwrapped. */
function ipcTransport(runtime, sent) {
    return async (type, request) => {
        sent.push(type);
        const reply = await handleIpcMessage(runtime, { type, request });
        if (!reply.ok) throw new Error(`${reply.error?.name}: ${reply.error?.message}`);
        return reply.result;
    };
}

beforeEach(() => {
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    __resetPanicModePersistenceForTests();
});

describe('desktop renderer panic bridge against main IPC', () => {
    it('sends only message types that main diverts ahead of the host lane', async () => {
        const sent = [];
        const sendMessage = async (type) => { sent.push(type); return null; };
        await installDesktopPanicModeBridge({ flows, sendMessage });
        flows.activatePanicMode();
        flows.deactivatePanicMode();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(new Set(sent)).toEqual(PANIC_STATE_MESSAGE_TYPES);
    });

    it('lands a locked-screen arm and a deactivate in main\'s own record', async () => {
        const store = memoryStore();
        const runtime = runtimeWith(store);
        await installPanicModePersistence(runtime);
        __resetPanicModePersistenceForTests();
        const sent = [];

        await installDesktopPanicModeBridge({ flows, sendMessage: ipcTransport(runtime, sent) });
        flows.activatePanicMode();
        await vi.waitFor(() => expect(store.peek()).toMatchObject({ armedBy: 'self' }));
        expect(flows.getPanicModeSaveStatus()).not.toBe(flows.PANIC_SAVE_UNSAVED);

        flows.deactivatePanicMode();
        await vi.waitFor(() => expect(store.peek()).toBeNull());
        for (const type of sent) expect(PANIC_STATE_MESSAGE_TYPES.has(type)).toBe(true);
    });
});
