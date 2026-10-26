/**
 * @vitest-environment node
 *
 * Node, not jsdom: the desktop main process has no localStorage, and that
 * absence is the condition under test.
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

// The desktop renderer arms panic mode; main signs and broadcasts. The
// freeze has to reach main, or the renderer shows a freeze that nothing
// enforces.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flows } from '@xchain-wallet/core';
import { __resetPanicModePersistenceForTests } from '../../../packages/core/src/flows/panicMode.js';
import {
    FilePanicModeStore,
    PANIC_STATE_CLEAR_TYPE,
    PANIC_STATE_LOAD_TYPE,
    PANIC_STATE_SAVE_TYPE,
    panicModeStatePathFor,
} from '../../../packages/desktop/main/panicModeState.js';
import {
    createRuntime,
    handleIpcMessage,
    installPanicModePersistence,
    wipeRuntimeStores,
} from '../../../packages/desktop/main/runtime.js';

const HOUR = 60 * 60 * 1000;

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

function activeState(now = Date.now(), armedBy = 'self') {
    return { activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy };
}

beforeEach(() => {
    __resetPanicModePersistenceForTests();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('desktop main panic-mode freeze', () => {
    it('has no localStorage, so a renderer-only freeze never reaches main', () => {
        expect(typeof globalThis.localStorage).toBe('undefined');
    });

    it('a renderer arm reaches main while the wallet is locked and stops signing there', async () => {
        const store = memoryStore();
        const runtime = runtimeWith(store);
        await installPanicModePersistence(runtime);
        expect(() => flows.assertSigningAllowed()).not.toThrow();

        const reply = await handleIpcMessage(runtime, {
            type: PANIC_STATE_SAVE_TYPE,
            request: activeState(Date.now(), 'duress'),
        });

        expect(reply.ok, JSON.stringify(reply.error)).toBe(true);
        expect(() => flows.assertSigningAllowed()).toThrow(flows.PanicModeActiveError);
        expect(store.peek()).toMatchObject({ armedBy: 'duress' });
        const loaded = await handleIpcMessage(runtime, { type: PANIC_STATE_LOAD_TYPE });
        expect(loaded.result).toMatchObject({ armedBy: 'duress' });
    });

    it('a renderer deactivate clears main and its record', async () => {
        const store = memoryStore();
        const runtime = runtimeWith(store);
        await installPanicModePersistence(runtime);
        await handleIpcMessage(runtime, { type: PANIC_STATE_SAVE_TYPE, request: activeState() });

        const reply = await handleIpcMessage(runtime, { type: PANIC_STATE_CLEAR_TYPE });

        expect(reply.ok).toBe(true);
        expect(() => flows.assertSigningAllowed()).not.toThrow();
        expect(store.peek()).toBeNull();
    });

    it('a malformed save reads as no freeze, never as a throw', async () => {
        const runtime = runtimeWith(memoryStore());
        await installPanicModePersistence(runtime);
        const reply = await handleIpcMessage(runtime, {
            type: PANIC_STATE_SAVE_TYPE,
            request: { activatedAt: 'x', expiresAt: Infinity },
        });
        expect(reply.ok).toBe(true);
        expect(reply.result.expiresAt).toBe(0);
        expect(() => flows.assertSigningAllowed()).not.toThrow();
    });

    it('the freeze survives a relaunch through the file record', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'xchain-panic-'));
        const path = panicModeStatePathFor(dir);
        const first = runtimeWith(new FilePanicModeStore(path));
        await installPanicModePersistence(first);
        await handleIpcMessage(first, { type: PANIC_STATE_SAVE_TYPE, request: activeState() });
        expect((statSync(path).mode & 0o777).toString(8)).toBe('600');

        // A fresh process: nothing in memory, only the file.
        __resetPanicModePersistenceForTests();
        const store = new FilePanicModeStore(path);
        const second = runtimeWith(store);
        await installPanicModePersistence(second);
        expect(() => flows.assertSigningAllowed()).toThrow(flows.PanicModeActiveError);

        await store.clear();
    });

    it('a wallet reset clears main and the record', async () => {
        const store = memoryStore();
        const runtime = runtimeWith(store);
        await installPanicModePersistence(runtime);
        await handleIpcMessage(runtime, { type: PANIC_STATE_SAVE_TYPE, request: activeState() });

        const wiped = await wipeRuntimeStores(runtime);

        expect(wiped.cleared).toContain('panicMode');
        expect(store.clear).toHaveBeenCalled();
        expect(() => flows.assertSigningAllowed()).not.toThrow();
    });
});
